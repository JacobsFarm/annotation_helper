import type { Compute, PredictRequest, PredictResult } from '@shared/ipc'
import { cancelInstall, installPackages, packageStatus } from '../services/package-service'
import { openProject } from '../services/project-service'
import { imagePathFor } from '../services/paths'
import { call, cancel, peekNextId, probe, restart } from '../services/python-service'
import { handle } from './handle'

/**
 * The id of the prediction currently in flight.
 *
 * Cancellation is cooperative: the sidecar checks it at each progress checkpoint. One
 * prediction at a time is enough - the user is looking at one image.
 */
let inFlight: string | null = null

handle('ai.status', () => probe())

handle('ai.restart', () => restart())

handle('ai.predict', async (input: PredictRequest): Promise<PredictResult> => {
  const project = await openProject(input.root)
  inFlight = peekNextId()
  try {
    return await call<PredictResult>('predict', {
      image: imagePathFor(project, input.file),
      ...input.options
    })
  } finally {
    inFlight = null
  }
})

handle('ai.cancel', async () => {
  if (inFlight) await cancel(inFlight)
})

handle('ai.packages', () => packageStatus())

handle('ai.install', (input: { compute: Compute }) => installPackages(input.compute))

handle('ai.cancelInstall', () => cancelInstall())
