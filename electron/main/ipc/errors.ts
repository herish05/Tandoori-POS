import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import type { IpcErrorCode, IpcErrorPayload } from '@shared/types'

/** An error whose message is safe to show to restaurant staff. */
export class AppError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    userMessage: string,
    options?: { cause?: unknown }
  ) {
    super(userMessage, options)
    this.name = 'AppError'
  }
}

export interface MappedError {
  payload: IpcErrorPayload
  /** Technical details for the log only. */
  technical: unknown
}

/**
 * Converts any thrown value into a staff-friendly payload plus a request id.
 * The request id lets support staff match the on-screen message to the log entry.
 */
export function mapError(error: unknown): MappedError {
  const requestId = randomUUID().slice(0, 8)

  if (error instanceof AppError) {
    return {
      payload: { code: error.code, message: error.message, requestId },
      technical: error
    }
  }
  if (error instanceof ZodError) {
    return {
      payload: {
        code: 'VALIDATION_ERROR',
        message: 'The information provided is not valid. Please check it and try again.',
        requestId
      },
      technical: error
    }
  }
  return {
    payload: {
      code: 'INTERNAL_ERROR',
      message: `Something went wrong. Please try again, or contact support and quote reference ${requestId}.`,
      requestId
    },
    technical: error
  }
}
