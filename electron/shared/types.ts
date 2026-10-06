export type AppEnv = 'development' | 'staging' | 'production'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Separate log streams so that, for example, printer faults can be diagnosed in isolation. */
export type LogChannel = 'app' | 'security' | 'sync' | 'printer' | 'database'

export interface AppInfo {
  name: string
  version: string
  env: AppEnv
  platform: string
  arch: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

export type CheckStatus = 'ok' | 'fail'

export interface HealthCheck {
  name: 'config' | 'logging' | 'storage' | 'database' | 'migrations'
  status: CheckStatus
  message: string
  details?: Record<string, string | number | boolean>
}

export interface HealthReport {
  status: 'ok' | 'failed'
  checkedAt: string
  uptimeSeconds: number
  checks: HealthCheck[]
}

/** User-editable settings persisted on the local machine (never contains secrets). */
export interface UserConfig {
  posFullscreen: boolean
  startMaximized: boolean
}

export interface WindowState {
  isMaximized: boolean
  isFullScreen: boolean
  isMinimized: boolean
}

export type IpcErrorCode =
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN_SENDER'
  | 'NOT_AVAILABLE'
  | 'DATABASE_ERROR'
  | 'INTERNAL_ERROR'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_DISABLED'
  | 'ALREADY_SETUP'

export interface IpcErrorPayload {
  code: IpcErrorCode
  /** Human-readable message that is safe to show to restaurant staff. */
  message: string
  /** Correlates with the technical details written to the application log. */
  requestId: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcErrorPayload }

export interface LogWriteInput {
  channel: LogChannel
  level: LogLevel
  message: string
  context?: Record<string, unknown> | undefined
}
