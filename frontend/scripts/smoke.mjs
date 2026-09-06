/**
 * End-to-end smoke test.
 *
 * Builds a throwaway project, launches the real Electron app, and drives its renderer
 * over the DevTools protocol. It proves the chain the unit tests cannot reach:
 * preload bridge -> IPC -> services -> disk, the `ah-img://` protocol, the path
 * traversal guard, and the Python sidecar.
 *
 *     npm run build && npm run test:e2e
 *
 * Needs a desktop session (it opens a window) and, for the last three checks, a Python
 * interpreter with the backend importable. Those three are skipped, not failed, when
 * Python is unavailable - the app is meant to work without it.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const PORT = 9333
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const IMAGE_COUNT = 4
const WIDTH = 640
const HEIGHT = 480

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}
function skip(name, why) {
  results.push({ name, ok: true, skipped: true })
  console.log(`  --   ${name} (skipped: ${why})`)
}

// --- a minimal PNG, so the test needs no image library ----------------------

function png(width, height) {
  const chunk = (tag, payload) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(payload.length)
    const body = Buffer.concat([Buffer.from(tag, 'ascii'), payload])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const raw = Buffer.concat(
    Array.from({ length: height }, (_, y) => {
      const row = Buffer.alloc(1 + width * 3)
      for (let x = 0; x < width; x++) {
        row[1 + x * 3] = (x * 255) / width
        row[2 + x * 3] = (y * 255) / height
        row[3 + x * 3] = 90
      }
      return row
    })
  )

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// --- CDP ---------------------------------------------------------------------

async function findTarget() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* the app has not opened the port yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('renderer never appeared on the debugging port')
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('could not attach to the renderer'))
  })

  let nextId = 1
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  }

  return {
    send(method, params) {
      const id = nextId++
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    close: () => socket.close()
  }
}

// --- the run -----------------------------------------------------------------

const workspace = await mkdtemp(join(tmpdir(), 'annotation-helper-smoke-'))
const projectRoot = join(workspace, 'project')
await mkdir(join(projectRoot, 'images'), { recursive: true })
for (let i = 0; i < IMAGE_COUNT; i++) {
  await writeFile(join(projectRoot, 'images', `img_${String(i).padStart(2, '0')}.png`), png(WIDTH, HEIGHT))
}

// The electron package exports the path to its own binary, which keeps this portable.
const electronBinary = createRequire(import.meta.url)('electron')
const electron = spawn(
  electronBinary,
  ['.', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true }
)

let exitCode = 1
try {
  const cdp = await connect((await findTarget()).webSocketDebuggerUrl)
  await cdp.send('Runtime.enable', {})

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
    }
    return result.result.value
  }

  const root = JSON.stringify(projectRoot)

  const created = await evaluate(
    `window.bridge.invoke('project.create', { root: ${root}, name: 'Smoke', task: 'both' })`
  )
  check('project.create lays out the folder', created.ok === true, created.error?.code)
  check('a new project starts with one class', created.data?.classes?.length === 1)

  const listed = await evaluate(`window.bridge.invoke('dataset.list', ${root})`)
  check('dataset.list finds the images', listed.data?.entries?.length === IMAGE_COUNT)
  const first = listed.data?.entries?.[0]
  check(
    'headers give the real dimensions',
    first?.width === WIDTH && first?.height === HEIGHT,
    `${first?.width}x${first?.height}`
  )

  // Loaded as an <img>: that is how the app uses it, and the CSP allows ah-img: under
  // img-src but deliberately not under connect-src, so fetch() would be blocked.
  const load = (url) => `
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ ok: true, w: img.naturalWidth })
      img.onerror = () => resolve({ ok: false })
      img.src = ${JSON.stringify(url)}
    })
  `
  const served = await evaluate(load(first?.url ?? ''))
  check('ah-img:// serves a project image', served.ok && served.w === WIDTH)

  const outside = await evaluate(
    load('ah-img://f/' + encodeURIComponent('C:\\Windows\\System32\\drivers\\etc\\hosts'))
  )
  check('ah-img:// refuses anything outside the project', outside.ok === false)

  const escape = await evaluate(
    `window.bridge.invoke('labels.read', { root: ${root}, file: '../../../secrets.txt' })`
  )
  check(
    'a traversing path is refused',
    escape.ok === false && escape.error.code === 'path_outside_project',
    escape.error?.code
  )

  const annotation = {
    imageFile: first?.file,
    width: WIDTH,
    height: HEIGHT,
    reviewed: true,
    shapes: [
      { id: 'a', kind: 'box', classId: 0, source: 'manual', x1: 160, y1: 120, x2: 480, y2: 360 },
      {
        id: 'b',
        kind: 'polygon',
        classId: 0,
        source: 'ai',
        points: [
          [40, 40],
          [200, 60],
          [160, 220]
        ]
      }
    ]
  }
  const written = await evaluate(
    `window.bridge.invoke('labels.write', { root: ${root}, annotation: ${JSON.stringify(annotation)} })`
  )
  check('labels.write succeeds', written.ok === true, written.error?.code)

  const readBack = await evaluate(
    `window.bridge.invoke('labels.read', { root: ${root}, file: ${JSON.stringify(first?.file)} })`
  )
  const shapes = readBack.data?.shapes ?? []
  check('a box and a polygon round trip together', shapes.length === 2)
  check('the box comes back where it was put', Math.abs((shapes[0]?.x1 ?? 0) - 160) < 0.5)
  check('an existing label file counts as reviewed', readBack.data?.reviewed === true)

  const background = await evaluate(`
    window.bridge.invoke('labels.write', {
      root: ${root},
      annotation: { imageFile: ${JSON.stringify(listed.data.entries[1].file)}, width: ${WIDTH}, height: ${HEIGHT}, shapes: [], reviewed: true }
    })
  `)
  check('an empty label file can be written on purpose', background.ok === true)

  const unknown = await evaluate(`window.bridge.invoke('does.not.exist', {})`)
  check(
    'an unknown method returns a coded error rather than hanging',
    unknown.ok === false && unknown.error.code === 'unknown_method'
  )

  const python = await evaluate(`window.bridge.invoke('ai.status')`)
  if (python.data?.available) {
    const health = await evaluate(`window.bridge.invoke('dataset.check', ${root})`)
    check('dataset.check reaches Python', health.ok === true, health.error?.code)
    check(
      'the health report sees both label files',
      health.data?.labelled === 2 && health.data?.backgrounds === 1,
      JSON.stringify({ labelled: health.data?.labelled, backgrounds: health.data?.backgrounds })
    )
    const command = await evaluate(`window.bridge.invoke('train.command', { root: ${root} })`)
    check('a training command can be built', Array.isArray(command.data) && command.data.includes('mode=train'))
  } else {
    skip('dataset.check reaches Python', python.data?.reason ?? 'unavailable')
    skip('the health report sees both label files', 'no python')
    skip('a training command can be built', 'no python')
  }

  // --- the inbox ------------------------------------------------------------
  //
  // Dropped in after the app is running, which is also how it happens in practice:
  // the folder is open in the file explorer and the app rescans on demand.
  const exists = async (path) => stat(path).then(() => true, () => false)
  await writeFile(join(projectRoot, 'input', 'fresh.png'), png(WIDTH, HEIGHT))

  const relisted = await evaluate(`window.bridge.invoke('dataset.list', ${root})`)
  const fresh = relisted.data?.entries?.find((e) => e.file === 'fresh.png')
  check('an image in input/ is listed', fresh?.area === 'input', JSON.stringify(fresh?.area))
  check('the inbox leads the list', relisted.data?.entries?.[0]?.file === 'fresh.png')
  check('the summary counts it as pending', relisted.data?.summary?.pending === 1)

  const promoted = await evaluate(`
    window.bridge.invoke('labels.write', {
      root: ${root},
      annotation: { imageFile: 'fresh.png', width: ${WIDTH}, height: ${HEIGHT}, reviewed: true,
        shapes: [{ id: 'c', kind: 'box', classId: 0, source: 'manual', x1: 10, y1: 10, x2: 110, y2: 90 }] }
    })
  `)
  check('saving a label reports the move', promoted.data?.moved === true && promoted.data?.area === 'images')
  check('the image is now in images/', await exists(join(projectRoot, 'images', 'fresh.png')))
  check('the inbox no longer holds it', !(await exists(join(projectRoot, 'input', 'fresh.png'))))
  check('the label sits beside it', await exists(join(projectRoot, 'labels', 'fresh.txt')))
  check(
    'the original went to the recycle bin, not away',
    await exists(join(projectRoot, 'recycle', 'images', 'fresh.png'))
  )

  const afterMove = await evaluate(`window.bridge.invoke('dataset.list', ${root})`)
  check(
    'the rescan sees it as annotated',
    afterMove.data?.entries?.find((e) => e.file === 'fresh.png')?.area === 'images' &&
      afterMove.data?.summary?.pending === 0
  )
  check('the recycle bin is not listed as dataset images', afterMove.data?.entries?.length === IMAGE_COUNT + 1)

  // --- delete, undo, and emptying the bin ------------------------------------

  const trashed = await evaluate(
    `window.bridge.invoke('files.trash', { root: ${root}, file: 'fresh.png', area: 'images' })`
  )
  check('deleting an image succeeds', trashed.ok === true, trashed.error?.code)
  check('a deleted image is in the bin', await exists(join(projectRoot, 'recycle', 'images', 'fresh (2).png')))
  check('its label went with it', await exists(join(projectRoot, 'recycle', 'labels', 'fresh.txt')))

  const undone = await evaluate(`window.bridge.invoke('files.undo', ${root})`)
  check('undo puts the label back', undone.data?.undone !== null && (await exists(join(projectRoot, 'labels', 'fresh.txt'))))
  const undone2 = await evaluate(`window.bridge.invoke('files.undo', ${root})`)
  check('undo puts the image back', undone2.data?.undone !== null && (await exists(join(projectRoot, 'images', 'fresh.png'))))

  const bin = await evaluate(`window.bridge.invoke('files.recycle', ${root})`)
  check('the bin still holds the promoted original', bin.data?.files === 1 && bin.data?.bytes > 0)

  const emptied = await evaluate(`window.bridge.invoke('files.emptyRecycle', ${root})`)
  check('emptying the bin removes it for good', emptied.data?.removed === 1, emptied.error?.code)
  check('the bin folder survives, empty', await exists(join(projectRoot, 'recycle')))
  const binAfter = await evaluate(`window.bridge.invoke('files.recycle', ${root})`)
  check('the bin reports empty afterwards', binAfter.data?.files === 0)

  // What is left in the journal is the copy into images/, whose source was emptied away.
  // Undo must skip the entries pointing into the emptied bin rather than report them as
  // restored, and land on the copy - the one thing it can still reverse.
  const afterEmpty = await evaluate(`window.bridge.invoke('files.undo', ${root})`)
  check(
    'undo skips what the bin no longer holds',
    afterEmpty.data?.undone?.includes('input') === true && !(await exists(join(projectRoot, 'images', 'fresh.png'))),
    afterEmpty.data?.undone
  )
  const exhausted = await evaluate(`window.bridge.invoke('files.undo', ${root})`)
  check('an exhausted journal says so', exhausted.data?.undone === null)

  cdp.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  exitCode = failed === 0 ? 0 : 1
} catch (error) {
  console.error('smoke test failed:', error)
} finally {
  electron.kill()
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

process.exit(exitCode)
