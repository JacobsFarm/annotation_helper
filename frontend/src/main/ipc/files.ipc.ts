import type { ImageArea } from '@shared/ipc'
import { emptyRecycle, recycleStatus, trashImage, undoLast } from '../services/file-ops'
import { openProject } from '../services/project-service'
import { handle } from './handle'

handle('files.trash', async (input: { root: string; file: string; area?: ImageArea }) =>
  trashImage(await openProject(input.root), input.file, input.area)
)

handle('files.undo', (root: string) => undoLast(root))

handle('files.recycle', async (root: string) => recycleStatus(await openProject(root)))

/** Deliberate and permanent. The renderer confirms before it gets here. */
handle('files.emptyRecycle', async (root: string) => emptyRecycle(await openProject(root)))
