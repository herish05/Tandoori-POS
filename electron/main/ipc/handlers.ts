import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { emptyInputSchema, logWriteSchema, userConfigPatchSchema } from '@shared/schemas'
import type { AppInfo, WindowState } from '@shared/types'
import type { AppContext } from '../context'
import { buildHealthReport } from '../health/health'
import { AppError } from './errors'
import type { IpcRegistrar } from './registrar'

export function windowStateOf(win: BrowserWindow): WindowState {
  return {
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
    isMinimized: win.isMinimized()
  }
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new AppError('NOT_AVAILABLE', 'The application window is not available.')
  return win
}

export function registerCoreHandlers(registrar: IpcRegistrar, ctx: AppContext): void {
  registrar.handle(IPC_CHANNELS.appGetInfo, emptyInputSchema, (): AppInfo => ({
    name: ctx.appName,
    version: ctx.appVersion,
    env: ctx.env,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node
  }))

  registrar.handle(IPC_CHANNELS.healthCheck, emptyInputSchema, () =>
    buildHealthReport({
      startedAt: ctx.startedAt,
      paths: ctx.paths,
      database: ctx.database,
      databaseError: ctx.databaseError
    })
  )

  registrar.handle(IPC_CHANNELS.configGet, emptyInputSchema, () => ctx.userConfig.get())

  registrar.handle(IPC_CHANNELS.configUpdate, userConfigPatchSchema, (patch) => {
    const updated = ctx.userConfig.update(patch)
    if (patch.posFullscreen !== undefined) {
      ctx.getMainWindow()?.setFullScreen(updated.posFullscreen)
    }
    ctx.logs.channel('app').info('User configuration updated', { changed: Object.keys(patch) })
    return updated
  })

  registrar.handle(IPC_CHANNELS.windowGetState, emptyInputSchema, (_, event) =>
    windowStateOf(senderWindow(event))
  )

  registrar.handle(IPC_CHANNELS.windowMinimize, emptyInputSchema, (_, event) => {
    senderWindow(event).minimize()
    return null
  })

  registrar.handle(IPC_CHANNELS.windowToggleMaximize, emptyInputSchema, (_, event) => {
    const win = senderWindow(event)
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return windowStateOf(win)
  })

  registrar.handle(IPC_CHANNELS.windowToggleFullscreen, emptyInputSchema, (_, event) => {
    const win = senderWindow(event)
    win.setFullScreen(!win.isFullScreen())
    return windowStateOf(win)
  })

  registrar.handle(IPC_CHANNELS.windowClose, emptyInputSchema, (_, event) => {
    senderWindow(event).close()
    return null
  })

  // Renderer-originated entries are tagged so they can be told apart from main-process entries,
  // and capped so a misbehaving renderer cannot flood the disk.
  const logWindow = { start: 0, count: 0 }
  registrar.handle(IPC_CHANNELS.logWrite, logWriteSchema, (entry) => {
    const now = Date.now()
    if (now - logWindow.start >= 1000) {
      logWindow.start = now
      logWindow.count = 0
    }
    logWindow.count += 1
    if (logWindow.count > 50) return null

    ctx.logs.write(entry.channel, entry.level, entry.message, {
      ...(entry.context ?? {}),
      source: 'renderer'
    })
    return null
  })
}
