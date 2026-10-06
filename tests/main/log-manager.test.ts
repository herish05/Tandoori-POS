import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LogManager, sanitizeForLog } from '@main/logging/log-manager'

describe('sanitizeForLog', () => {
  it('redacts sensitive keys at any depth', () => {
    const out = sanitizeForLog({
      user: 'asha',
      password: 'hunter2',
      nested: { refreshToken: 'abc', Authorization: 'Bearer x', ok: 1 }
    })
    expect(out).toEqual({
      user: 'asha',
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', Authorization: '[REDACTED]', ok: 1 }
    })
  })

  it('serialises errors and survives circular references', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    const out = sanitizeForLog({ error: new Error('boom'), circular }) as {
      error: { message: string; stack: string }
      circular: { self: string }
    }
    expect(out.error.message).toBe('boom')
    expect(out.circular.self).toBe('[Circular]')
  })
})

describe('LogManager', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tpos-logs-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes JSON lines into one file per channel', () => {
    const logs = new LogManager({
      directory: dir,
      level: 'info',
      now: () => new Date('2026-10-05T10:00:00.000Z')
    })
    logs.channel('printer').error('Kitchen printer unavailable', { printer: 'kitchen-1' })
    logs.channel('sync').info('Sync started')

    expect(readdirSync(dir).sort()).toEqual(['printer-2026-10-05.log', 'sync-2026-10-05.log'])
    const line = JSON.parse(readFileSync(join(dir, 'printer-2026-10-05.log'), 'utf8').trim()) as {
      level: string
      channel: string
      message: string
      context: { printer: string }
    }
    expect(line).toMatchObject({
      level: 'error',
      channel: 'printer',
      message: 'Kitchen printer unavailable',
      context: { printer: 'kitchen-1' }
    })
  })

  it('filters entries below the configured level', () => {
    const logs = new LogManager({ directory: dir, level: 'warn' })
    logs.channel('app').info('ignored')
    logs.channel('app').debug('ignored')
    logs.channel('app').warn('kept')
    const [file] = readdirSync(dir)
    const lines = readFileSync(join(dir, file ?? ''), 'utf8')
      .trim()
      .split('\n')
    expect(lines).toHaveLength(1)
  })

  it('prunes log files older than the retention period', () => {
    const old = join(dir, 'app-2020-01-01.log')
    writeFileSync(old, 'x')
    const past = new Date('2020-01-01T00:00:00Z')
    utimesSync(old, past, past)
    new LogManager({ directory: dir, level: 'info', retentionDays: 30 })
    expect(readdirSync(dir)).not.toContain('app-2020-01-01.log')
  })
})
