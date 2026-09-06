import type { ImageAnnotation } from '@shared/shapes'
import { readAnnotation, writeAnnotation } from '../services/label-service'
import { openProject } from '../services/project-service'
import { handle } from './handle'

handle('labels.read', async (input: { root: string; file: string }) =>
  readAnnotation(await openProject(input.root), input.file)
)

handle('labels.write', async (input: { root: string; annotation: ImageAnnotation }) =>
  writeAnnotation(await openProject(input.root), input.annotation)
)
