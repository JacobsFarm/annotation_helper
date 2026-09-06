import { app, BrowserWindow } from 'electron'
import { broadcast, registerIpc } from './ipc'
import { handleProtocol, registerScheme } from './protocol'
import { onPackageEvent } from './services/package-service'
import { onSidecarEvent, probe, stop } from './services/python-service'
import { createWindow } from './window'

// Must happen before `whenReady`: Electron refuses to register a scheme after that.
registerScheme()

// One instance only. A second launch focuses the window that is already open, rather
// than opening a second view onto the same label files.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  void app.whenReady().then(async () => {
    handleProtocol()
    registerIpc()
    relaySidecarEvents()
    relayPackageEvents()
    createWindow()

    // Probe in the background: a missing interpreter must not delay the first frame.
    // The result is logged because "Python is not configured" is the single most likely
    // support question, and the console says which candidate answered.
    void probe().then((status) => {
      console.log(
        '[python]',
        status.available ? `ready via ${status.executable}` : `unavailable (${status.reason})`
      )
      broadcast({ type: 'python:status', status })
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

/** Translate sidecar frames into the renderer's event vocabulary, in one place. */
function relaySidecarEvents(): void {
  onSidecarEvent((event) => {
    switch (event.event) {
      case 'progress':
        broadcast({
          type: 'predict:progress',
          requestId: event.id,
          stage: String(event.stage ?? ''),
          pct: Number(event.pct ?? 0)
        })
        break
      case 'train_output':
        broadcast({
          type: 'train:output',
          runId: String(event.runId ?? ''),
          line: String(event.line ?? ''),
          epoch: Number(event.epoch ?? 0),
          epochs: Number(event.epochs ?? 0)
        })
        break
      case 'train_done':
        broadcast({
          type: 'train:done',
          runId: String(event.runId ?? ''),
          exitCode: Number(event.exitCode ?? 0)
        })
        break
      default:
        break // 'ready' and anything newer: nothing to relay yet
    }
  })
}

/**
 * The package installer's output, on its way to the renderer.
 *
 * Here rather than in the service, for the same reason as above: the service stays free
 * of an import from `ipc/`, and the renderer's event vocabulary is defined in one place.
 * A finished install also re-broadcasts the engine status, because installing torch is
 * exactly the thing that turns "prediction is off" into "prediction is on".
 */
function relayPackageEvents(): void {
  onPackageEvent((event) => {
    if ('done' in event) {
      broadcast({ type: 'packages:done', ok: event.ok, detail: event.detail })
      void probe().then((status) => broadcast({ type: 'python:status', status }))
    } else {
      broadcast({ type: 'packages:output', line: event.line })
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void stop()
})
