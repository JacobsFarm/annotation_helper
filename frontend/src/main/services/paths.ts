/**
 * Path resolution with a traversal check, in one place.
 *
 * Every path that arrives from the renderer is untrusted input. It is resolved against
 * a project root and rejected if it escapes it, so a crafted `../../..` can never make
 * the main process read or write outside the project the user opened.
 */

import { join, normalize, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ERROR_CODES } from '@shared/ipc'
import { STATE_DIRNAME } from '@shared/project'
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

/** Forward slashes, always: a relative path is an identifier, not a filesystem path. */
export function toPosix(value: string): string {
  return normalize(value).split(sep).join('/')
}

export function fileUrl(absolute: string): string {
  return pathToFileURL(absolute).toString()
}
