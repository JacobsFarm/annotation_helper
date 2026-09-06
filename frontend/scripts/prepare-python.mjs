/**
 * Build the Python runtime that ships inside the app.
 *
 * The app must work on a machine with no Python at all, so a real interpreter travels
 * with it. Two decisions are worth knowing:
 *
 *  - The *embeddable* distribution is used, and its `python3xx._pth` file is deleted.
 *    That file is what makes the embeddable build special: while it is present Python
 *    ignores `PYTHONPATH` entirely and never adds `site-packages`. Deleting it turns the
 *    zip back into an ordinary interpreter, which is exactly what the sidecar needs -
 *    `python-service.ts` points `PYTHONPATH` at the backend and at the package
 *    directory, and neither would be seen otherwise.
 *
 *  - Packages are installed with `uv` into a plain `--target` directory, never into
 *    `site-packages`. The same command then works at run time against a directory in
 *    `userData`, which is writable even when the app itself is not - the portable build
 *    unpacks itself into `%TEMP%` on every launch, so anything written next to the exe
 *    is gone by the next start.
 *
 * Usage:
 *   node scripts/prepare-python.mjs                 interpreter + uv only
 *   node scripts/prepare-python.mjs --ai cuda       ... and the AI packages, CUDA build
 *   node scripts/prepare-python.mjs --ai cpu        ... and the AI packages, CPU build
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = resolve(here, '..')
const config = JSON.parse(readFileSync(join(frontend, 'python-runtime.json'), 'utf-8'))

const args = process.argv.slice(2)
const flag = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? (args[index + 1] ?? '') : null
}

const outRoot = resolve(frontend, flag('out') ?? 'runtime')
const compute = flag('ai') // null | 'cuda' | 'cpu'

const pythonDir = join(outRoot, 'python')
const uvDir = join(outRoot, 'uv')
const packagesDir = join(outRoot, 'packages')
const pythonExe = join(pythonDir, 'python.exe')
const uvExe = join(uvDir, 'uv.exe')

if (process.platform !== 'win32') {
  console.error('prepare-python: Windows only - the bundled runtime is a win_amd64 build.')
  process.exit(1)
}

await main()

async function main() {
  mkdirSync(outRoot, { recursive: true })

  await ensurePython()
  await ensureUv()

  if (compute) {
    if (compute !== 'cuda' && compute !== 'cpu') {
      console.error(`prepare-python: --ai must be "cuda" or "cpu", got "${compute}"`)
      process.exit(1)
    }
    installPackages(compute)
  }

  console.log(`\nprepare-python: runtime ready in ${outRoot}`)
}

async function ensurePython() {
  if (existsSync(pythonExe)) {
    console.log(`prepare-python: reusing the interpreter in ${pythonDir}`)
    return
  }

  const version = config.python
  const url = `https://www.python.org/ftp/python/${version}/python-${version}-embed-amd64.zip`
  const zip = join(outRoot, 'python-embed.zip')

  console.log(`prepare-python: downloading Python ${version}`)
  await download(url, zip)

  mkdirSync(pythonDir, { recursive: true })
  extract(zip, pythonDir)
  rmSync(zip)

  // The point of the whole exercise: without this, PYTHONPATH is ignored.
  for (const entry of await readdir(pythonDir)) {
    if (entry.endsWith('._pth')) {
      await rm(join(pythonDir, entry))
      console.log(`prepare-python: removed ${entry} so PYTHONPATH is honoured`)
    }
  }

  // A marker the app can read without shelling out to the interpreter.
  writeFileSync(join(pythonDir, 'VERSION'), `${version}\n`, 'utf-8')
}

async function ensureUv() {
  if (existsSync(uvExe)) {
    console.log(`prepare-python: reusing uv in ${uvDir}`)
    return
  }

  // uv rather than pip: it resolves across two indexes in one pass, which is what keeps
  // the CUDA torch wheel winning over the plain PyPI one, and it downloads ~1.8 GB of
  // wheels several times faster than pip does.
  const tag = config.uv === 'latest' ? 'latest/download' : `download/${config.uv}`
  const url = `https://github.com/astral-sh/uv/releases/${tag}/uv-x86_64-pc-windows-msvc.zip`
  const zip = join(outRoot, 'uv.zip')

  console.log('prepare-python: downloading uv')
  await download(url, zip)

  mkdirSync(uvDir, { recursive: true })
  extract(zip, uvDir)
  rmSync(zip)
}

function installPackages(target) {
  const index = config.indexes[target]
  console.log(`prepare-python: installing AI packages (${target}) from ${index}`)

  const result = spawnSync(
    uvExe,
    [
      'pip',
      'install',
      '--python',
      pythonExe,
      '--target',
      packagesDir,
      '--index-url',
      index,
      '--extra-index-url',
      'https://pypi.org/simple',
      // Best version across both indexes. `torch==2.9.1+cu130` sorts above `2.9.1`,
      // so the CUDA wheel wins and nothing has to be pinned by hand.
      '--index-strategy',
      'unsafe-best-match',
      ...config.packages
    ],
    { stdio: 'inherit' }
  )

  if (result.status !== 0) {
    console.error(`prepare-python: uv exited with ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

async function download(url, target) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    console.error(`prepare-python: ${response.status} ${response.statusText} for ${url}`)
    process.exit(1)
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()))
}

/** bsdtar ships with Windows 10 and later and reads zip, so there is no dependency. */
function extract(zip, target) {
  const result = spawnSync('tar', ['-xf', zip, '-C', target], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`prepare-python: could not extract ${zip}`)
    process.exit(result.status ?? 1)
  }
}
