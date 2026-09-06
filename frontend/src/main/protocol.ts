/**
 * The `ah-img://` scheme.
 *
 * Images do not travel over IPC. A custom protocol lets the renderer use a plain
 * `<img>`, so Chromium does the decoding, caching and GPU upload - all of which it is
 * far better at than a base64 round trip through the message port would be.
 *
 * The handler serves files from opened project roots only, and re-checks on every
 * request. A URL is untrusted input even when this app generated it.
 */

import { net, protocol } from 'electron'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isInside } from './services/paths'

export const SCHEME = 'ah-img'

const allowedRoots = new Set<string>()

/** Called when a project is opened. Nothing outside these roots is ever served. */
export function allowRoot(root: string): void {
  allowedRoots.add(resolve(root))
}

export function imageUrl(absolutePath: string): string {
  return `${SCHEME}://f/${encodeURIComponent(absolutePath)}`
}

/** Must run before `app.whenReady()`; Electron refuses to register schemes later. */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

export function handleProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    let target: string
    try {
      target = resolve(decodeURIComponent(new URL(request.url).pathname.replace(/^\//, '')))
    } catch {
      return new Response('bad request', { status: 400 })
    }

    const permitted = [...allowedRoots].some((root) => isInside(root, target))
    if (!permitted) {
      return new Response('forbidden', { status: 403 })
    }

    try {
      return await net.fetch(pathToFileURL(target).toString())
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
