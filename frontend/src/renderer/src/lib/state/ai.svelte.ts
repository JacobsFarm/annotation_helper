/**
 * Model-assisted prediction.
 *
 * "Python is not configured" is a first-class UI state here, not a silent failure: the
 * app stays fully usable for manual annotation without an interpreter, and the reason
 * is shown where the user can act on it.
 */

import type { Compute, PackageStatus, PythonStatus } from '@shared/ipc'
import type { PolygonShape } from '@shared/shapes'
import { api, safeCall } from '../api'
import { t } from '../i18n/index.svelte'
import { addPredicted, annotationGeneration, current } from './annotations.svelte'
import { activeClassId, project } from './project.svelte'
import { pushToast } from './toast.svelte'
import { setSmartBusy, setSmartPreview, smartClicks } from './tool.svelte'

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
  const asked = annotationGeneration()
  const result = await safeCall(() =>
    api.ai.predict({ root: open.root, file, options: open.ai })
  )
  running = false
  progress = 0

  // Automatic prediction fires on every image that opens, so the user can already be
  // two images further by the time this returns. Shapes belong to the image they were
  // asked for, and to no other.
  if (result && annotationGeneration() === asked) addPredicted(result.shapes)
}

// --- click-to-segment -------------------------------------------------------
//
// SAM prompted by clicks: point at a flower and get the flower, then correct it by
// pointing at what it got wrong. Every click re-asks with the full set of clicks, so a
// reply that arrives after a newer one has been sent is thrown away - out-of-order
// replies would otherwise show a mask that belongs to a click you already corrected.

let smartSeq = 0

/**
 * Ask for the mask that fits every click made so far, and show it as a preview. The
 * preview is not a shape yet: it becomes one when the user accepts it.
 */
export async function refineSmartSelection(): Promise<void> {
  const open = project()
  const image = current()
  const clicks = smartClicks()
  if (!open || !image || clicks.length === 0) return

  const seq = ++smartSeq
  const asked = annotationGeneration()
  setSmartBusy(true)
  const result = await safeCall(() =>
    api.ai.segmentPoint({
      root: open.root,
      file: image.imageFile,
      points: clicks.map((click) => [click.x, click.y] as [number, number]),
      labels: clicks.map((click) => (click.positive ? 1 : 0)),
      classId: activeClassId()
    })
  )
  if (seq !== smartSeq) return // a newer click already went out and owns the busy flag
  setSmartBusy(false)
  if (annotationGeneration() !== asked) return // another image opened while we waited

  if (!result) {
    // The call failed and has already said so. Keep the clicks: the usual causes are
    // a missing model or a first-use download, and both are worth a retry.
    return
  }
  // One ring per disjoint part of the mask, so a leaf that grass cuts in two is two
  // rings rather than one outline with a line drawn across the grass between them.
  const rings = result.shapes
    .filter((shape): shape is PolygonShape => shape.kind === 'polygon')
    .map((shape) => shape.points)
  setSmartPreview(rings)
  if (rings.length === 0) pushToast('info', t('annotate_smart_empty'))
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
