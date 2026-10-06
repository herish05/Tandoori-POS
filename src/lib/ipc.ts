import type { TandooriApi } from '@shared/api'
import type { IpcErrorCode, IpcResult } from '@shared/types'

/** Error raised when a main-process call fails. `message` is safe to show to staff. */
export class IpcError extends Error {
  constructor(
    readonly code: IpcErrorCode | 'BRIDGE_UNAVAILABLE',
    message: string,
    readonly requestId?: string
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

/** Returns the preload-exposed API or throws a readable error when running outside Electron. */
export function getApi(): TandooriApi {
  if (!window.tandoori) {
    throw new IpcError(
      'BRIDGE_UNAVAILABLE',
      'This screen must be opened inside the Tandoori-POS desktop application.'
    )
  }
  return window.tandoori
}

export async function unwrap<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call
  if (!result.ok) {
    throw new IpcError(result.error.code, result.error.message, result.error.requestId)
  }
  return result.data
}

export function toUserMessage(error: unknown): string {
  if (error instanceof IpcError) {
    return error.requestId ? `${error.message} (ref ${error.requestId})` : error.message
  }
  return 'Something went wrong. Please try again.'
}
