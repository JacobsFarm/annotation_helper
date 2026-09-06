/**
 * Journalled file operations. Nothing is ever hard-deleted.
 *
 * Mirrors `backend/src/annotation_helper/fileops.py`; the journal file is the same
 * NDJSON, so an undo works whichever side performed the move.
 */

import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { STATE_DIRNAME } from '@shared/project'
import type { Project } from '@shared/project'
import { labelPathFor } from './label-service'
import { safeJoin } from './paths'

export interface JournalEntry {
  op: 'move' | 'copy' | 'trash' | 'write'
  source: string
  target: string
  timestamp: number
}

function journalPath(root: string): string {
  return safeJoin(root, STATE_DIRNAME, 'journal.ndjson')
}

function trashDir(root: string): string {
  return safeJoin(root, STATE_DIRNAME, 'trash')
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
 * The only "delete" in this codebase: move image and label into the project trash.
 *
 * The predecessor removed both permanently, with no confirmation and no recovery.
 */
export async function trashImage(project: Project, file: string): Promise<{ trashed: string }> {
  const bin = trashDir(project.root)
  await mkdir(join(bin, 'images'), { recursive: true })
  await mkdir(join(bin, 'labels'), { recursive: true })

  const imagePath = safeJoin(project.root, project.paths.images, file)
  const imageTarget = uniqueTarget(join(bin, 'images', basename(file)))
  await rename(imagePath, imageTarget)
  await append(project.root, {
    op: 'trash',
    source: imagePath,
    target: imageTarget,
    timestamp: Date.now()
  })

  const labelPath = labelPathFor(project, file)
  if (existsSync(labelPath)) {
    const labelTarget = uniqueTarget(join(bin, 'labels', basename(labelPath)))
    await rename(labelPath, labelTarget)
    await append(project.root, {
      op: 'trash',
      source: labelPath,
      target: labelTarget,
      timestamp: Date.now()
    })
  }

  return { trashed: imageTarget }
}

/** Reverse the newest journalled operation. Returns what was undone, or null. */
export async function undoLast(root: string): Promise<{ undone: string | null }> {
  const entries = await readJournal(root)
  const last = entries.pop()
  if (!last) return { undone: null }

  if ((last.op === 'move' || last.op === 'trash') && existsSync(last.target)) {
    await mkdir(dirname(last.source), { recursive: true })
    await rename(last.target, last.source)
  } else if (last.op === 'copy' && existsSync(last.target)) {
    await unlink(last.target)
  }

  await writeFile(
    journalPath(root),
    entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''),
    'utf-8'
  )
  return { undone: last.source }
}
