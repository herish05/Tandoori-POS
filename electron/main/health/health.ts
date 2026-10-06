import { accessSync, constants, existsSync, statSync } from 'node:fs'
import type { HealthCheck, HealthReport } from '@shared/types'
import type { DatabaseHandle } from '../db/client'
import { countAppliedMigrations, countExpectedMigrations } from '../db/migrate'

export interface HealthDeps {
  startedAt: number
  paths: { data: string; logs: string; migrations: string }
  /** Null when the database failed to initialise at startup. */
  database: DatabaseHandle | null
  /** Why startup failed, if it did. Shown (technical detail stays in logs). */
  databaseError: string | null
  now?: () => number
}

function check(name: HealthCheck['name'], fn: () => Omit<HealthCheck, 'name'>): HealthCheck {
  try {
    return { name, ...fn() }
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

function checkWritable(dir: string, label: string): Omit<HealthCheck, 'name'> {
  if (!existsSync(dir)) return { status: 'fail', message: `${label} folder is missing` }
  accessSync(dir, constants.R_OK | constants.W_OK)
  return { status: 'ok', message: `${label} folder is readable and writable` }
}

export function buildHealthReport(deps: HealthDeps): HealthReport {
  const now = (deps.now ?? Date.now)()
  const { database } = deps

  const checks: HealthCheck[] = [
    { name: 'config', status: 'ok', message: 'Configuration loaded' },
    check('logging', () => checkWritable(deps.paths.logs, 'Log')),
    check('storage', () => checkWritable(deps.paths.data, 'Data')),
    check('database', () => {
      if (!database) {
        return {
          status: 'fail',
          message: deps.databaseError ?? 'The local database is not available'
        }
      }
      database.sqlite.prepare('SELECT 1').get()
      const journalMode = String(database.sqlite.pragma('journal_mode', { simple: true }))
      const foreignKeys = database.sqlite.pragma('foreign_keys', { simple: true }) === 1
      const integrity = String(database.sqlite.pragma('quick_check', { simple: true }))
      const sizeBytes = database.path === ':memory:' ? 0 : statSync(database.path).size
      return {
        status: integrity === 'ok' && foreignKeys ? 'ok' : 'fail',
        message:
          integrity === 'ok'
            ? 'Local database is healthy'
            : 'Local database integrity check failed',
        details: { journalMode, foreignKeys, integrity, sizeBytes }
      }
    }),
    check('migrations', () => {
      if (!database) return { status: 'fail', message: 'Database unavailable' }
      const expected = countExpectedMigrations(deps.paths.migrations)
      const applied = countAppliedMigrations(database.sqlite)
      return {
        status: applied === expected ? 'ok' : 'fail',
        message:
          applied === expected
            ? 'Database schema is up to date'
            : `Database schema is out of date (${applied.toString()} of ${expected.toString()} applied)`,
        details: { applied, expected }
      }
    })
  ]

  return {
    status: checks.every((c) => c.status === 'ok') ? 'ok' : 'failed',
    checkedAt: new Date(now).toISOString(),
    uptimeSeconds: Math.max(0, Math.round((now - deps.startedAt) / 1000)),
    checks
  }
}
