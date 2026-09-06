/**
 * Scanning a project's images and summarising their label state.
 *
 * Deliberately does not shell out to Python: the file list is what the annotate screen
 * needs before anything else, so it must not depend on an interpreter being present.
 * The heavier dataset operations - health check, split - do go to the sidecar.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { DatasetEntry, DatasetSummary } from '@shared/ipc'
import { isImageFile, labelNameFor, parseLabelText } from '@shared/label-io'
import type { Project } from '@shared/project'
import { imageUrl } from '../protocol'
import { readImageSize } from './image-size'
import { safeJoin, toPosix } from './paths'

const MAX_DEPTH = 6

/** Every image under the project's images directory, sorted so "next" is stable. */
async function collect(root: string, dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  let items
  try {
    items = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const item of items) {
    const full = join(dir, item.name)
    if (item.isDirectory()) {
      files.push(...(await collect(root, full, depth + 1)))
    } else if (isImageFile(item.name)) {
      files.push(toPosix(relative(root, full)))
    }
  }
  return files
}

export async function listDataset(
  project: Project
): Promise<{ entries: DatasetEntry[]; summary: DatasetSummary }> {
  const images = safeJoin(project.root, project.paths.images)
  const labels = safeJoin(project.root, project.paths.labels)
  const files = (await collect(images, images)).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )

  const entries: DatasetEntry[] = []
  const summary: DatasetSummary = { total: 0, labelled: 0, backgrounds: 0, shapes: 0 }

  for (const file of files) {
    const imagePath = join(images, file)
    const size = await readImageSize(imagePath)
    if (!size) continue

    let shapeCount = 0
    let labelled = false
    try {
      const text = await readFile(join(labels, labelNameFor(file)), 'utf-8')
      labelled = true
      shapeCount = parseLabelText(text, size.width, size.height).shapes.length
    } catch {
      labelled = false
    }

    summary.total += 1
    if (labelled) summary.labelled += 1
    if (labelled && shapeCount === 0) summary.backgrounds += 1
    summary.shapes += shapeCount

    entries.push({
      file,
      width: size.width,
      height: size.height,
      labelled,
      shapeCount,
      url: imageUrl(imagePath)
    })
  }

  return { entries, summary }
}

export async function projectExists(root: string): Promise<boolean> {
  try {
    return (await stat(root)).isDirectory()
  } catch {
    return false
  }
}
