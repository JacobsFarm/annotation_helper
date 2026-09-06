/**
 * The bridge. Built as CJS, runs sandboxed, and contains no logic at all.
 *
 * It deliberately exposes the raw envelope rather than a typed, throwing API. Electron's
 * context bridge clones values across the boundary and keeps only `message` and `stack`
 * of an Error, so a code thrown here would arrive stripped of the very field the UI needs
 * to translate it. Returning `{ok:false,error}` crosses intact; `src/renderer/src/lib/api`
 * turns it back into a real `ApiError` on the other side, where nothing is lost.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type AppEvent, type Bridge, type IpcResult } from '@shared/ipc'

const bridge: Bridge = {
  invoke(method: string, params?: unknown): Promise<IpcResult<unknown>> {
    return ipcRenderer.invoke(CHANNELS.invoke, method, params)
  },
  on(handler: (event: AppEvent) => void): () => void {
    const listener = (_event: unknown, payload: AppEvent): void => handler(payload)
    ipcRenderer.on(CHANNELS.event, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.event, listener)
    }
  }
}

contextBridge.exposeInMainWorld('bridge', bridge)
