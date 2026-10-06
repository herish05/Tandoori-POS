import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { integer, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

export const SYNC_STATUSES = ['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT'] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

/**
 * Columns shared by every synchronised entity.
 * - `id` is a UUID so records created on different devices never collide.
 * - `version` is incremented on every update and is used for optimistic concurrency / conflict detection.
 * - `deletedAt` implements soft delete so that deletions can be synchronised.
 * Returns fresh builders on each call (Drizzle builders must not be shared between tables).
 */
export const baseColumns = () => ({
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  version: integer('version').notNull().default(1),
  syncStatus: text('sync_status', { enum: SYNC_STATUSES }).notNull().default('PENDING')
})

/**
 * Values to merge into every UPDATE of a synchronised row: bumps the optimistic-concurrency
 * version and queues the row for the next sync.
 */
export const markModified = (table: { version: AnySQLiteColumn }) => ({
  version: sql`${table.version} + 1`,
  syncStatus: 'PENDING' as const
})
