import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { LogChannel, LogLevel } from '@shared/types'

export interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

export interface LogManagerOptions {
  directory: string
  level: LogLevel
  /** Mirror log lines to the console (development only). */
  console?: boolean
  /** Days to keep old log files. */
  retentionDays?: number
  now?: () => Date
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|pin|cookie|credential/i
const MAX_DEPTH = 6

/** Converts arbitrary context into JSON-safe data: errors serialised, secrets redacted, cycles cut. */
export function sanitizeForLog(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause === undefined ? {} : { cause: sanitizeForLog(value.cause, depth + 1, seen) })
    }
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  if (depth >= MAX_DEPTH) return '[MaxDepth]'
  seen.add(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((v) => sanitizeForLog(v, depth + 1, seen))
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeForLog(v, depth + 1, seen)
  }
  return out
}

/**
 * Structured JSON-lines logger with one file per channel per day, e.g. `printer-2026-10-05.log`.
 * Writes are synchronous so that the last lines before a crash are never lost.
 */
export class LogManager {
  private readonly now: () => Date
  private readonly loggers = new Map<LogChannel, Logger>()

  constructor(private readonly options: LogManagerOptions) {
    this.now = options.now ?? (() => new Date())
    mkdirSync(options.directory, { recursive: true })
    this.pruneOldFiles()
  }

  get directory(): string {
    return this.options.directory
  }

  channel(channel: LogChannel): Logger {
    let logger = this.loggers.get(channel)
    if (!logger) {
      const write = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
        this.write(channel, level, message, context)
      }
      logger = {
        debug: (m, c) => {
          write('debug', m, c)
        },
        info: (m, c) => {
          write('info', m, c)
        },
        warn: (m, c) => {
          write('warn', m, c)
        },
        error: (m, c) => {
          write('error', m, c)
        }
      }
      this.loggers.set(channel, logger)
    }
    return logger
  }

  write(
    channel: LogChannel,
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.options.level]) return

    const timestamp = this.now()
    const entry = {
      ts: timestamp.toISOString(),
      level,
      channel,
      message,
      ...(context === undefined ? {} : { context: sanitizeForLog(context) })
    }
    const line = JSON.stringify(entry)

    try {
      appendFileSync(join(this.options.directory, this.fileName(channel, timestamp)), `${line}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
    } catch (error) {
      // Logging must never take the POS down; fall back to stderr so the failure is still visible.
      console.error('[logging] failed to write log file', error)
    }

    if (this.options.console) {
      const sink = level === 'error' ? console.error : console.warn
      sink(`[${channel}] ${level.toUpperCase()} ${message}`, context ?? '')
    }
  }

  private fileName(channel: LogChannel, date: Date): string {
    return `${channel}-${date.toISOString().slice(0, 10)}.log`
  }

  private pruneOldFiles(): void {
    const retentionMs = (this.options.retentionDays ?? 30) * 24 * 60 * 60 * 1000
    const cutoff = this.now().getTime() - retentionMs
    try {
      for (const name of readdirSync(this.options.directory)) {
        if (!name.endsWith('.log')) continue
        const full = join(this.options.directory, name)
        if (statSync(full).mtimeMs < cutoff) unlinkSync(full)
      }
    } catch (error) {
      console.error('[logging] failed to prune old logs', error)
    }
  }
}
