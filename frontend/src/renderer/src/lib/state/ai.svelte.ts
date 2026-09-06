/**
 * Model-assisted prediction.
 *
 * "Python is not configured" is a first-class UI state here, not a silent failure: the
 * app stays fully usable for manual annotation without an interpreter, and the reason
 * is shown where the user can act on it.
 */

import type { PythonStatus } from '@shared/ipc'
import { api, safeCall } from '../api'
import { addPredicted } from './annotations.svelte'
import { project } from './project.svelte'

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
