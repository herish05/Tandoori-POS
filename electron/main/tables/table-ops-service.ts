import { and, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext, Clock } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import {
  areas,
  bills,
  diningTables,
  kots,
  markModified,
  orderItems,
  orders,
  tableOperations
} from '../db/schema'
import type { KotService } from '../kitchen/kot-service'
import { AppError } from '../ipc/errors'
import { moveOrderStatus, refreshOrderSubtotal } from '../orders/order-state'
import type { OrderService } from '../orders/order-service'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import {
  CLOSED_ORDER_STATUSES,
  EDITABLE_ORDER_STATUSES,
  MAX_ORDER_LINES,
  TABLE_STATUS_FOR_ORDER,
  type OrderDetail
} from '@shared/orders'
import type { MergeTablesData, ShiftTableData } from '@shared/table-ops'

type OrderRow = typeof orders.$inferSelect
type TableRow = typeof diningTables.$inferSelect

const OPENABLE_TABLE_STATUSES = ['AVAILABLE', 'RESERVED'] as const
const MAX_GUESTS = 50

/**
 * Advanced table operations, in the way a busy floor needs them: a party moves to another table,
 * or two running tables become one. Both change only where the order lives and what it holds; no
 * item is re-priced or re-sent. Everything happens in one transaction, so a failure leaves both
 * tables exactly as they were.
 */
export class TableOperationService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly kots: KotService,
    private readonly orders: OrderService
  ) {}

  /**
   * Moves a running dine-in order to a free table. The old table becomes free, the new one shows
   * what the order is doing, and the guests, the opening time and the waiter go with the order.
   * Allowed at any time before the order is finished, also while the bill is waiting for payment.
   */
  shift(auth: AuthContext, input: ShiftTableData): OrderDetail {
    this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      const order = this.requireRunningDineIn(tx, input.orderId)
      const fromId = order.tableId
      if (!fromId) throw new AppError('CONFLICT', 'Only a dine-in order sits on a table.')
      if (fromId === input.toTableId) {
        throw new AppError('CONFLICT', 'The order is already on this table.')
      }
      const from = this.requireTable(tx, fromId)
      const to = this.requireFreeTable(tx, input.toTableId)
      const now = new Date(this.clock())

      // Both updates are guarded by what was seen, so two terminals can never move the same
      // order, or take the same table, at once.
      const moved = tx
        .update(orders)
        .set({ tableId: to.id, ...markModified(orders) })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.tableId, from.id),
            notInArray(orders.status, [...CLOSED_ORDER_STATUSES])
          )
        )
        .run()
      if (moved.changes !== 1) {
        throw new AppError('CONFLICT', 'This order was just changed somewhere else. Reopen it.')
      }
      const taken = tx
        .update(diningTables)
        .set({
          status: TABLE_STATUS_FOR_ORDER[order.status],
          openedAt: from.openedAt ?? now,
          openedBy: from.openedBy ?? auth.userId,
          guestCount: order.guestCount ?? from.guestCount,
          ...markModified(diningTables)
        })
        .where(
          and(
            eq(diningTables.id, to.id),
            inArray(diningTables.status, [...OPENABLE_TABLE_STATUSES])
          )
        )
        .run()
      if (taken.changes !== 1) {
        throw new AppError('CONFLICT', 'That table was just taken somewhere else.')
      }
      this.freeTable(tx, from.id)

      tx.insert(tableOperations)
        .values({
          restaurantId,
          kind: 'SHIFT',
          orderId: order.id,
          fromTableId: from.id,
          toTableId: to.id,
          performedBy: auth.userId,
          performedAt: now
        })
        .run()
      this.record(tx, auth, 'order.table_shifted', order, {
        fromTable: from.tableNumber,
        toTable: to.tableNumber,
        status: order.status
      })
    })
    return this.orders.get(input.orderId)
  }

  /**
   * Folds the order of one running table into the order of another. Every item (cancelled ones
   * too, so the history stays whole) and every kitchen ticket moves to the order that carries on,
   * the guests are added together, and the folded order is closed as "merged" so its table is
   * free again. Items already in the kitchen are not sent a second time.
   */
  merge(auth: AuthContext, input: MergeTablesData): OrderDetail {
    this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      const source = this.requireMergeable(tx, input.sourceOrderId)
      const target = this.requireMergeable(tx, input.targetOrderId)
      const sourceTable = this.requireTable(tx, source.tableId ?? '')
      const targetTable = this.requireTable(tx, target.tableId ?? '')
      const now = new Date(this.clock())

      const liveLines = (orderId: string): number =>
        tx
          .select({ total: sql<number>`count(*)` })
          .from(orderItems)
          .where(
            and(
              eq(orderItems.orderId, orderId),
              isNull(orderItems.deletedAt),
              ne(orderItems.status, 'CANCELLED')
            )
          )
          .get()?.total ?? 0
      if (liveLines(source.id) + liveLines(target.id) > MAX_ORDER_LINES) {
        throw new AppError(
          'CONFLICT',
          `Together these tables would have more than ${String(MAX_ORDER_LINES)} items. Settle one of them first.`
        )
      }

      const movedLines = tx
        .select({ total: sql<number>`count(*)` })
        .from(orderItems)
        .where(and(eq(orderItems.orderId, source.id), isNull(orderItems.deletedAt)))
        .get()?.total
      const movedTickets = tx
        .select({ total: sql<number>`count(*)` })
        .from(kots)
        .where(and(eq(kots.orderId, source.id), isNull(kots.deletedAt)))
        .get()?.total

      // The record comes first: it is what allows the tickets to change order.
      tx.insert(tableOperations)
        .values({
          restaurantId,
          kind: 'MERGE',
          orderId: target.id,
          sourceOrderId: source.id,
          fromTableId: sourceTable.id,
          toTableId: targetTable.id,
          movedLines: movedLines ?? 0,
          movedTickets: movedTickets ?? 0,
          performedBy: auth.userId,
          performedAt: now
        })
        .run()

      tx.update(orderItems)
        .set({ orderId: target.id, ...markModified(orderItems) })
        .where(eq(orderItems.orderId, source.id))
        .run()
      tx.update(kots)
        .set({ orderId: target.id, ...markModified(kots) })
        .where(eq(kots.orderId, source.id))
        .run()
      refreshOrderSubtotal(tx, source.id)
      const subtotal = refreshOrderSubtotal(tx, target.id)

      const guests =
        source.guestCount === null && target.guestCount === null
          ? null
          : Math.min(MAX_GUESTS, (source.guestCount ?? 0) + (target.guestCount ?? 0))
      tx.update(orders)
        .set({ guestCount: guests, ...markModified(orders) })
        .where(eq(orders.id, target.id))
        .run()
      tx.update(diningTables)
        .set({ guestCount: guests, ...markModified(diningTables) })
        .where(eq(diningTables.id, targetTable.id))
        .run()

      // Closing the folded order frees its table. It has no tickets left to cancel.
      moveOrderStatus(tx, source, 'CANCELLED', {
        cancelReason: `Merged into ${target.orderNumber}`,
        cancelledAt: now,
        cancelledBy: auth.userId
      })
      // The order that carries on follows the tickets it now holds, e.g. cooking again.
      this.kots.syncOrderStatus(tx, target.id)

      this.record(tx, auth, 'order.tables_merged', target, {
        sourceOrder: source.orderNumber,
        sourceTable: sourceTable.tableNumber,
        targetTable: targetTable.tableNumber,
        movedLines: movedLines ?? 0,
        movedTickets: movedTickets ?? 0,
        guests,
        subtotal
      })
    })
    return this.orders.get(input.targetOrderId)
  }

  // --- Guards ------------------------------------------------------------------------------

  private requireRunningDineIn(db: DbExecutor, id: string): OrderRow {
    const order = db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .get()
    if (!order) throw new AppError('NOT_FOUND', 'That order no longer exists.')
    if (CLOSED_ORDER_STATUSES.includes(order.status)) {
      throw new AppError(
        'CONFLICT',
        order.status === 'CANCELLED' ? 'This order was cancelled.' : 'This order is completed.'
      )
    }
    if (order.type !== 'DINE_IN' || !order.tableId) {
      throw new AppError('CONFLICT', 'Only a dine-in order sits on a table.')
    }
    return order
  }

  /** A running dine-in order whose items can still change: no bill has been made for it. */
  private requireMergeable(db: DbExecutor, id: string): OrderRow {
    const order = this.requireRunningDineIn(db, id)
    const table = order.tableId ? this.requireTable(db, order.tableId) : null
    const label = table ? `Table ${table.tableNumber}` : 'This table'
    if (!EDITABLE_ORDER_STATUSES.includes(order.status)) {
      throw new AppError(
        'CONFLICT',
        `${label} has asked for its bill. Cancel the bill, or settle it, before merging.`
      )
    }
    const bill = db
      .select({ billNumber: bills.billNumber })
      .from(bills)
      .where(
        and(eq(bills.orderId, order.id), ne(bills.status, 'CANCELLED'), isNull(bills.deletedAt))
      )
      .get()
    if (bill) {
      throw new AppError(
        'CONFLICT',
        `${label} has bill ${bill.billNumber}. Cancel the bill before merging.`
      )
    }
    return order
  }

  /** A table that can take a party: in service, not blocked, and with no order running on it. */
  private requireFreeTable(db: DbExecutor, id: string): TableRow {
    const table = this.requireTable(db, id)
    const area = db.select().from(areas).where(eq(areas.id, table.areaId)).get()
    if (!table.isActive || !area?.isActive || area.deletedAt) {
      throw new AppError('CONFLICT', 'That table is not in use.')
    }
    if (table.status === 'BLOCKED') {
      throw new AppError('CONFLICT', 'That table is blocked. Unblock it first.')
    }
    const running = db
      .select({ orderNumber: orders.orderNumber })
      .from(orders)
      .where(
        and(
          eq(orders.tableId, table.id),
          isNull(orders.deletedAt),
          notInArray(orders.status, [...CLOSED_ORDER_STATUSES])
        )
      )
      .get()
    if (running) {
      throw new AppError('CONFLICT', `That table already has order ${running.orderNumber} open.`)
    }
    if (!(OPENABLE_TABLE_STATUSES as readonly string[]).includes(table.status)) {
      throw new AppError('CONFLICT', 'That table is not free. Close it first, or merge instead.')
    }
    return table
  }

  private requireTable(db: DbExecutor, id: string): TableRow {
    const row = db
      .select()
      .from(diningTables)
      .where(and(eq(diningTables.id, id), isNull(diningTables.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That table no longer exists.')
    return row
  }

  private freeTable(tx: DbExecutor, id: string): void {
    tx.update(diningTables)
      .set({
        status: 'AVAILABLE',
        openedAt: null,
        openedBy: null,
        guestCount: null,
        ...markModified(diningTables)
      })
      .where(eq(diningTables.id, id))
      .run()
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: AuditAction,
    order: OrderRow,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'order',
        entityId: order.id,
        details: { orderNumber: order.orderNumber, ...details }
      },
      tx
    )
  }
}
