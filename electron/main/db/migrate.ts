import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { AppDatabase } from './client'
import type { Database } from 'better-sqlite3'

export interface MigrationStatus {
  /** Number of migrations recorded as applied in the database. */
  applied: number
  /** Number of migrations shipped with this build of the application. */
  expected: number
}

interface JournalFile {
  entries: unknown[]
}

/** Counts the migrations shipped with this build (from the Drizzle journal). */
export function countExpectedMigrations(migrationsFolder: string): number {
  const journalPath = join(migrationsFolder, 'meta', '_journal.json')
  if (!existsSync(journalPath)) {
    throw new Error(`Migration journal not found at ${journalPath}`)
  }
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as JournalFile
  return journal.entries.length
}

export function countAppliedMigrations(sqlite: Database): number {
  const table = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
    )
    .get()
  if (!table) return 0
  const row = sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as {
    count: number
  }
  return row.count
}

/**
 * Applies any pending migrations inside Drizzle's migrator transaction.
 * Throws if the migrations folder is missing, so a broken install is reported instead of ignored.
 */
export function runMigrations(
  db: AppDatabase,
  sqlite: Database,
  migrationsFolder: string
): MigrationStatus {
  const expected = countExpectedMigrations(migrationsFolder)
  migrate(db, { migrationsFolder })
  return { applied: countAppliedMigrations(sqlite), expected }
}
