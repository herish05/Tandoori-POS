import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import type { AuditLogEntry, AuditLogPage, AuditOutcome } from '@shared/domain'
import type { AuditQueryData } from '@shared/auth-schemas'
import type { AppDatabase, DbExecutor } from '../db/client'
import { auditLogs } from '../db/schema'
import type { Logger } from '../logging/log-manager'
import type { AuditAction, Clock } from './types'

export interface AuditEntryInput {
  action: AuditAction
  outcome?: AuditOutcome
  userId?: string | null
  username?: string | null
  entityType?: string
  entityId?: string
  details?: Record<string, unknown>
}

const SECRET_KEY = /password|passwd|token|secret|hash/i

/** Removes anything that looks like a credential before it reaches the audit trail. */
export function scrubDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubDetails)
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      clean[key] = SECRET_KEY.test(key) ? '[redacted]' : scrubDetails(inner)
    }
    return clean
  }
  return value
}

function parseDetails(text: string | null): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Append-only security trail: who did what, when, and whether it worked. */
export class AuditService {
  constructor(
    private readonly db: AppDatabase,
    private readonly logger: Logger,
    private readonly deviceId: string | null,
    private readonly clock: Clock
  ) {}

  /**
   * Writes an entry and throws if that fails. Use inside a transaction (pass it as `executor`)
   * so a change and its audit entry are saved together or not at all.
   */
  record(entry: AuditEntryInput, executor: DbExecutor = this.db): void {
    executor
      .insert(auditLogs)
      .values({
        createdAt: new Date(this.clock()),
        action: entry.action,
        outcome: entry.outcome ?? 'SUCCESS',
        userId: entry.userId ?? null,
        username: entry.username ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        details: entry.details ? JSON.stringify(scrubDetails(entry.details)) : null,
        deviceId: this.deviceId
      })
      .run()
  }

  /** Writes an entry but never throws: a logging fault must not block signing in or out. */
  recordSafe(entry: AuditEntryInput): void {
    try {
      this.record(entry)
    } catch (error) {
      this.logger.error('Failed to write audit entry', { action: entry.action, error })
    }
  }

  list(query: AuditQueryData): AuditLogPage {
    const conditions: SQL[] = []
    if (query.actionPrefix) {
      const prefix = query.actionPrefix.replace(/[\\%_]/g, (c) => `\\${c}`)
      conditions.push(sql`${auditLogs.action} LIKE ${`${prefix}%`} ESCAPE '\\'`)
    }
    if (query.outcome) conditions.push(eq(auditLogs.outcome, query.outcome))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const total =
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(where)
        .get()?.count ?? 0
    const rows = this.db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all()

    const items: AuditLogEntry[] = rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      outcome: row.outcome,
      userId: row.userId,
      username: row.username,
      entityType: row.entityType,
      entityId: row.entityId,
      details: parseDetails(row.details)
    }))
    return { items, total, page: query.page, pageSize: query.pageSize }
  }
}
