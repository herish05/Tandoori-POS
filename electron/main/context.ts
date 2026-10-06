import type { BrowserWindow } from 'electron'
import type { AppEnv } from '@shared/types'
import type { AppPaths } from './config/paths'
import type { UserConfigStore } from './config/user-config'
import type { DatabaseHandle } from './db/client'
import type { LogManager } from './logging/log-manager'

/** Everything the main process services need, passed explicitly instead of via globals. */
export interface AppContext {
  appName: string
  appVersion: string
  env: AppEnv
  paths: AppPaths
  logs: LogManager
  userConfig: UserConfigStore
  startedAt: number
  database: DatabaseHandle | null
  databaseError: string | null
  deviceId: string | null
  getMainWindow: () => BrowserWindow | null
}
