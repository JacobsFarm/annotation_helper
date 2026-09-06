import type { HealthReport, SplitResult } from '@shared/ipc'
import { listDataset } from '../services/dataset-service'
import { openProject, writeClassesTxt, writeDataYaml } from '../services/project-service'
import { call } from '../services/python-service'
import { handle } from './handle'

/** Scanning is local: the file list must not depend on an interpreter being present. */
handle('dataset.list', async (root: string) => listDataset(await openProject(root)))

/** The heavier passes are the Python implementation, so CLI and GUI cannot disagree. */
handle('dataset.check', (root: string) => call<HealthReport>('dataset.check', { project: root }))

handle(
  'dataset.split',
  (input: { root: string; mode: string; includeUnlabelled: boolean; output?: string }) =>
    call<SplitResult>('dataset.split', {
      project: input.root,
      mode: input.mode,
      includeUnlabelled: input.includeUnlabelled,
      output: input.output
    })
)

handle('dataset.exportConfig', async (root: string) => {
  const project = await openProject(root)
  return { classesTxt: await writeClassesTxt(project), dataYaml: await writeDataYaml(project) }
})
