import { app, shell } from 'electron'
import type { AppSettings } from '@shared/ipc'
import { loadSettings, saveSettings } from '../services/settings-service'
import { handle } from './handle'

handle('app.info', () => ({ version: app.getVersion(), platform: process.platform }))

handle('app.getSettings', () => loadSettings())

handle('app.saveSettings', (patch: Partial<AppSettings>) => saveSettings(patch))

handle('app.openPath', async (target: string) => {
  await shell.openPath(target)
})
