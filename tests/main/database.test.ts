import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DatabaseHandle } from '@main/db/client'
import { countExpectedMigrations, runMigrations } from '@main/db/migrate'
import {
  ensureDeviceIdentity,
  SettingsRepository,
  SETTING_KEYS
} from '@main/db/settings-repository'
import { buildHealthReport } from '@main/health/health'

const MIGRATIONS = resolve(__dirname, '../../drizzle')

describe('database foundation', () => {
  let dir: string
  let handle: DatabaseHandle

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tpos-db-'))
    handle = openDatabase(join(dir, 'test.db'))
  })
  afterEach(() => {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('opens with WAL and foreign keys enabled', () => {
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('applies all migrations and is idempotent', () => {
    const first = runMigrations(handle.db, handle.sqlite, MIGRATIONS)
    expect(first.applied).toBe(first.expected)
    expect(first.expected).toBe(countExpectedMigrations(MIGRATIONS))
    const second = runMigrations(handle.db, handle.sqlite, MIGRATIONS)
    expect(second).toEqual(first)
  })

  it('fails loudly when the migrations folder is missing', () => {
    expect(() => runMigrations(handle.db, handle.sqlite, join(dir, 'nope'))).toThrow(
      /journal not found/i
    )
  })

  it('stores settings with versioning and sync metadata', () => {
    runMigrations(handle.db, handle.sqlite, MIGRATIONS)
    const repo = new SettingsRepository(handle.db)
    repo.set('example', { a: 1 })
    repo.set('example', { a: 2 })
    expect(repo.get('example')).toEqual({ a: 2 })
    const row = handle.sqlite.prepare('SELECT * FROM settings WHERE key = ?').get('example') as {
      version: number
      sync_status: string
      id: string
    }
    expect(row.version).toBe(2)
    expect(row.sync_status).toBe('PENDING')
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('creates a stable device identity exactly once', () => {
    runMigrations(handle.db, handle.sqlite, MIGRATIONS)
    const repo = new SettingsRepository(handle.db)
    const first = ensureDeviceIdentity(repo)
    expect(ensureDeviceIdentity(repo)).toBe(first)
    expect(repo.get(SETTING_KEYS.deviceId)).toBe(first)
  })

  describe('health report', () => {
    const paths = () => ({ data: dir, logs: dir, migrations: MIGRATIONS })

    it('is ok for a migrated database', () => {
      runMigrations(handle.db, handle.sqlite, MIGRATIONS)
      const report = buildHealthReport({
        startedAt: Date.now(),
        paths: paths(),
        database: handle,
        databaseError: null
      })
      expect(report.checks.filter((c) => c.status === 'fail')).toEqual([])
      expect(report.status).toBe('ok')
    })

    it('flags an unmigrated database', () => {
      const report = buildHealthReport({
        startedAt: Date.now(),
        paths: paths(),
        database: handle,
        databaseError: null
      })
      expect(report.status).toBe('failed')
      expect(report.checks.find((c) => c.name === 'migrations')?.status).toBe('fail')
    })

    it('reports a failed database start-up with a staff-friendly message', () => {
      const report = buildHealthReport({
        startedAt: Date.now(),
        paths: paths(),
        database: null,
        databaseError: 'The local database could not be opened.'
      })
      expect(report.status).toBe('failed')
      expect(report.checks.find((c) => c.name === 'database')?.message).toBe(
        'The local database could not be opened.'
      )
    })
  })
})
