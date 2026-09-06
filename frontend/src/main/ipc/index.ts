/**
 * The single `invoke` entry point.
 *
 * One channel, one dispatcher, one envelope. Electron turns a rejected `invoke` into
 * the opaque string "Error invoking remote method", so nothing here is allowed to
 * reject: every outcome becomes `{ok:true,data}` or `{ok:false,error}` and the preload
 * turns the second form back into a real, readable error.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { CHANNELS, ERROR_CODES, type AppEvent, type IpcResult } from '@shared/ipc'
import { toFailure } from '../services/errors'
import { lookup } from './handle'

import './app.ipc'
import './dialog.ipc'
import './project.ipc'
import './dataset.ipc'
import './labels.ipc'
import './files.ipc'
import './ai.ipc'
import './train.ipc'

export function registerIpc(): void {
  ipcMain.handle(
    CHANNELS.invoke,
    async (_event, method: string, params: unknown): Promise<IpcResult<unknown>> => {
      const handler = lookup(method)
      if (!handler) {
        return {
          ok: false,
          error: { code: ERROR_CODES.unknownMethod, message: 'unknown method', detail: method }
        }
      }
      try {
        return { ok: true, data: await handler(params) }
      } catch (error) {
        console.error(`[ipc] ${method}`, error)
        return { ok: false, error: toFailure(error) }
      }
    }
  )
}

/** Push an event to every open window. Events are one-way; they carry no reply. */
export function broadcast(event: AppEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.event, event)
  }
}
