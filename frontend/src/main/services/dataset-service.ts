/**
 * Scanning a project's images and summarising their label state.
 *
 * Deliberately does not shell out to Python: the file list is what the annotate screen
 * needs before anything else, so it must not depend on an interpreter being present.
 * The heavier dataset operations - health check, split - do go to the sidecar.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { DatasetEntry, DatasetSummary, ImageArea } from '@shared/ipc'
import { isImageFile, labelNameFor, parseLabelText } from '@shared/label-io'
import { countShapeKinds, kindFromCounts } from '@shared/shapes'
import type { Project } from '@shared/project'
import { imageUrl } from '../protocol'
import { readImageSize } from './image-size'
import { areaDir, safeJoin, toPosix } from './paths'

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

function sorted(files: string[]): string[] {
  return files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

/**
 * Everything there is to annotate: the inbox first, then what has already been done.
 *
 * The inbox leads because that is the work queue - open the screen and the next image
 * waiting is the one in front of you. Images that have been annotated stay in the list
 * below it so they can be reviewed and corrected; they are not archived away.
 *
 * A relative path present in both folders is listed once, from `images/`, since that is
 * the copy the label belongs to. The app never produces such a pair itself - promoting
 * an image uniques its name - so this only guards a folder someone filled by hand.
 */
export async function listDataset(
  project: Project
): Promise<{ entries: DatasetEntry[]; summary: DatasetSummary }> {
  const labels = safeJoin(project.root, project.paths.labels)
  const dirs: Record<ImageArea, string> = {
    input: areaDir(project, 'input'),
    images: areaDir(project, 'images')
  }

  const inImages = sorted(await collect(dirs.images, dirs.images))
  const known = new Set(inImages)
  const inInput = sorted(await collect(dirs.input, dirs.input)).filter((f) => !known.has(f))

  const entries: DatasetEntry[] = []
  const summary: DatasetSummary = {
    total: 0,
    pending: 0,
    labelled: 0,
    backgrounds: 0,
    shapes: 0,
    boxImages: 0,
    polygonImages: 0,
    mixedImages: 0
  }

  const areas: [ImageArea, string[]][] = [
    ['input', inInput],
    ['images', inImages]
  ]

  for (const [area, files] of areas) {
    for (const file of files) {
      const imagePath = join(dirs[area], file)
      const size = await readImageSize(imagePath)
      if (!size) continue

      let boxes = 0
      let polygons = 0
      let labelled = false
      try {
        const text = await readFile(join(labels, labelNameFor(file)), 'utf-8')
        labelled = true
        const tally = countShapeKinds(parseLabelText(text, size.width, size.height).shapes)
        boxes = tally.boxes
        polygons = tally.polygons
      } catch {
        labelled = false
      }

      const shapeCount = boxes + polygons
      const kind = kindFromCounts(boxes, polygons, labelled)

      summary.total += 1
      if (area === 'input') summary.pending += 1
      if (labelled) summary.labelled += 1
      if (kind === 'background') summary.backgrounds += 1
      if (kind === 'box') summary.boxImages += 1
      if (kind === 'polygon') summary.polygonImages += 1
      if (kind === 'mixed') summary.mixedImages += 1
      summary.shapes += shapeCount

      entries.push({
        file,
        area,
        width: size.width,
        height: size.height,
        labelled,
        shapeCount,
        boxCount: boxes,
        polygonCount: polygons,
        kind,
        url: imageUrl(imagePath)
      })
    }
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
