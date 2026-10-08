import { and, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext, Clock } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import {
  bills,
  cashEntries,
  dayClosings,
  expenses,
  markModified,
  orders,
  payments,
  refundLines,
  refunds,
  supplierPayments,
  users
} from '../db/schema'
import { AppError } from '../ipc/errors'
import { nextDocumentNumber } from '../orders/numbering'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import { PAYMENT_METHODS } from '@shared/billing'
import { EXPENSE_PAYMENT_METHODS } from '@shared/expenses'
import { ACTIVE_ORDER_STATUSES, ORDER_TYPES } from '@shared/orders'
import {
  UNCLOSED_LOOKBACK_DAYS,
  type CloseDayData,
  type DayClosing,
  type DayClosingFilterData,
  type DayClosingListItem,
  type DayOverview,
  type DayStatus,
  type DayStatusData,
  type DaySummary,
  type MethodTotal,
  type ReopenDayData
} from '@shared/day-closing'
import type { CashService } from './cash-service'
import {
  addLocalDays,
  describeDate,
  endOfLocalDay,
  localDateString,
  startOfLocalDay
} from './dates'
import type { DayLock } from './day-lock'

type ClosingRow = typeof dayClosings.$inferSelect

interface Span {
  from: Date
  to: Date
}

const within = (column: AnySQLiteColumn, span: Span): SQL[] => [
  gte(column, span.from),
  lt(column, span.to)
]

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null)

/** 12345 -> "123.45", for messages (integer maths only). */
const rupees = (paise: number): string => {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  return `${sign}${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`
}

/** Keeps the methods that had activity, in the order the methods are listed everywhere else. */
function inMethodOrder(methods: readonly string[], rows: MethodTotal[]): MethodTotal[] {
  return methods.flatMap((method) => {
    const row = rows.find((candidate) => candidate.method === method)
    return row && row.count > 0 ? [row] : []
  })
}

/**
 * Closing the day. The summary of a day is read from where the money was recorded (bills,
 * payments, refunds, expenses, supplier payments, the cash book) and frozen into a closing when
 * the day is closed, together with the cash counted. A difference between the count and the book
 * becomes a drawer entry so the book agrees with the drawer from then on. The lock that keeps a
 * closed day closed lives in `DayLock` and is used by the services that record money.
 */
export class DayClosingService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly cash: CashService,
    private readonly lock: DayLock
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  /** Today, whether it is closed, the latest closed day and earlier days nobody closed. */
  overview(): DayOverview {
    const today = localDateString(this.clock())
    const [last] = this.db
      .select()
      .from(dayClosings)
      .where(and(isNull(dayClosings.deletedAt), isNull(dayClosings.reopenedAt)))
      .orderBy(desc(dayClosings.businessDate))
      .limit(1)
      .all()
    const names = this.userNames(this.db, last ? [last.closedBy] : [])
    return {
      today,
      todayClosed: this.lock.isClosed(this.db, today),
      lastClosed: last ? this.toListItem(last, names) : null,
      unclosedDays: this.unclosedDays(today)
    }
  }

  /** One day as it stands: its live figures, or its frozen ones once closed. */
  status(input: DayStatusData = {}): DayStatus {
    const today = localDateString(this.clock())
    const date = input.date ?? today
    const standing = this.standing(this.db, date)
    if (standing) {
      const names = this.userNames(this.db, [standing.closedBy, standing.reopenedBy])
      const closing = this.toClosing(standing, names)
      return {
        date,
        isToday: date === today,
        closing,
        summary: closing.summary,
        blockers: [],
        canClose: false
      }
    }
    const blockers = this.blockers(date, today)
    return {
      date,
      isToday: date === today,
      closing: null,
      summary: this.summarize(this.db, date),
      blockers,
      canClose: blockers.length === 0
    }
  }

  /** The closing history, newest day first. */
  list(filter: DayClosingFilterData = {}): DayClosingListItem[] {
    const conditions: SQL[] = [isNull(dayClosings.deletedAt)]
    if (!filter.includeReopened) conditions.push(isNull(dayClosings.reopenedAt))
    if (filter.from) conditions.push(gte(dayClosings.businessDate, filter.from))
    if (filter.to) conditions.push(sql`${dayClosings.businessDate} <= ${filter.to}`)
    const rows = this.db
      .select()
      .from(dayClosings)
      .where(and(...conditions))
      .orderBy(desc(dayClosings.businessDate), desc(dayClosings.closedAt))
      .limit(filter.limit ?? 100)
      .all()
    const names = this.userNames(
      this.db,
      rows.map((row) => row.closedBy)
    )
    return rows.map((row) => this.toListItem(row, names))
  }

  get(id: string): DayClosing {
    return this.load(this.db, id)
  }

  // --- Changes -----------------------------------------------------------------------------

  /** Counts the cash, freezes the day's figures and closes the day. */
  close(auth: AuthContext, input: CloseDayData): DayClosing {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      const now = this.clock()
      const today = localDateString(now)
      if (input.date > today) {
        throw new AppError('VALIDATION_ERROR', 'A day cannot be closed before it has begun.')
      }
      if (this.lock.isClosed(tx, input.date)) {
        throw new AppError('CONFLICT', `${describeDate(input.date)} is already closed.`)
      }
      const [blocker] = this.blockers(input.date, today)
      if (blocker) throw new AppError('CONFLICT', blocker)

      const summary = this.summarize(tx, input.date)
      const expectedCash = summary.cash.expected
      const variance = input.countedCash - expectedCash
      if (variance !== 0 && !input.notes) {
        throw new AppError(
          'VALIDATION_ERROR',
          `The cash counted is ${rupees(Math.abs(variance))} ${variance > 0 ? 'more' : 'less'} than the book expects. Add a note explaining the difference.`
        )
      }

      let adjustmentEntryId: string | null = null
      if (variance !== 0) {
        // Dated inside the day it belongs to, and never ahead of the clock.
        const occurredAt = Math.min(now, endOfLocalDay(input.date).getTime() - 1)
        const entry = tx
          .insert(cashEntries)
          .values({
            restaurantId,
            kind: variance > 0 ? 'COUNT_EXCESS' : 'COUNT_SHORT',
            amount: Math.abs(variance),
            notes: `Cash count when closing ${describeDate(input.date)}`,
            occurredAt: new Date(occurredAt),
            recordedBy: auth.userId
          })
          .returning()
          .get()
        adjustmentEntryId = entry.id
      }

      const row = tx
        .insert(dayClosings)
        .values({
          restaurantId,
          closingNumber: nextDocumentNumber(tx, restaurantId, 'DAY'),
          businessDate: input.date,
          billCount: summary.sales.bills,
          salesTotal: summary.sales.total,
          summary,
          expectedCash,
          countedCash: input.countedCash,
          variance,
          denominations: input.denominations ?? [],
          notes: input.notes,
          adjustmentEntryId,
          closedAt: new Date(now),
          closedBy: auth.userId
        })
        .returning()
        .get()
      this.record(tx, auth, 'day.closed', row.id, {
        closingNumber: row.closingNumber,
        date: input.date,
        salesTotal: summary.sales.total,
        expectedCash,
        countedCash: input.countedCash,
        variance
      })
      return row.id
    })
    return this.load(this.db, id)
  }

  /** Reopens the latest closed day; the cash difference it recorded is voided with it. */
  reopen(auth: AuthContext, input: ReopenDayData): DayClosing {
    this.db.transaction((tx) => {
      const current = this.require(tx, input.id)
      if (current.reopenedAt) {
        throw new AppError('CONFLICT', 'That day was already reopened.')
      }
      const [later] = tx
        .select({ date: dayClosings.businessDate })
        .from(dayClosings)
        .where(
          and(
            isNull(dayClosings.deletedAt),
            isNull(dayClosings.reopenedAt),
            sql`${dayClosings.businessDate} > ${current.businessDate}`
          )
        )
        .orderBy(desc(dayClosings.businessDate))
        .limit(1)
        .all()
      if (later) {
        throw new AppError(
          'CONFLICT',
          `${describeDate(later.date)} is closed after this day. Reopen the later day first.`
        )
      }

      const now = new Date(this.clock())
      tx.update(dayClosings)
        .set({
          reopenedAt: now,
          reopenedBy: auth.userId,
          reopenReason: input.reason,
          ...markModified(dayClosings)
        })
        .where(eq(dayClosings.id, current.id))
        .run()
      if (current.adjustmentEntryId) {
        tx.update(cashEntries)
          .set({
            voidedAt: now,
            voidedBy: auth.userId,
            voidReason: `Day ${current.businessDate} reopened`,
            ...markModified(cashEntries)
          })
          .where(and(eq(cashEntries.id, current.adjustmentEntryId), isNull(cashEntries.voidedAt)))
          .run()
      }
      this.record(tx, auth, 'day.reopened', current.id, {
        closingNumber: current.closingNumber,
        date: current.businessDate,
        reason: input.reason,
        variance: current.variance
      })
    })
    return this.load(this.db, input.id)
  }

  // --- The summary of a day ----------------------------------------------------------------

  /** What stops a day from being closed. */
  private blockers(date: string, today: string): string[] {
    if (date > today) return ['This day has not begun yet.']
    const [row] = this.db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          inArray(orders.status, [...ACTIVE_ORDER_STATUSES]),
          lt(orders.createdAt, endOfLocalDay(date))
        )
      )
      .all()
    const open = row?.count ?? 0
    return open > 0
      ? [
          `${String(open)} ${open === 1 ? 'order is' : 'orders are'} still open. Settle or cancel ${open === 1 ? 'it' : 'them'} before closing the day.`
        ]
      : []
  }

  /** The figures of one day, read from where the money was recorded. */
  private summarize(db: DbExecutor, date: string): DaySummary {
    const span: Span = { from: startOfLocalDay(date), to: endOfLocalDay(date) }
    const settled = [
      isNull(bills.deletedAt),
      inArray(bills.status, ['PAID', 'REFUNDED']),
      ...within(bills.paidAt, span)
    ]

    const [sales] = db
      .select({
        bills: sql<number>`count(*)`,
        subtotal: sql<number>`coalesce(sum(${bills.subtotal}), 0)`,
        discounts: sql<number>`coalesce(sum(${bills.itemDiscountTotal} + ${bills.billDiscountTotal}), 0)`,
        serviceCharge: sql<number>`coalesce(sum(${bills.serviceCharge}), 0)`,
        tax: sql<number>`coalesce(sum(${bills.taxTotal}), 0)`,
        roundOff: sql<number>`coalesce(sum(${bills.roundOff}), 0)`,
        total: sql<number>`coalesce(sum(${bills.grandTotal}), 0)`
      })
      .from(bills)
      .where(and(...settled))
      .all()

    const typeRows = db
      .select({
        type: orders.type,
        bills: sql<number>`count(*)`,
        total: sql<number>`coalesce(sum(${bills.grandTotal}), 0)`
      })
      .from(bills)
      .innerJoin(orders, eq(orders.id, bills.orderId))
      .where(and(...settled))
      .groupBy(orders.type)
      .all()

    const [cancelled] = db
      .select({ count: sql<number>`count(*)` })
      .from(bills)
      .where(and(isNull(bills.deletedAt), ...within(bills.cancelledAt, span)))
      .all()

    const collections = db
      .select({
        method: payments.method,
        count: sql<number>`count(*)`,
        amount: sql<number>`coalesce(sum(${payments.amount}), 0)`
      })
      .from(payments)
      .where(and(isNull(payments.deletedAt), ...within(payments.receivedAt, span)))
      .groupBy(payments.method)
      .all()

    const refunded = db
      .select({
        method: refundLines.method,
        count: sql<number>`count(*)`,
        amount: sql<number>`coalesce(sum(${refundLines.amount}), 0)`
      })
      .from(refundLines)
      .innerJoin(refunds, eq(refunds.id, refundLines.refundId))
      .where(and(isNull(refunds.deletedAt), ...within(refunds.refundedAt, span)))
      .groupBy(refundLines.method)
      .all()

    const spent = db
      .select({
        method: expenses.method,
        count: sql<number>`count(*)`,
        amount: sql<number>`coalesce(sum(${expenses.amount}), 0)`
      })
      .from(expenses)
      .where(
        and(
          isNull(expenses.deletedAt),
          isNull(expenses.voidedAt),
          ...within(expenses.spentAt, span)
        )
      )
      .groupBy(expenses.method)
      .all()

    const suppliers = db
      .select({
        method: supplierPayments.method,
        count: sql<number>`count(*)`,
        amount: sql<number>`coalesce(sum(${supplierPayments.amount}), 0)`
      })
      .from(supplierPayments)
      .where(
        and(
          isNull(supplierPayments.deletedAt),
          isNull(supplierPayments.voidedAt),
          ...within(supplierPayments.paidAt, span)
        )
      )
      .groupBy(supplierPayments.method)
      .all()

    const book = this.cash.book({ from: date, to: date })

    return {
      date,
      sales: {
        bills: sales?.bills ?? 0,
        subtotal: sales?.subtotal ?? 0,
        discounts: sales?.discounts ?? 0,
        serviceCharge: sales?.serviceCharge ?? 0,
        tax: sales?.tax ?? 0,
        roundOff: sales?.roundOff ?? 0,
        total: sales?.total ?? 0
      },
      byOrderType: ORDER_TYPES.flatMap((type) => {
        const row = typeRows.find((candidate) => candidate.type === type)
        return row && row.bills > 0 ? [{ type, bills: row.bills, total: row.total }] : []
      }),
      cancelledBills: cancelled?.count ?? 0,
      collections: inMethodOrder(PAYMENT_METHODS, collections),
      refunds: inMethodOrder(PAYMENT_METHODS, refunded),
      expenses: inMethodOrder(EXPENSE_PAYMENT_METHODS, spent),
      supplierPayments: inMethodOrder(EXPENSE_PAYMENT_METHODS, suppliers),
      cash: {
        opening: book.openingBalance,
        in: book.totalIn,
        out: book.totalOut,
        expected: book.closingBalance
      }
    }
  }

  /** Earlier days that had money activity and were never closed, oldest first. */
  private unclosedDays(today: string): string[] {
    const span: Span = {
      from: startOfLocalDay(addLocalDays(today, -UNCLOSED_LOOKBACK_DAYS)),
      to: startOfLocalDay(today)
    }
    const stamps: Date[] = [
      ...this.db
        .select({ at: payments.receivedAt })
        .from(payments)
        .where(and(isNull(payments.deletedAt), ...within(payments.receivedAt, span)))
        .all()
        .map((row) => row.at),
      ...this.db
        .select({ at: refunds.refundedAt })
        .from(refunds)
        .where(and(isNull(refunds.deletedAt), ...within(refunds.refundedAt, span)))
        .all()
        .map((row) => row.at),
      ...this.db
        .select({ at: expenses.spentAt })
        .from(expenses)
        .where(
          and(
            isNull(expenses.deletedAt),
            isNull(expenses.voidedAt),
            ...within(expenses.spentAt, span)
          )
        )
        .all()
        .map((row) => row.at),
      ...this.db
        .select({ at: supplierPayments.paidAt })
        .from(supplierPayments)
        .where(
          and(
            isNull(supplierPayments.deletedAt),
            isNull(supplierPayments.voidedAt),
            ...within(supplierPayments.paidAt, span)
          )
        )
        .all()
        .map((row) => row.at),
      ...this.db
        .select({ at: cashEntries.occurredAt })
        .from(cashEntries)
        .where(
          and(
            isNull(cashEntries.deletedAt),
            isNull(cashEntries.voidedAt),
            ...within(cashEntries.occurredAt, span)
          )
        )
        .all()
        .map((row) => row.at)
    ]
    const days = [...new Set(stamps.map((at) => localDateString(at)))].sort()
    return days.filter((day) => !this.lock.isClosed(this.db, day))
  }

  // --- Internals ---------------------------------------------------------------------------

  private standing(db: DbExecutor, date: string): ClosingRow | undefined {
    const [row] = db
      .select()
      .from(dayClosings)
      .where(
        and(
          eq(dayClosings.businessDate, date),
          isNull(dayClosings.reopenedAt),
          isNull(dayClosings.deletedAt)
        )
      )
      .limit(1)
      .all()
    return row
  }

  private load(db: DbExecutor, id: string): DayClosing {
    const row = this.require(db, id)
    return this.toClosing(row, this.userNames(db, [row.closedBy, row.reopenedBy]))
  }

  private require(db: DbExecutor, id: string): ClosingRow {
    const [row] = db
      .select()
      .from(dayClosings)
      .where(and(eq(dayClosings.id, id), isNull(dayClosings.deletedAt)))
      .all()
    if (!row) throw new AppError('NOT_FOUND', 'That day closing no longer exists.')
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

  private toClosing(row: ClosingRow, names: Map<string, string>): DayClosing {
    return {
      id: row.id,
      closingNumber: row.closingNumber,
      date: row.businessDate,
      closedAt: row.closedAt.toISOString(),
      closedBy: names.get(row.closedBy) ?? null,
      summary: row.summary,
      expectedCash: row.expectedCash,
      countedCash: row.countedCash,
      variance: row.variance,
      denominations: row.denominations,
      notes: row.notes,
      adjustmentEntryId: row.adjustmentEntryId,
      reopenedAt: iso(row.reopenedAt),
      reopenedBy: row.reopenedBy ? (names.get(row.reopenedBy) ?? null) : null,
      reopenReason: row.reopenReason
    }
  }

  private toListItem(row: ClosingRow, names: Map<string, string>): DayClosingListItem {
    return {
      id: row.id,
      closingNumber: row.closingNumber,
      date: row.businessDate,
      closedAt: row.closedAt.toISOString(),
      closedBy: names.get(row.closedBy) ?? null,
      billCount: row.billCount,
      salesTotal: row.salesTotal,
      expectedCash: row.expectedCash,
      countedCash: row.countedCash,
      variance: row.variance,
      reopenedAt: iso(row.reopenedAt)
    }
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: 'day.closed' | 'day.reopened',
    closingId: string,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'day_closing',
        entityId: closingId,
        details
      },
      tx
    )
  }
}
