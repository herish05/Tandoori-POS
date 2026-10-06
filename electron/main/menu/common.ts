import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext } from '../auth/types'
import type { DbExecutor } from '../db/client'
import { AppError } from '../ipc/errors'

/** The columns every named, restaurant-owned, soft-deletable menu table has. */
export interface NamedTableSpec {
  table: SQLiteTable
  id: AnySQLiteColumn
  name: AnySQLiteColumn
  restaurantId: AnySQLiteColumn
  deletedAt: AnySQLiteColumn
}

/** Names are unique per restaurant ignoring case, among rows that are not deleted. */
export function assertNameFree(
  db: DbExecutor,
  spec: NamedTableSpec,
  restaurantId: string,
  name: string,
  what: string,
  exceptId?: string
): void {
  const clash = db
    .select({ id: spec.id })
    .from(spec.table)
    .where(
      and(
        eq(spec.restaurantId, restaurantId),
        isNull(spec.deletedAt),
        sql`lower(${spec.name}) = ${name.toLowerCase()}`,
        exceptId ? ne(spec.id, exceptId) : undefined
      )
    )
    .get()
  if (clash) throw new AppError('CONFLICT', `${what} named "${name}" already exists.`)
}

export function recordMenuAudit(
  audit: AuditService,
  tx: DbExecutor,
  auth: AuthContext,
  action: AuditAction,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>
): void {
  audit.record(
    {
      action,
      userId: auth.userId,
      username: auth.username,
      entityType,
      entityId,
      details
    },
    tx
  )
}

/** Fields whose value differs, for audit trails ("changedFields") and no-op detection. */
export function changedFields<T extends object, K extends keyof T>(
  current: T,
  next: Pick<T, K>,
  fields: readonly K[]
): K[] {
  return fields.filter((field) => current[field] !== next[field])
}
