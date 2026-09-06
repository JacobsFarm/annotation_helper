import { trashImage, undoLast } from '../services/file-ops'
import { openProject } from '../services/project-service'
import { handle } from './handle'

handle('files.trash', async (input: { root: string; file: string }) =>
  trashImage(await openProject(input.root), input.file)
)

handle('files.undo', (root: string) => undoLast(root))
