/**
 * Per-image label read/write.
 *
 * This runs in the main process rather than the Python sidecar on purpose: annotating
 * has to work when Python is missing or misconfigured. See `@shared/label-io` for why
 * the parser exists twice.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ERROR_CODES } from '@shared/ipc'
import { formatLabelText, labelNameFor, parseLabelText } from '@shared/label-io'
import type { ImageAnnotation } from '@shared/shapes'
import type { Project } from '@shared/project'
import { ServiceError } from './errors'
import { readImageSize } from './image-size'
import { safeJoin } from './paths'

export function imagePathFor(project: Project, file: string): string {
  return safeJoin(project.root, project.paths.images, file)
}

export function labelPathFor(project: Project, file: string): string {
  return safeJoin(project.root, project.paths.labels, labelNameFor(file))
}

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

export async function writeAnnotation(
  project: Project,
  annotation: ImageAnnotation
): Promise<{ path: string }> {
  const target = labelPathFor(project, annotation.imageFile)
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
  return { path: target }
}
