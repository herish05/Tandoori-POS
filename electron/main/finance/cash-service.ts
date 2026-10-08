import { and, desc, eq, gte, inArray, isNull, lt, max, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext, Clock } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import {
  bills,
  cashEntries,
  expenseCategories,
  expenses,
  markModified,
  payments,
  purchases,
  refundLines,
  refunds,
  supplierPayments,
  suppliers,
  users
} from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import {
  CASH_ENTRY_DIRECTION,
  CASH_ENTRY_KINDS,
  CASH_ENTRY_LABELS,
  type CashBook,
  type CashBookFilterData,
  type CashBookRow,
  type CashEntry,
  type CashEntryFilterData,
  type CashSummary,
  type RecordCashEntryData,
  type VoidCashEntryData
} from '@shared/cash'
import { endOfLocalDay, isInFuture, localDateString, startOfLocalDay } from './dates'
import type { DayLock } from './day-lock'

type EntryRow = typeof cashEntries.$inferSelect

/** A half-open span of time: `from` inclusive, `to` exclusive. Either end may be open. */
interface Span {
  from?: Date
  to?: Date
}

interface Flow {
  in: number
  out: number
}

const IN_KINDS = CASH_ENTRY_KINDS.filter((kind) => CASH_ENTRY_DIRECTION[kind] === 'IN')
const OUT_KINDS = CASH_ENTRY_KINDS.filter((kind) => CASH_ENTRY_DIRECTION[kind] === 'OUT')

const within = (column: AnySQLiteColumn, span: Span): SQL[] => {
  const conditions: SQL[] = []
  if (span.from) conditions.push(gte(column, span.from))
  if (span.to) conditions.push(lt(column, span.to))
  return conditions
}

/**
 * The cash drawer. Nothing is copied into a ledger: the cash book reads cash from where it was
 * recorded (bill payments, refunds, expenses, supplier payments) plus the drawer entries kept
 * here (opening float, cash added, bank deposits, withdrawals). Voided records never count.
 */
export class CashService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly lock: DayLock
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  /** What the drawer should hold now, and today's movement. */
  summary(): CashSummary {
    const now = this.clock()
    const today = localDateString(now)
    const all = this.flow({})
    const day = this.flow({ from: startOfLocalDay(today), to: endOfLocalDay(today) })
    const [float] = this.db
      .select({ at: max(cashEntries.occurredAt) })
      .from(cashEntries)
      .where(
        and(
          isNull(cashEntries.deletedAt),
          isNull(cashEntries.voidedAt),
          eq(cashEntries.kind, 'OPENING_FLOAT')
        )
      )
      .all()
    return {
      balance: all.in - all.out,
      todayIn: day.in,
      todayOut: day.out,
      lastFloatAt: float?.at ? new Date(float.at).toISOString() : null
    }
  }

  /** Every cash movement over a range of days (today by default) with the balance either side. */
  book(filter: CashBookFilterData = {}): CashBook {
    const today = localDateString(this.clock())
    const from = filter.from ?? today
    const to = filter.to ?? from
    if (to < from) throw new AppError('VALIDATION_ERROR', 'The end date is before the start date.')
    const start = startOfLocalDay(from)
    const before = this.flow({ to: start })
    const rows = this.rows({ from: start, to: endOfLocalDay(to) })
    const totalIn = rows.reduce((sum, row) => sum + (row.direction === 'IN' ? row.amount : 0), 0)
    const totalOut = rows.reduce((sum, row) => sum + (row.direction === 'OUT' ? row.amount : 0), 0)
    const openingBalance = before.in - before.out
    return {
      from,
      to,
      openingBalance,
      totalIn,
      totalOut,
      closingBalance: openingBalance + totalIn - totalOut,
      rows
    }
  }

  /** The drawer entries recorded by hand, newest first. */
  listEntries(filter: CashEntryFilterData = {}): CashEntry[] {
    const conditions: SQL[] = [isNull(cashEntries.deletedAt)]
    if (!filter.includeVoided) conditions.push(isNull(cashEntries.voidedAt))
    if (filter.from) conditions.push(gte(cashEntries.occurredAt, startOfLocalDay(filter.from)))
    if (filter.to) conditions.push(lt(cashEntries.occurredAt, endOfLocalDay(filter.to)))
    const rows = this.db
      .select()
      .from(cashEntries)
      .where(and(...conditions))
      .orderBy(desc(cashEntries.occurredAt), desc(cashEntries.createdAt))
      .limit(filter.limit ?? 500)
      .all()
    const names = this.userNames(
      this.db,
      rows.flatMap((row) => [row.recordedBy, row.voidedBy])
    )
    return rows.map((row) => this.toEntry(row, names))
  }

  // --- Changes -----------------------------------------------------------------------------

  recordEntry(auth: AuthContext, input: RecordCashEntryData): CashEntry {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      const now = this.clock()
      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date(now)
      if (isInFuture(occurredAt, now)) {
        throw new AppError('VALIDATION_ERROR', 'A cash entry cannot be dated in the future.')
      }
      this.lock.assertOpen(tx, 'record a cash entry', occurredAt)
      const row = tx
        .insert(cashEntries)
        .values({
          restaurantId,
          kind: input.kind,
          amount: input.amount,
          notes: input.notes,
          occurredAt,
          recordedBy: auth.userId
        })
        .returning()
        .get()
      this.record(tx, auth, 'cash.entry_recorded', row.id, {
        kind: row.kind,
        amount: row.amount
      })
      return row.id
    })
    return this.loadEntry(this.db, id)
  }

  voidEntry(auth: AuthContext, input: VoidCashEntryData): CashEntry {
    this.db.transaction((tx) => {
      const current = this.requireEntry(tx, input.id)
      if (current.voidedAt) throw new AppError('CONFLICT', 'That entry is already voided.')
      this.lock.assertOpen(tx, 'void a cash entry', current.occurredAt)
      tx.update(cashEntries)
        .set({
          voidedAt: new Date(this.clock()),
          voidedBy: auth.userId,
          voidReason: input.reason,
          ...markModified(cashEntries)
        })
        .where(eq(cashEntries.id, current.id))
        .run()
      this.record(tx, auth, 'cash.entry_voided', current.id, {
        kind: current.kind,
        amount: current.amount,
        reason: input.reason
      })
    })
    return this.loadEntry(this.db, input.id)
  }

  // --- The cash book -----------------------------------------------------------------------

  /** Cash in and out over a span, added up by the database. */
  private flow(span: Span): Flow {
    const sums = {
      sales: this.db
        .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)` })
        .from(payments)
        .where(
          and(
            isNull(payments.deletedAt),
            eq(payments.method, 'CASH'),
            ...within(payments.receivedAt, span)
          )
        )
        .get(),
      refunds: this.db
        .select({ total: sql<number>`coalesce(sum(${refundLines.amount}), 0)` })
        .from(refundLines)
        .innerJoin(refunds, eq(refunds.id, refundLines.refundId))
        .where(
          and(
            isNull(refunds.deletedAt),
            eq(refundLines.method, 'CASH'),
            ...within(refunds.refundedAt, span)
          )
        )
        .get(),
      expenses: this.db
        .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
        .from(expenses)
        .where(
          and(
            isNull(expenses.deletedAt),
            isNull(expenses.voidedAt),
            eq(expenses.method, 'CASH'),
            ...within(expenses.spentAt, span)
          )
        )
        .get(),
      suppliers: this.db
        .select({ total: sql<number>`coalesce(sum(${supplierPayments.amount}), 0)` })
        .from(supplierPayments)
        .where(
          and(
            isNull(supplierPayments.deletedAt),
            isNull(supplierPayments.voidedAt),
            eq(supplierPayments.method, 'CASH'),
            ...within(supplierPayments.paidAt, span)
          )
        )
        .get(),
      entriesIn: this.db
        .select({ total: sql<number>`coalesce(sum(${cashEntries.amount}), 0)` })
        .from(cashEntries)
        .where(
          and(
            isNull(cashEntries.deletedAt),
            isNull(cashEntries.voidedAt),
            inArray(cashEntries.kind, IN_KINDS),
            ...within(cashEntries.occurredAt, span)
          )
        )
        .get(),
      entriesOut: this.db
        .select({ total: sql<number>`coalesce(sum(${cashEntries.amount}), 0)` })
        .from(cashEntries)
        .where(
          and(
            isNull(cashEntries.deletedAt),
            isNull(cashEntries.voidedAt),
            inArray(cashEntries.kind, OUT_KINDS),
            ...within(cashEntries.occurredAt, span)
          )
        )
        .get()
    }
    return {
      in: (sums.sales?.total ?? 0) + (sums.entriesIn?.total ?? 0),
      out:
        (sums.refunds?.total ?? 0) +
        (sums.expenses?.total ?? 0) +
        (sums.suppliers?.total ?? 0) +
        (sums.entriesOut?.total ?? 0)
    }
  }

  /** Every cash movement in a span, oldest first. */
  private rows(span: Span): CashBookRow[] {
    const db = this.db
    const result: (CashBookRow & { time: number })[] = []

    for (const row of db
      .select({
        id: payments.id,
        at: payments.receivedAt,
        amount: payments.amount,
        billNumber: bills.billNumber
      })
      .from(payments)
      .innerJoin(bills, eq(bills.id, payments.billId))
      .where(
        and(
          isNull(payments.deletedAt),
          eq(payments.method, 'CASH'),
          ...within(payments.receivedAt, span)
        )
      )
      .all()) {
      result.push({
        key: `SALE:${row.id}`,
        time: row.at.getTime(),
        at: row.at.toISOString(),
        source: 'SALE',
        direction: 'IN',
        amount: row.amount,
        description: `Cash received on bill ${row.billNumber}`,
        reference: row.billNumber
      })
    }

    for (const row of db
      .select({
        id: refundLines.id,
        at: refunds.refundedAt,
        amount: refundLines.amount,
        refundNumber: refunds.refundNumber,
        billNumber: bills.billNumber
      })
      .from(refundLines)
      .innerJoin(refunds, eq(refunds.id, refundLines.refundId))
      .innerJoin(bills, eq(bills.id, refunds.billId))
      .where(
        and(
          isNull(refunds.deletedAt),
          eq(refundLines.method, 'CASH'),
          ...within(refunds.refundedAt, span)
        )
      )
      .all()) {
      result.push({
        key: `REFUND:${row.id}`,
        time: row.at.getTime(),
        at: row.at.toISOString(),
        source: 'REFUND',
        direction: 'OUT',
        amount: row.amount,
        description: `Cash refunded on bill ${row.billNumber}`,
        reference: row.refundNumber
      })
    }

    for (const row of db
      .select({
        id: expenses.id,
        at: expenses.spentAt,
        amount: expenses.amount,
        expenseNumber: expenses.expenseNumber,
        payee: expenses.payee,
        categoryName: expenseCategories.name
      })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(
        and(
          isNull(expenses.deletedAt),
          isNull(expenses.voidedAt),
          eq(expenses.method, 'CASH'),
          ...within(expenses.spentAt, span)
        )
      )
      .all()) {
      result.push({
        key: `EXPENSE:${row.id}`,
        time: row.at.getTime(),
        at: row.at.toISOString(),
        source: 'EXPENSE',
        direction: 'OUT',
        amount: row.amount,
        description: row.payee ? `${row.categoryName}: ${row.payee}` : row.categoryName,
        reference: row.expenseNumber
      })
    }

    for (const row of db
      .select({
        id: supplierPayments.id,
        at: supplierPayments.paidAt,
        amount: supplierPayments.amount,
        supplierName: suppliers.name,
        purchaseNumber: purchases.purchaseNumber
      })
      .from(supplierPayments)
      .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
      .innerJoin(purchases, eq(purchases.id, supplierPayments.purchaseId))
      .where(
        and(
          isNull(supplierPayments.deletedAt),
          isNull(supplierPayments.voidedAt),
          eq(supplierPayments.method, 'CASH'),
          ...within(supplierPayments.paidAt, span)
        )
      )
      .all()) {
      result.push({
        key: `SUPPLIER_PAYMENT:${row.id}`,
        time: row.at.getTime(),
        at: row.at.toISOString(),
        source: 'SUPPLIER_PAYMENT',
        direction: 'OUT',
        amount: row.amount,
        description: `Paid ${row.supplierName}`,
        reference: row.purchaseNumber
      })
    }

    for (const row of db
      .select()
      .from(cashEntries)
      .where(
        and(
          isNull(cashEntries.deletedAt),
          isNull(cashEntries.voidedAt),
          ...within(cashEntries.occurredAt, span)
        )
      )
      .all()) {
      result.push({
        key: `ENTRY:${row.id}`,
        time: row.occurredAt.getTime(),
        at: row.occurredAt.toISOString(),
        source: 'ENTRY',
        direction: CASH_ENTRY_DIRECTION[row.kind],
        amount: row.amount,
        description: row.notes
          ? `${CASH_ENTRY_LABELS[row.kind]}: ${row.notes}`
          : CASH_ENTRY_LABELS[row.kind],
        reference: null
      })
    }

    return result
      .sort((a, b) => a.time - b.time || a.key.localeCompare(b.key))
      .map(({ time: _time, ...row }) => row)
  }

  // --- Internals ---------------------------------------------------------------------------

  private loadEntry(db: DbExecutor, id: string): CashEntry {
    const row = this.requireEntry(db, id)
    return this.toEntry(row, this.userNames(db, [row.recordedBy, row.voidedBy]))
  }

  private requireEntry(db: DbExecutor, id: string): EntryRow {
    const [row] = db
      .select()
      .from(cashEntries)
      .where(and(eq(cashEntries.id, id), isNull(cashEntries.deletedAt)))
      .all()
    if (!row) throw new AppError('NOT_FOUND', 'That cash entry no longer exists.')
    return row
  }

  private userNames(db: DbExecutor, ids: readonly (string | null)[]): Map<string, string> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))]
    if (unique.length === 0) return new Map()
    return new Map(
      db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.id, unique))
        .all()
        .map((user) => [user.id, user.fullName] as const)
    )
  }

  private toEntry(row: EntryRow, names: Map<string, string>): CashEntry {
    return {
      id: row.id,
      kind: row.kind,
      direction: CASH_ENTRY_DIRECTION[row.kind],
      amount: row.amount,
      notes: row.notes,
      occurredAt: row.occurredAt.toISOString(),
      recordedBy: names.get(row.recordedBy) ?? null,
      voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
      voidedBy: row.voidedBy ? (names.get(row.voidedBy) ?? null) : null,
      voidReason: row.voidReason
    }
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: 'cash.entry_recorded' | 'cash.entry_voided',
    entryId: string,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'cash_entry',
        entityId: entryId,
        details
      },
      tx
    )
  }
}
