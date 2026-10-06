import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { AppContext } from './context'
import { windowStateOf } from './ipc/handlers'
import { APP_HOST, APP_PROTOCOL } from './security/trusted-origin'

export interface WindowOptions {
  devServerUrl: string | undefined
}

export function createMainWindow(ctx: AppContext, options: WindowOptions): BrowserWindow {
  const logger = ctx.logs.channel('app')
  const config = ctx.userConfig.get()

  const win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: ctx.appName,
    backgroundColor: '#0f1b2d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => {
    if (config.startMaximized) win.maximize()
    if (config.posFullscreen) win.setFullScreen(true)
    win.show()
  })

  const pushState = (): void => {
    if (!win.isDestroyed())
      win.webContents.send(IPC_CHANNELS.windowStateChanged, windowStateOf(win))
  }
  win.on('maximize', pushState)
  win.on('unmaximize', pushState)
  win.on('minimize', pushState)
  win.on('restore', pushState)
  win.on('enter-full-screen', pushState)
  win.on('leave-full-screen', pushState)

  win.webContents.on('did-fail-load', (_e, code, description, url) => {
    logger.error('Renderer failed to load', { code, description, url })
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logger.error('Renderer process gone', { reason: details.reason, exitCode: details.exitCode })
  })
  win.on('unresponsive', () => {
    logger.warn('Window became unresponsive')
  })

  const entry = options.devServerUrl ?? `${APP_PROTOCOL}://${APP_HOST}/index.html`
  void win.loadURL(entry).catch((error: unknown) => {
    logger.error('Failed to load renderer entry', { entry, error })
  })

  return win
}
