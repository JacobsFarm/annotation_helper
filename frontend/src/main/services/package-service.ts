/**
 * Installing the AI packages from inside the app.
 *
 * ultralytics and a CUDA torch are about 1.8 GB of wheels - larger than the rest of the
 * application by an order of magnitude - so only the CUDA build ships them. Every other
 * build gets them on request, here, using the same `uv` command and the same
 * `python-runtime.json` that CI used, so an installed set is indistinguishable from a
 * bundled one.
 *
 * Rules this module keeps, all learned from the sidecar next door:
 *
 *  - Events are emitted to listeners, never broadcast from here. `main/index.ts` owns
 *    the translation to renderer events, which keeps this module free of an import from
 *    `ipc/` and therefore free of the cycle that would come with it.
 *  - The sidecar is stopped first. Windows refuses to overwrite a DLL that a running
 *    process has mapped, and a half-replaced torch is worse than no torch.
 *  - Progress is uv's own output, relayed verbatim. A fabricated percentage over a
 *    download this long is a lie the user would eventually catch.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { ERROR_CODES, type Compute, type PackageStatus } from '@shared/ipc'
import { ServiceError } from './errors'
import { getStatus, probe, stop } from './python-service'
import {
  bundledPackages,
  bundledPython,
  bundledUv,
  runtimeConfig,
  userPackages
} from './runtime-paths'

export type PackageEvent = { line: string } | { done: true; ok: boolean; detail?: string }

const listeners = new Set<(event: PackageEvent) => void>()

let running: ChildProcess | null = null

export function onPackageEvent(handler: (event: PackageEvent) => void): () => void {
  listeners.add(handler)
  return () => listeners.delete(handler)
}

function emit(event: PackageEvent): void {
  for (const listener of listeners) listener(event)
}

/**
 * Whether an NVIDIA GPU is present.
 *
 * `nvidia-smi` ships with the driver, so it answers on a machine with a usable GPU and
 * is absent on one without - which is a better question than "is there an NVIDIA card",
 * because a card with no driver cannot run CUDA either.
 */
function hasNvidiaGpu(): boolean {
  try {
    return spawnSync('nvidia-smi', ['-L'], { windowsHide: true, timeout: 5000 }).status === 0
  } catch {
    return false
  }
}

export function packageStatus(): PackageStatus {
  return {
    installed: getStatus().capabilities?.predict === true,
    bundled: bundledPackages() !== null,
    installing: running !== null,
    suggested: hasNvidiaGpu() ? 'cuda' : 'cpu',
    target: userPackages(),
    runtimeBundled: bundledPython() !== null
  }
}

/**
 * Download and install ultralytics and torch. Resolves when the install finishes.
 *
 * `auto` picks CUDA only when a driver answers: a CPU torch is a tenth of the size, and
 * installing 1.8 GB of CUDA libraries on a laptop with no NVIDIA GPU helps nobody.
 */
export async function installPackages(compute: Compute): Promise<PackageStatus> {
  if (running) throw new ServiceError(ERROR_CODES.packagesBusy, 'an install is already running')
  if (bundledPackages()) {
    throw new ServiceError(ERROR_CODES.packagesBundled, 'this build already ships the packages')
  }

  const uv = bundledUv()
  // The interpreter actually running the engine, not necessarily the bundled one: the
  // wheels are built per Python version, so installing 3.12 wheels for a machine's 3.11
  // would produce a directory nothing can import.
  const python = getStatus().executable ?? bundledPython()
  if (!uv || !python) {
    throw new ServiceError(
      ERROR_CODES.packagesUnavailable,
      'no bundled uv or interpreter to install with'
    )
  }

  const config = runtimeConfig()
  const target = compute === 'auto' ? (hasNvidiaGpu() ? 'cuda' : 'cpu') : compute
  const index = config.indexes[target]
  const dir = userPackages()

  await mkdir(dir, { recursive: true })

  // Windows will not let uv replace a DLL the sidecar has loaded.
  await stop()

  const args = [
    'pip',
    'install',
    '--python',
    python,
    '--target',
    dir,
    '--index-url',
    index,
    '--extra-index-url',
    'https://pypi.org/simple',
    // The best version across both indexes. `torch==2.9.1+cu130` sorts above the plain
    // PyPI `2.9.1`, so the CUDA wheel wins without a pinned version that would rot.
    '--index-strategy',
    'unsafe-best-match',
    ...config.packages
  ]

  emit({ line: `${target} install into ${dir}` })

  const failure = await run(uv, args)

  running = null
  await probe()

  if (failure) {
    emit({ done: true, ok: false, detail: failure })
    throw new ServiceError(ERROR_CODES.packagesFailed, 'the install failed', failure)
  }

  emit({ done: true, ok: true })
  return packageStatus()
}

/** Resolves to null on success, or a short reason on failure. Never rejects. */
function run(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(command, args, { windowsHide: true })
    } catch (error) {
      resolve(String(error))
      return
    }

    running = child
    let lastLine = ''

    // uv writes its progress to stderr and its results to stdout; both are interesting
    // and neither is protocol, so they are relayed the same way.
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding('utf-8')
      stream?.on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n|\r/)) {
          const text = line.trim()
          if (!text) continue
          lastLine = text
          emit({ line: text })
        }
      })
    }

    child.on('error', (error) => resolve(error.message))
    child.on('exit', (code, signal) => {
      if (signal) resolve('cancelled')
      else resolve(code === 0 ? null : `${lastLine} (uv exited with ${code})`)
    })
  })
}

export function cancelInstall(): void {
  running?.kill()
}
