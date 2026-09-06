/**
 * The Python sidecar: one long-lived process, newline-delimited JSON over stdio.
 *
 * Not HTTP: there is no port to collide with, no localhost surface to secure, and the
 * process dies with its parent. Rules this module keeps:
 *
 *  - "Python is not configured" is a *state*, not a crash. The app must stay usable for
 *    annotation with no interpreter at all, so nothing here is imported eagerly and no
 *    failure propagates further than a coded error.
 *  - A crash restarts the process, with a bounded number of retries, and the pending
 *    requests are rejected rather than left hanging forever.
 *  - stdout is protocol only. Anything on stderr is logged, never parsed.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { ERROR_CODES, type PythonStatus } from '@shared/ipc'
import { ServiceError } from './errors'
import { bundledPython, packagePaths } from './runtime-paths'
import { loadSettings } from './settings-service'

const REQUEST_TIMEOUT_MS = 15 * 60 * 1000 // a training start can be slow to acknowledge
const READY_TIMEOUT_MS = 15_000
const MAX_RESTARTS = 3

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: ServiceError) => void
  timer: NodeJS.Timeout
}

export type SidecarEvent = { event: string; id: string } & Record<string, unknown>

let child: ChildProcessWithoutNullStreams | null = null
let buffer = ''
let nextId = 1
let restarts = 0
let status: PythonStatus = { available: false, reason: 'not_started' }
/** The interpreter that last answered. Tried first on a restart. */
let working: string | null = null
let readySignal: ((ok: boolean) => void) | null = null

const pending = new Map<string, Pending>()
const listeners = new Set<(event: SidecarEvent) => void>()

export function onSidecarEvent(handler: (event: SidecarEvent) => void): () => void {
  listeners.add(handler)
  return () => listeners.delete(handler)
}

export function getStatus(): PythonStatus {
  return status
}

/** Where the Python package lives: alongside the repo in dev, in resources when packaged. */
function backendRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'backend', 'src')
    : join(app.getAppPath(), '..', 'backend', 'src')
}

/**
 * Candidate interpreters, most likely first.
 *
 * Three of these entries are lessons rather than guesses. An explicit setting always
 * wins. The Anaconda paths matter because on the machine this was built for, Python and
 * Node exist only inside an Anaconda install that is not on PATH. And bare `python` is
 * *not* trusted: on Windows it is very often the Microsoft Store stub, which prints a
 * message and exits - which is why `launch` verifies each candidate actually answers
 * instead of assuming the first one spawned is the right one.
 *
 * The bundled interpreter sits above everything the machine offers but below an explicit
 * choice: it is the one this build knows has the right packages, yet a user who typed a
 * path into Settings meant it.
 */
async function interpreters(): Promise<string[]> {
  const configured = (await loadSettings()).pythonPath.trim()
  const candidates = [
    configured,
    working ?? '',
    process.env.ANNOTATION_HELPER_PYTHON ?? '',
    bundledPython() ?? '',
    'python',
    'python3',
    'C:\\ProgramData\\anaconda3\\python.exe',
    join(process.env.USERPROFILE ?? '', 'anaconda3', 'python.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python312', 'python.exe')
  ]
  // Absolute paths are checked on disk; bare names are left to PATH resolution.
  const usable = candidates.filter((c) => c && (!/[\\/]/.test(c) || existsSync(c)))
  return [...new Set(usable)]
}

/**
 * Start the first candidate that actually answers.
 *
 * "Answers" means the sidecar's `ready` frame arrives. A process that exits immediately,
 * fails to spawn, or stays silent is discarded and the next candidate is tried.
 */
async function launch(): Promise<void> {
  const candidates = await interpreters()
  if (candidates.length === 0) {
    status = { available: false, reason: 'no_interpreter' }
    throw new ServiceError(ERROR_CODES.pythonUnavailable, 'no Python interpreter found')
  }

  for (const executable of candidates) {
    if (await tryLaunch(executable)) {
      working = executable
      status = { available: true, executable }
      return
    }
  }

  status = { available: false, reason: 'no_interpreter' }
  throw new ServiceError(
    ERROR_CODES.pythonUnavailable,
    'no working Python interpreter found',
    candidates.join(', ')
  )
}

function tryLaunch(executable: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(executable, ['-u', '-m', 'annotation_helper', 'sidecar'], {
        env: {
          ...process.env,
          // The package directories come before the ambient PYTHONPATH so a bundled or
          // user-installed torch beats whatever the machine happens to have.
          PYTHONPATH: [backendRoot(), ...packagePaths(), process.env.PYTHONPATH]
            .filter(Boolean)
            .join(';'),
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        },
        windowsHide: true
      })
    } catch {
      resolve(false)
      return
    }

    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      readySignal = null
      if (!ok) {
        proc.removeAllListeners('exit')
        proc.kill()
        if (child === proc) child = null
      }
      resolve(ok)
    }

    const timer = setTimeout(() => finish(false), READY_TIMEOUT_MS)
    readySignal = finish

    child = proc
    buffer = ''

    proc.stdout.setEncoding('utf-8')
    proc.stdout.on('data', onStdout)
    proc.stderr.setEncoding('utf-8')
    proc.stderr.on('data', (chunk: string) => console.error('[sidecar]', chunk.trimEnd()))

    proc.on('error', () => finish(false))

    proc.on('exit', (code) => {
      if (!settled) {
        // Never answered: a Store stub, a missing module, a wrong interpreter.
        finish(false)
        return
      }
      child = null
      failAll(new ServiceError(ERROR_CODES.pythonFailed, 'sidecar exited', String(code)))
      if (restarts < MAX_RESTARTS) {
        restarts += 1
        status = { available: false, reason: 'restarting', executable }
      } else {
        status = { available: false, reason: 'crashed', executable }
      }
    })
  })
}

function onStdout(chunk: string): void {
  buffer += chunk
  let newline: number
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) handleFrame(line)
  }
}

function handleFrame(line: string): void {
  let frame: Record<string, unknown>
  try {
    frame = JSON.parse(line)
  } catch {
    console.error('[sidecar] unparseable frame:', line.slice(0, 200))
    return
  }

  if (typeof frame.event === 'string') {
    // `ready` is the handshake: it proves this interpreter can run the package.
    if (frame.event === 'ready') readySignal?.(true)
    for (const listener of listeners) listener(frame as SidecarEvent)
    return
  }

  const entry = pending.get(String(frame.id))
  if (!entry) return
  pending.delete(String(frame.id))
  clearTimeout(entry.timer)

  if (frame.ok === true) {
    entry.resolve(frame.result)
  } else {
    const error = (frame.error ?? {}) as { code?: string; message?: string; detail?: string }
    entry.reject(
      new ServiceError(
        error.code ?? ERROR_CODES.pythonFailed,
        error.message ?? 'python call failed',
        error.detail
      )
    )
  }
}

function failAll(error: ServiceError): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(error)
  }
  pending.clear()
}

let starting: Promise<void> | null = null

/** Serialised, so two simultaneous calls cannot start two sidecars. */
async function ensureRunning(): Promise<void> {
  if (child && !child.killed) return
  if (!starting) {
    starting = launch().finally(() => {
      starting = null
    })
  }
  await starting
}

/** Send a request and wait for its reply. The returned promise never hangs forever. */
export async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  await ensureRunning()
  if (!child) throw new ServiceError(ERROR_CODES.pythonUnavailable, 'python is not available')

  const id = String(nextId++)
  const frame = JSON.stringify({ id, method, params }) + '\n'

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new ServiceError(ERROR_CODES.pythonFailed, 'python call timed out', method))
    }, REQUEST_TIMEOUT_MS)

    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
    child!.stdin.write(frame, (error) => {
      if (error) {
        pending.delete(id)
        clearTimeout(timer)
        reject(new ServiceError(ERROR_CODES.pythonFailed, 'could not write to python', error.message))
      }
    })
  })
}

/** The id the *next* `call` will use, so a caller can cancel a request it just sent. */
export function peekNextId(): string {
  return String(nextId)
}

export async function cancel(targetId: string): Promise<void> {
  if (!child) return
  await call('cancel', { target: targetId }).catch(() => undefined)
}

/** Probe the interpreter and report what it can actually do. Never throws. */
export async function probe(): Promise<PythonStatus> {
  try {
    const ping = await call<{ version: string; python: string; executable: string }>('ping')
    const capabilities = await call<PythonStatus['capabilities']>('capabilities')
    status = {
      available: true,
      version: `${ping.python} / annotation-helper ${ping.version}`,
      executable: ping.executable,
      capabilities
    }
  } catch (error) {
    status = {
      available: false,
      reason: error instanceof ServiceError ? error.code : 'unknown',
      executable: status.executable
    }
  }
  return status
}

export async function restart(): Promise<PythonStatus> {
  await stop()
  restarts = 0
  return probe()
}

export async function stop(): Promise<void> {
  const proc = child
  child = null
  if (!proc) return
  try {
    proc.stdin.write(JSON.stringify({ id: '0', method: 'shutdown' }) + '\n')
  } catch {
    // The process is already gone; killing it below is enough.
  }
  proc.kill()
}
