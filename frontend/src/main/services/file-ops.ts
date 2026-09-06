/**
 * Journalled file operations. Nothing is ever hard-deleted.
 *
 * Mirrors `backend/src/annotation_helper/fileops.py`; the journal file is the same
 * NDJSON, so an undo works whichever side performed the move.
 */

import {
  appendFile,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import type { ImageArea, RecycleStatus } from '@shared/ipc'
import { STATE_DIRNAME } from '@shared/project'
import type { Project } from '@shared/project'
import {
  areaDir,
  imagePathIn,
  isInside,
  labelPathFor,
  recycleDir,
  resolveImage,
  safeJoin,
  toPosix
} from './paths'

export interface JournalEntry {
  op: 'move' | 'copy' | 'trash' | 'write'
  source: string
  target: string
  timestamp: number
}

function journalPath(root: string): string {
  return safeJoin(root, STATE_DIRNAME, 'journal.ndjson')
}

/** Where a file goes instead of being deleted. `kind` keeps images and labels apart. */
async function binFor(project: Project, kind: 'images' | 'labels'): Promise<string> {
  const dir = join(recycleDir(project), kind)
  await mkdir(dir, { recursive: true })
  return dir
}

/** Move a file into the recycle bin under `name`, journalled so it can come back. */
async function recycle(
  project: Project,
  source: string,
  kind: 'images' | 'labels',
  name = basename(source)
): Promise<string> {
  const target = uniqueTarget(join(await binFor(project, kind), name))
  await rename(source, target)
  await append(project.root, { op: 'trash', source, target, timestamp: Date.now() })
  return target
}

async function append(root: string, entry: JournalEntry): Promise<void> {
  const path = journalPath(root)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, JSON.stringify(entry) + '\n', 'utf-8')
}

async function readJournal(root: string): Promise<JournalEntry[]> {
  try {
    return (await readFile(journalPath(root), 'utf-8'))
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as JournalEntry]
        } catch {
          return [] // a partially written last line is expected after a crash
        }
      })
  } catch {
    return []
  }
}

async function writeJournal(root: string, entries: JournalEntry[]): Promise<void> {
  await writeFile(
    journalPath(root),
    entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''),
    'utf-8'
  )
}

/** `name.jpg` -> `name (2).jpg`. Never overwrites blindly. */
function uniqueTarget(target: string): string {
  if (!existsSync(target)) return target
  const dir = dirname(target)
  const ext = extname(target)
  const stem = basename(target, ext)
  for (let n = 2; ; n++) {
    const candidate = join(dir, `${stem} (${n})${ext}`)
    if (!existsSync(candidate)) return candidate
  }
}

/**
 * Take an image out of the inbox and into the dataset, keeping its sub-folder structure.
 *
 * This is what "annotating an image" does to the file itself, and it does it in two
 * journalled steps: the image is *copied* into `images/`, and the original is moved into
 * the recycle bin. The copy comes first, so a failure half way leaves the inbox intact
 * rather than the dataset.
 *
 * The original is kept rather than dropped because the inbox is where a scanner, a
 * camera or a colleague put the file, and the only thing standing between it and being
 * gone would otherwise be this application getting the write right. Emptying the recycle
 * bin is a separate, deliberate act - see `emptyRecycle`.
 *
 * The target name is uniqued *before* the label is written, so an image that collides
 * with one already in `images/` becomes `name (2).jpg` and gets `name (2).txt` beside
 * it. The pair can never come apart, which is the whole reason this returns the name.
 * Returns `null` when the image is not in the inbox: re-saving a label moves nothing.
 */
export async function promoteImage(
  project: Project,
  file: string
): Promise<{ file: string; path: string; recycled: string } | null> {
  const { path: source, area } = resolveImage(project, file)
  if (area !== 'input' || !existsSync(source)) return null

  const target = uniqueTarget(imagePathIn(project, 'images', file))
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
  await append(project.root, { op: 'copy', source, target, timestamp: Date.now() })

  const recycled = await recycle(project, source, 'images', basename(target))
  return { file: toPosix(relative(areaDir(project, 'images'), target)), path: target, recycled }
}

/**
 * The only "delete" this application offers: image and label go to the recycle bin.
 *
 * The predecessor removed both permanently, with no confirmation and no recovery.
 */
export async function trashImage(
  project: Project,
  file: string,
  area?: ImageArea
): Promise<{ trashed: string }> {
  const imagePath = area ? imagePathIn(project, area, file) : resolveImage(project, file).path
  const trashed = await recycle(project, imagePath, 'images')

  const labelPath = labelPathFor(project, file)
  if (existsSync(labelPath)) await recycle(project, labelPath, 'labels')

  return { trashed }
}

// --- the recycle bin --------------------------------------------------------

/** Every file under `dir`, recursively, as absolute paths. */
async function walk(dir: string): Promise<string[]> {
  let items
  try {
    items = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const item of items) {
    const full = join(dir, item.name)
    if (item.isDirectory()) found.push(...(await walk(full)))
    else found.push(full)
  }
  return found
}

export async function recycleStatus(project: Project): Promise<RecycleStatus> {
  const dir = recycleDir(project)
  const files = await walk(dir)
  let bytes = 0
  for (const file of files) {
    try {
      bytes += (await stat(file)).size
    } catch {
      // vanished between listing and measuring; it simply does not count
    }
  }
  return { path: dir, files: files.length, bytes }
}

/**
 * Empty the recycle bin for good. The one call in this codebase that destroys data.
 *
 * It also drops the journal entries that point into the bin. Leaving them would make
 * "undo" offer to restore files that are gone and quietly do nothing, which is a worse
 * failure than saying there is nothing to undo.
 */
export async function emptyRecycle(project: Project): Promise<{ removed: number; bytes: number }> {
  const dir = recycleDir(project)
  const { files: removed, bytes } = await recycleStatus(project)

  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const kept = (await readJournal(project.root)).filter((entry) => !isInside(dir, entry.target))
  await writeJournal(project.root, kept)

  return { removed, bytes }
}

/**
 * Reverse the newest journalled operation that can still be reversed.
 *
 * Entries whose target is gone - emptied from the recycle bin, or moved by hand - are
 * discarded as it walks back, rather than reported as undone. Returns what came back,
 * or null when there is nothing left.
 */
export async function undoLast(root: string): Promise<{ undone: string | null }> {
  const entries = await readJournal(root)

  while (entries.length > 0) {
    const last = entries.pop()!
    if (!existsSync(last.target)) continue // nothing left to put back; drop it and look on

    if (last.op === 'move' || last.op === 'trash') {
      await mkdir(dirname(last.source), { recursive: true })
      await rename(last.target, last.source)
    } else if (last.op === 'copy') {
      await unlink(last.target)
    } else {
      continue // a 'write' records what happened; there is no inverse
    }

    await writeJournal(root, entries)
    return { undone: last.source }
  }

  await writeJournal(root, entries)
  return { undone: null }
}
