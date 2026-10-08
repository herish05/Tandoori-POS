import type { AppDatabase } from '../db/client'
import type {
  ReportCell,
  ReportColumn,
  ReportColumnType,
  ReportFilterData,
  ReportSummaryItem
} from '@shared/reports'

/** Everything a report query needs: the database, the filters and the range as moments. */
export interface ReportContext {
  db: AppDatabase
  filter: ReportFilterData
  /** Start of the first day. */
  from: Date
  /** Start of the day after the last day, i.e. an exclusive end. */
  to: Date
  /** Team members' names by id; a removed user is still named. */
  users: ReadonlyMap<string, string>
}

export type ReportRow = Record<string, ReportCell>

/** What a report query returns; the service adds the title, filters and totals. */
export interface ReportBody {
  summary: ReportSummaryItem[]
  columns: ReportColumn[]
  rows: ReportRow[]
}

export const col = (
  key: string,
  label: string,
  type: ReportColumnType,
  total = false
): ReportColumn => (total ? { key, label, type, total } : { key, label, type })

export const item = (
  label: string,
  value: number | string,
  type: ReportColumnType
): ReportSummaryItem => ({ label, value, type })

/** True when no search is typed, or any of the fields contains it (ignoring case). */
export function matchesSearch(
  search: string | undefined,
  ...fields: readonly (string | null | undefined)[]
): boolean {
  if (!search) return true
  const needle = search.toLowerCase()
  return fields.some((field) => field?.toLowerCase().includes(needle) === true)
}

export function userName(ctx: ReportContext, id: string | null): string | null {
  if (!id) return null
  return ctx.users.get(id) ?? 'Unknown user'
}

export const sum = <T>(rows: readonly T[], pick: (row: T) => number): number =>
  rows.reduce((total, row) => total + pick(row), 0)

/** Shares as basis points, 0 when there is nothing to share. */
export function shareBps(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10_000) : 0
}

/** Rows grouped by a key, in the order the keys first appear. */
export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const bucket = groups.get(k)
    if (bucket) bucket.push(row)
    else groups.set(k, [row])
  }
  return groups
}

export const iso = (at: Date | null): string | null => (at ? at.toISOString() : null)
