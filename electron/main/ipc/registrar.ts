import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import type { IpcChannel } from '@shared/ipc-channels'
import type { PermissionCode } from '@shared/permissions'
import type { IpcResult } from '@shared/types'
import type { AuthContext, Authorize } from '../auth/types'
import type { Logger } from '../logging/log-manager'
import { AppError, mapError } from './errors'

export interface ProtectedOptions {
  /** Every listed permission is required. An empty list means "any signed-in user". */
  permissions?: readonly PermissionCode[]
  /** Only the change-password call sets this: it must work while a password change is pending. */
  allowPasswordChange?: boolean
}

export interface IpcRegistrar {
  /**
   * Registers a validated request/response handler that anyone may call (start-up checks,
   * window controls, sign-in). Every call: (1) verifies the sender frame, (2) validates input
   * with Zod, (3) runs the handler, (4) converts failures into a staff-friendly `IpcResult`
   * while logging the technical detail.
   */
  handle: <TInput, TOutput>(
    channel: IpcChannel,
    inputSchema: z.ZodType<TInput>,
    handler: (input: TInput, event: IpcMainInvokeEvent) => TOutput | Promise<TOutput>
  ) => void
  /**
   * Same as `handle`, but runs the permission middleware first: no live session means
   * `UNAUTHENTICATED`/`SESSION_EXPIRED`, a missing permission means `FORBIDDEN` (and an audit
   * entry). The handler receives the verified caller.
   */
  handleProtected: <TInput, TOutput>(
    channel: IpcChannel,
    inputSchema: z.ZodType<TInput>,
    options: ProtectedOptions,
    handler: (
      input: TInput,
      auth: AuthContext,
      event: IpcMainInvokeEvent
    ) => TOutput | Promise<TOutput>
  ) => void
}

export interface RegistrarOptions {
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  logger: Logger
  securityLogger: Logger
  /** Null until the database (and therefore the auth service) is available. */
  authorize: Authorize | null
}

export function createIpcRegistrar(options: RegistrarOptions): IpcRegistrar {
  const register = <TInput, TOutput>(
    channel: IpcChannel,
    inputSchema: z.ZodType<TInput>,
    protection: ProtectedOptions | null,
    run: (
      input: TInput,
      auth: AuthContext | null,
      event: IpcMainInvokeEvent
    ) => TOutput | Promise<TOutput>
  ): void => {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<unknown>> => {
      if (!options.isTrustedSender(event)) {
        options.securityLogger.error('Rejected IPC call from untrusted sender', {
          channel,
          url: event.senderFrame?.url
        })
        const mapped = mapError(new AppError('FORBIDDEN_SENDER', 'This action is not permitted.'))
        return { ok: false, error: mapped.payload }
      }

      try {
        // Authorise before looking at the input, so callers who are not signed in learn nothing.
        let auth: AuthContext | null = null
        if (protection) {
          if (!options.authorize) {
            throw new AppError('NOT_AVAILABLE', 'This feature is not available right now.')
          }
          auth = options.authorize(protection.permissions ?? [], {
            allowPasswordChange: protection.allowPasswordChange ?? false
          })
        }
        const input = inputSchema.parse(raw)
        const data = await run(input, auth, event)
        return { ok: true, data }
      } catch (error) {
        const mapped = mapError(error)
        // Expected refusals (wrong password, no permission) are warnings; anything else is a fault.
        const message = `IPC handler failed: ${channel}`
        const details = {
          requestId: mapped.payload.requestId,
          code: mapped.payload.code,
          error: mapped.technical
        }
        if (error instanceof AppError) options.logger.warn(message, details)
        else options.logger.error(message, details)
        return { ok: false, error: mapped.payload }
      }
    })
  }

  return {
    handle: (channel, inputSchema, handler) => {
      register(channel, inputSchema, null, (input, _auth, event) => handler(input, event))
    },
    handleProtected: (channel, inputSchema, protection, handler) => {
      register(channel, inputSchema, protection, (input, auth, event) => {
        if (!auth) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.')
        return handler(input, auth, event)
      })
    }
  }
}
