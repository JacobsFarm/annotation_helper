import type { TrainRun } from '@shared/ipc'
import { call } from '../services/python-service'
import { handle } from './handle'

type Input = { root: string; overrides?: Record<string, unknown>; runId?: string }

/** The command is shown before anything runs, so a training run is never a black box. */
handle('train.command', async (input: Input) => {
  const result = await call<{ command: string[] }>('train.command', {
    project: input.root,
    overrides: input.overrides
  })
  return result.command
})

handle('train.start', (input: Input) =>
  call<TrainRun>('train.start', { project: input.root, overrides: input.overrides })
)

handle('train.status', (input: Input) =>
  call<TrainRun & { tail?: string[] }>('train.status', {
    project: input.root,
    runId: input.runId
  })
)

handle('train.cancel', (input: Input) =>
  call<{ cancelled: boolean }>('train.cancel', { project: input.root, runId: input.runId })
)
