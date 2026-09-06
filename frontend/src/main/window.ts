import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#101511',
    autoHideMenuBar: true,
    title: 'Annotation Helper',
    webPreferences: {
      // The preload is built as CJS precisely so this can stay true.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.cjs')
    }
  })

  // Show only once the first frame is painted, so there is no white flash.
  window.once('ready-to-show', () => window.show())

  // A link to the outside world opens in the user's browser, never in the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) {
    void window.loadURL(devServer)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
