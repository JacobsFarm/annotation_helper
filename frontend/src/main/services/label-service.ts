/**
 * Per-image label read/write.
 *
 * This runs in the main process rather than the Python sidecar on purpose: annotating
 * has to work when Python is missing or misconfigured. See `@shared/label-io` for why
 * the parser exists twice.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ERROR_CODES, type LabelWriteResult } from '@shared/ipc'
import { formatLabelText, parseLabelText } from '@shared/label-io'
import type { ImageAnnotation } from '@shared/shapes'
import type { Project } from '@shared/project'
import { ServiceError } from './errors'
import { promoteImage } from './file-ops'
import { readImageSize } from './image-size'
import { imageUrl } from '../protocol'
import { imagePathFor, labelPathFor, resolveImage } from './paths'

export async function readAnnotation(project: Project, file: string): Promise<ImageAnnotation> {
  const imagePath = imagePathFor(project, file)
  const size = await readImageSize(imagePath)
  if (!size) {
    throw new ServiceError(ERROR_CODES.imageNotFound, 'image could not be read', file)
  }

  let text: string | null = null
  try {
    text = await readFile(labelPathFor(project, file), 'utf-8')
  } catch {
    text = null // no label yet; a normal state, not an error
  }

  const parsed = text === null ? null : parseLabelText(text, size.width, size.height)
  return {
    imageFile: file,
    width: size.width,
    height: size.height,
    shapes: parsed?.shapes ?? [],
    // A file that exists has been through this app (or another tool) at least once.
    reviewed: parsed !== null
  }
}

/**
 * Write the label file, and move the image out of the inbox if that is where it was.
 *
 * The move happens first, on purpose. A name that collides with one already in
 * `images/` is uniqued during the move, and the label has to be written under whatever
 * name the image ended up with - doing it the other way round would orphan the label
 * the one time it matters. The move is journalled, so a label write that then fails
 * leaves an image in `images/` with no label: it shows up as unlabelled, saving again
 * fixes it, and undo puts it back. Nothing is lost either way.
 */
export async function writeAnnotation(
  project: Project,
  annotation: ImageAnnotation
): Promise<LabelWriteResult> {
  const promoted = await promoteImage(project, annotation.imageFile)
  const file = promoted?.file ?? annotation.imageFile

  const target = labelPathFor(project, file)
  const text = formatLabelText(annotation.shapes, annotation.width, annotation.height)
  try {
    await mkdir(dirname(target), { recursive: true })
    const temp = `${target}.tmp`
    await writeFile(temp, text, 'utf-8')
    await rename(temp, target)
  } catch (error) {
    throw new ServiceError(
      ERROR_CODES.writeFailed,
      'could not write the label file',
      error instanceof Error ? error.message : String(error)
    )
  }

  const { path: imagePath, area } = resolveImage(project, file)
  return { path: target, imageFile: file, area, url: imageUrl(imagePath), moved: promoted !== null }
}
