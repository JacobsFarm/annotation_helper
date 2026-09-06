/**
 * The training run in progress, and its output.
 *
 * The log is capped: a hundred epochs print tens of thousands of lines and keeping all
 * of them in a reactive array would eventually stall the renderer.
 */

import type { TrainRun } from '@shared/ipc'
import { api, safeCall } from '../api'

const LOG_LIMIT = 400

let run = $state<TrainRun | null>(null)
let log = $state<string[]>([])
let epoch = $state(0)
let epochs = $state(0)
let command = $state<string[]>([])

export function currentRun(): TrainRun | null {
  return run
}

export function trainLog(): string[] {
  return log
}

export function trainEpoch(): number {
  return epoch
}

export function trainEpochs(): number {
  return epochs
}

export function trainCommand(): string[] {
  return command
}

export function isTraining(): boolean {
  return run !== null && !run.finished
}

export function appendTrainLine(line: string, atEpoch: number, ofEpochs: number): void {
  log = [...log, line].slice(-LOG_LIMIT)
  if (atEpoch > 0) epoch = atEpoch
  if (ofEpochs > 0) epochs = ofEpochs
}

export function finishRun(exitCode: number): void {
  if (run) run = { ...run, finished: true, running: false, exitCode }
}

export async function loadCommand(root: string, overrides?: Record<string, unknown>): Promise<void> {
  const result = await safeCall(() => api.train.command({ root, overrides }))
  if (result) command = result
}

export async function startTraining(
  root: string,
  overrides?: Record<string, unknown>
): Promise<boolean> {
  const started = await safeCall(() => api.train.start({ root, overrides }))
  if (!started) return false
  run = started
  log = []
  epoch = 0
  epochs = started.epochs
  return true
}

export async function cancelTraining(root: string): Promise<void> {
  if (!run) return
  await safeCall(() => api.train.cancel({ root, runId: run!.id }))
}
