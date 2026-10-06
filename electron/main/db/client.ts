import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type AppDatabase = BetterSQLite3Database<typeof schema>

/** A database or an open transaction: services accept either so they compose inside transactions. */
export type DbExecutor = AppDatabase | Parameters<Parameters<AppDatabase['transaction']>[0]>[0]

export interface DatabaseHandle {
  /** Raw connection: only for PRAGMAs, health checks and backups. Business code uses `db`. */
  sqlite: Database.Database
  db: AppDatabase
  path: string
  close: () => void
}

/**
 * Opens (creating if necessary) the local SQLite database with settings suited to a POS:
 * - WAL: readers never block the writer, and a crash cannot corrupt committed data.
 * - synchronous=NORMAL is safe with WAL; FULL is used for durability of financial records.
 * - foreign_keys=ON so relational integrity is enforced by the database.
 */
export function openDatabase(path: string): DatabaseHandle {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = FULL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')

  const db = drizzle(sqlite, { schema })

  return {
    sqlite,
    db,
    path,
    close: () => {
      if (sqlite.open) {
        try {
          sqlite.pragma('wal_checkpoint(TRUNCATE)')
        } finally {
          sqlite.close()
        }
      }
    }
  }
}
