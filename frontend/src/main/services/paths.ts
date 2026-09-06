/**
 * Path resolution with a traversal check, in one place.
 *
 * Every path that arrives from the renderer is untrusted input. It is resolved against
 * a project root and rejected if it escapes it, so a crafted `../../..` can never make
 * the main process read or write outside the project the user opened.
 */

import { existsSync } from 'node:fs'
import { join, normalize, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ERROR_CODES, type ImageArea } from '@shared/ipc'
import { labelNameFor } from '@shared/label-io'
import { STATE_DIRNAME, type Project } from '@shared/project'
import { ServiceError } from './errors'

export function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel))
}

/** Resolve `relativePath` under `root`, or throw. Never returns a path outside `root`. */
export function safeJoin(root: string, ...segments: string[]): string {
  const target = resolve(join(root, ...segments))
  if (!isInside(root, target)) {
    throw new ServiceError(ERROR_CODES.pathOutsideProject, 'path escapes the project', target)
  }
  return target
}

export function imagesDir(root: string, images: string): string {
  return safeJoin(root, images)
}

export function labelsDir(root: string, labels: string): string {
  return safeJoin(root, labels)
}

export function stateDir(root: string): string {
  return safeJoin(root, STATE_DIRNAME)
}

/**
 * The project's recycle bin.
 *
 * A visible folder next to `images/`, not something tucked inside `.annotation-helper/`:
 * what lands here is the user's own data - the original of an annotated image, or an
 * image they deleted - and they have to be able to see it, open it, and decide when it
 * really goes. Emptying it is the only operation in this application that destroys a
 * file, and it is never automatic.
 */
export function recycleDir(project: Project): string {
  return safeJoin(project.root, project.paths.recycle)
}

// --- where one image and its label live -------------------------------------
//
// An image has two possible homes and exactly one at a time: `input/` while it is
// waiting, `images/` once it has been annotated. Everything that needs to open an image
// asks here rather than assuming, so the inbox is a fact about the filesystem and not a
// flag someone has to remember to pass around.

export function areaDir(project: Project, area: ImageArea): string {
  return safeJoin(project.root, area === 'input' ? project.paths.input : project.paths.images)
}

export function imagePathIn(project: Project, area: ImageArea, file: string): string {
  return safeJoin(areaDir(project, area), file)
}

export function labelPathFor(project: Project, file: string): string {
  return safeJoin(project.root, project.paths.labels, labelNameFor(file))
}

/**
 * Find an image. `images/` wins a name that exists in both, because that is the copy the
 * labels belong to; the app never creates such a pair itself (see `promoteImage`).
 * Returns the inbox location for a file that is in neither, so a caller that is about to
 * write knows where it would go.
 */
export function resolveImage(
  project: Project,
  file: string
): { path: string; area: ImageArea } {
  const inImages = imagePathIn(project, 'images', file)
  if (existsSync(inImages)) return { path: inImages, area: 'images' }
  const inInput = imagePathIn(project, 'input', file)
  if (existsSync(inInput)) return { path: inInput, area: 'input' }
  return { path: inInput, area: 'input' }
}

export function imagePathFor(project: Project, file: string): string {
  return resolveImage(project, file).path
}

/** Forward slashes, always: a relative path is an identifier, not a filesystem path. */
export function toPosix(value: string): string {
  return normalize(value).split(sep).join('/')
}

export function fileUrl(absolute: string): string {
  return pathToFileURL(absolute).toString()
}
