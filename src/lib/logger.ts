import type { LogLevel } from '@shared/types'

function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (value === undefined || value === null) return value
  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    return '[unserialisable value]'
  }
}

function send(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const api = window.tandoori
  if (!api) {
    // Plain-browser fallback (e.g. component development): console only.
    console.error(`[renderer:${level}] ${message}`, context)
    return
  }
  const safeContext = context
    ? Object.fromEntries(Object.entries(context).map(([k, v]) => [k, serialise(v)]))
    : undefined
  // Logging must never throw into UI code.
  void api.log
    .write({ channel: 'app', level, message: message.slice(0, 2000), context: safeContext })
    .catch(() => undefined)
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => {
    send('debug', message, context)
  },
  info: (message: string, context?: Record<string, unknown>) => {
    send('info', message, context)
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    send('warn', message, context)
  },
  error: (message: string, context?: Record<string, unknown>) => {
    send('error', message, context)
  }
}

/** Routes uncaught renderer errors and rejected promises into the application log. */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    logger.error('Uncaught renderer error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('Unhandled promise rejection in renderer', { reason: event.reason })
  })
}
