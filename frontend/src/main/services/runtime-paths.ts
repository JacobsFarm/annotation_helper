/**
 * Where the bundled interpreter, uv and the AI packages live.
 *
 * Its own module because both the sidecar and the package installer need these paths,
 * and importing either from the other would tie the engine to the installer.
 *
 * Two package directories exist and the difference matters. The *bundled* one ships
 * inside the build and is read-only - an update replaces it wholesale. The *user* one
 * lives in `userData`, which is the only place guaranteed to be writable: the portable
 * build unpacks itself into `%TEMP%` on every launch, so anything written next to the
 * exe is gone by the next start.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface RuntimeConfig {
  python: string
  uv: string
  packages: string[]
  indexes: { cuda: string; cpu: string }
}

/** `resources/runtime` when packaged, `frontend/runtime` while developing. */
function runtimeRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'runtime') : join(app.getAppPath(), 'runtime')
}

function orNull(path: string): string | null {
  return existsSync(path) ? path : null
}

/** The interpreter that ships with the app, if this build has one. */
export function bundledPython(): string | null {
  return orNull(join(runtimeRoot(), 'python', 'python.exe'))
}

export function bundledUv(): string | null {
  return orNull(join(runtimeRoot(), 'uv', 'uv.exe'))
}

/** Presence of `torch` is the test: an empty directory is not an installation. */
export function bundledPackages(): string | null {
  const dir = join(runtimeRoot(), 'packages')
  return existsSync(join(dir, 'torch')) ? dir : null
}

export function userPackages(): string {
  return join(app.getPath('userData'), 'python-packages')
}

/** Everything to put on `PYTHONPATH`, bundled first: a build's own packages win. */
export function packagePaths(): string[] {
  const paths: string[] = []

  const bundled = bundledPackages()
  if (bundled) paths.push(bundled)

  const user = userPackages()
  if (existsSync(join(user, 'torch'))) paths.push(user)

  return paths
}

let config: RuntimeConfig | null = null

/**
 * The versions and indexes CI built the runtime from, read back at run time so an
 * in-app install produces exactly what a bundled one would. Ships in the asar next to
 * `package.json`; `app.getAppPath()` resolves to the asar root when packaged and to
 * `frontend/` in development, so one path covers both.
 */
export function runtimeConfig(): RuntimeConfig {
  if (!config) {
    config = JSON.parse(
      readFileSync(join(app.getAppPath(), 'python-runtime.json'), 'utf-8')
    ) as RuntimeConfig
  }
  return config
}
