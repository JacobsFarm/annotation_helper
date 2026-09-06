import { dialog } from 'electron'
import { handle } from './handle'

handle('dialog.chooseDirectory', async (title?: string) => {
  const result = await dialog.showOpenDialog({
    title,
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled ? null : (result.filePaths[0] ?? null)
})

handle('dialog.chooseFile', async (filters?: { name: string; extensions: string[] }[]) => {
  const result = await dialog.showOpenDialog({ filters, properties: ['openFile'] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
})
