/// <reference types="electron-vite/node" />
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog, session, type BrowserWindow } from 'electron'
import { parseBuildEnv } from './config/env'
import { resolveAppPaths } from './config/paths'
import { UserConfigStore } from './config/user-config'
import type { AppContext } from './context'
import { openDatabase, type DatabaseHandle } from './db/client'
import { runMigrations } from './db/migrate'
import { ensureDeviceIdentity, SettingsRepository } from './db/settings-repository'
import { createIpcRegistrar } from './ipc/registrar'
import { registerAuthHandlers } from './auth-handlers'
import { registerMenuHandlers } from './menu-handlers'
import { registerOrderHandlers } from './order-handlers'
import { registerTableHandlers } from './table-handlers'
import { registerCoreHandlers } from './ipc/handlers'
import { LogManager } from './logging/log-manager'
import { registerAppProtocol, registerAppScheme } from './security/app-protocol'
import { createServices, type Services } from './services'
import { hardenSession, hardenWebContents } from './security/harden'
import { isTrustedRendererUrl } from './security/trusted-origin'
import { createMainWindow } from './window'

const APP_NAME = 'Tandoori-POS'
const APP_ID = 'com.tandooribites.pos'

// Must run before the app is ready.
registerAppScheme()
app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

const startedAt = Date.now()

function showFatal(title: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  dialog.showErrorBox(title, detail)
}

function initDatabase(
  ctx: Pick<AppContext, 'paths' | 'logs'>
): { handle: DatabaseHandle; deviceId: string } | { error: string } {
  const logger = ctx.logs.channel('database')
  let handle: DatabaseHandle | null = null
  try {
    handle = openDatabase(ctx.paths.database)
    const status = runMigrations(handle.db, handle.sqlite, ctx.paths.migrations)
    logger.info('Database ready', { ...status })
    const deviceId = ensureDeviceIdentity(new SettingsRepository(handle.db))
    return { handle, deviceId }
  } catch (error) {
    logger.error('Database initialisation failed', { error, path: ctx.paths.database })
    try {
      handle?.close()
    } catch (closeError) {
      logger.error('Failed to close database after initialisation error', { error: closeError })
    }
    return {
      error:
        'The local database could not be opened or updated. Your data has not been changed. Please restart the application or contact support.'
    }
  }
}

/** Wires up logging, database, security, IPC and the main window. Runs once the app is ready. */
function bootstrap(): void {
  const env = parseBuildEnv(import.meta.env)
  const devServerUrl = env.appEnv === 'production' ? undefined : process.env.ELECTRON_RENDERER_URL

  const userDataOverride =
    env.appEnv === 'production' ? undefined : process.env.TANDOORI_USER_DATA_DIR
  const userData = userDataOverride ?? app.getPath('userData')
  const migrations = app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(app.getAppPath(), 'drizzle')
  const paths = resolveAppPaths(userData, migrations)
  for (const dir of [paths.userData, paths.data, paths.logs, paths.backups]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  const logs = new LogManager({
    directory: paths.logs,
    level: env.logLevel,
    console: env.appEnv === 'development'
  })
  const appLog = logs.channel('app')
  const securityLog = logs.channel('security')

  process.on('uncaughtException', (error) => {
    appLog.error('Uncaught exception in main process', { error })
    showFatal('Tandoori-POS ran into an unexpected problem', error)
  })
  process.on('unhandledRejection', (reason) => {
    appLog.error('Unhandled promise rejection in main process', { reason })
  })
  app.on('child-process-gone', (_e, details) => {
    appLog.error('Child process gone', { ...details })
  })

  appLog.info('Starting', {
    version: app.getVersion(),
    env: env.appEnv,
    platform: process.platform,
    electron: process.versions.electron
  })

  const userConfig = new UserConfigStore(paths.userConfig, appLog)
  const dbResult = initDatabase({ paths, logs })

  let mainWindow: BrowserWindow | null = null
  const ctx: AppContext = {
    appName: APP_NAME,
    appVersion: app.getVersion(),
    env: env.appEnv,
    paths,
    logs,
    userConfig,
    startedAt,
    database: 'handle' in dbResult ? dbResult.handle : null,
    databaseError: 'error' in dbResult ? dbResult.error : null,
    deviceId: 'deviceId' in dbResult ? dbResult.deviceId : null,
    getMainWindow: () => mainWindow
  }

  hardenSession(session.defaultSession, { devServerUrl, securityLogger: securityLog })
  hardenWebContents({ devServerUrl, securityLogger: securityLog })
  if (!devServerUrl) registerAppProtocol(join(__dirname, '../renderer'))

  let services: Services | null = null
  if (ctx.database && ctx.deviceId) {
    services = createServices({
      db: ctx.database.db,
      deviceId: ctx.deviceId,
      logger: appLog,
      securityLogger: securityLog,
      allowDemoData: env.appEnv !== 'production'
    })
  }
  const authService = services?.auth

  const registrar = createIpcRegistrar({
    logger: appLog,
    securityLogger: securityLog,
    authorize: authService ? (required, options) => authService.authorize(required, options) : null,
    isTrustedSender: (event) =>
      event.senderFrame !== null &&
      event.senderFrame === event.sender.mainFrame &&
      isTrustedRendererUrl(event.senderFrame.url, devServerUrl) &&
      event.sender.id === mainWindow?.webContents.id
  })
  registerCoreHandlers(registrar, ctx)
  if (services) {
    registerAuthHandlers(registrar, services)
    registerTableHandlers(registrar, services)
    registerMenuHandlers(registrar, services)
    registerOrderHandlers(registrar, services)
  }

  mainWindow = createMainWindow(ctx, { devServerUrl })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('before-quit', () => {
    appLog.info('Shutting down')
    try {
      ctx.database?.close()
    } catch (error) {
      logs.channel('database').error('Failed to close database cleanly', { error })
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('window-all-closed', () => {
    app.quit()
  })

  void app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error('Fatal startup error', error)
      showFatal('Tandoori-POS could not start', error)
      app.exit(1)
    })
}
