/**
 * Model-assisted prediction.
 *
 * "Python is not configured" is a first-class UI state here, not a silent failure: the
 * app stays fully usable for manual annotation without an interpreter, and the reason
 * is shown where the user can act on it.
 */

import type { Compute, PackageStatus, PythonStatus } from '@shared/ipc'
import { api, safeCall } from '../api'
import { t } from '../i18n/index.svelte'
import { addPredicted } from './annotations.svelte'
import { project } from './project.svelte'
import { pushToast } from './toast.svelte'

let status = $state<PythonStatus>({ available: false, reason: 'not_started' })
let running = $state(false)
let stage = $state('')
let progress = $state(0)

export function pythonStatus(): PythonStatus {
  return status
}

export function setPythonStatus(next: PythonStatus): void {
  status = next
}

export function canPredict(): boolean {
  return status.available && status.capabilities?.predict === true
}

export function isPredicting(): boolean {
  return running
}

export function predictStage(): string {
  return stage
}

export function predictProgress(): number {
  return progress
}

export function setPredictProgress(nextStage: string, pct: number): void {
  stage = nextStage
  progress = pct
}

export async function refreshStatus(): Promise<void> {
  const next = await safeCall(() => api.ai.status())
  if (next) status = next
}

export async function restartEngine(): Promise<void> {
  const next = await safeCall(() => api.ai.restart())
  if (next) status = next
}

export async function predictCurrent(file: string): Promise<void> {
  const open = project()
  if (!open || running) return

  running = true
  progress = 0
  stage = ''
  const result = await safeCall(() =>
    api.ai.predict({ root: open.root, file, options: open.ai })
  )
  running = false
  progress = 0

  if (result) addPredicted(result.shapes)
}

export async function cancelPredict(): Promise<void> {
  if (!running) return
  await safeCall(() => api.ai.cancel())
}

// --- the AI packages (ultralytics, torch) -----------------------------------
//
// Only the CUDA build ships them; every other build downloads them on request. The log
// is uv's own output rather than a percentage, because a fabricated percentage over a
// 1.8 GB download is a lie the user would eventually catch.

const MAX_LOG_LINES = 400

let packages = $state<PackageStatus | null>(null)
let installing = $state(false)
let log = $state<string[]>([])

export function packageStatus(): PackageStatus | null {
  return packages
}

export function isInstalling(): boolean {
  return installing
}

export function installLog(): string[] {
  return log
}

export async function refreshPackages(): Promise<void> {
  const next = await safeCall(() => api.ai.packages())
  if (next) {
    packages = next
    installing = next.installing
  }
}

export function appendPackageLine(line: string): void {
  log = [...log, line].slice(-MAX_LOG_LINES)
}

export function finishInstall(ok: boolean, detail?: string): void {
  installing = false
  if (detail) appendPackageLine(detail)
  void refreshPackages()
  pushToast(ok ? 'info' : 'error', ok ? t('packages_done') : t('packages_failed'), detail)
}

export async function startInstall(compute: Compute): Promise<void> {
  if (installing) return
  installing = true
  log = []
  const result = await safeCall(() => api.ai.install({ compute }))
  // A failure has already surfaced as a toast; `packages:done` clears the flag either
  // way, but clear it here too so a rejection before the event still ends the spinner.
  installing = false
  if (result) packages = result
}

export async function cancelInstall(): Promise<void> {
  if (!installing) return
  await safeCall(() => api.ai.cancelInstall())
}
