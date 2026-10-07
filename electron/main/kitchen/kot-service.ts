import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext, Clock } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import {
  areas,
  diningTables,
  kitchenStations,
  kotItems,
  kots,
  markModified,
  orderItemAddons,
  orderItems,
  orders,
  users
} from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import { moveOrderStatus, refreshOrderSubtotal, type OrderRow } from '../orders/order-state'
import type { InventoryService } from '../inventory/inventory-service'
import { RESTOCKABLE_KOT_STATUSES } from '@shared/inventory'
import { nextDocumentNumber } from '../orders/numbering'
import {
  KOT_STATUS_LABELS,
  KOT_TRANSITIONS,
  OPEN_KOT_STATUSES,
  type CancelKotData,
  type KotDetail,
  type KotFilterData,
  type KotItem,
  type KotPrintStatus,
  type KotStatus,
  type KotSummary,
  type PrintStatus,
  type SetKotStatusData
} from '@shared/kitchen'
import { CLOSED_ORDER_STATUSES, EDITABLE_ORDER_STATUSES, type OrderStatus } from '@shared/orders'

type KotRow = typeof kots.$inferSelect
type KotItemRow = typeof kotItems.$inferSelect
type LineRow = typeof orderItems.$inferSelect

/** How long a cancelled ticket stays on the kitchen display. */
const RECENT_CANCEL_MS = 30 * 60 * 1000

/** Shown for items that no station claimed: they are made in the general kitchen. */
export const GENERAL_KITCHEN = 'Kitchen'

/** The order's status follows its tickets only while it is in one of these states. */
const FOLLOWS_KITCHEN: readonly OrderStatus[] = [
  'DRAFT',
  'CONFIRMED',
  'KOT_PENDING',
  'PREPARING',
  'READY',
  'SERVED'
]

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (match) => `\\${match}`)

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null)

/** Food the cook has not started yet can still be put back into stock when it is cancelled. */
const isRestockable = (status: KotStatus): boolean =>
  (RESTOCKABLE_KOT_STATUSES as readonly string[]).includes(status)

/**
 * Kitchen order tickets. A ticket is issued when an order is sent: one per kitchen station, each
 * holding a copy of the lines for that station. Later sends issue additional tickets; an issued
 * ticket is never rewritten. It moves through the kitchen (accepted, preparing, ready, served)
 * and can only be changed by a controlled cancellation, which raises its revision.
 */
export class KotService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly inventory: InventoryService
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  list(filter: KotFilterData = {}): KotSummary[] {
    const conditions: SQL[] = []
    if (filter.orderId) conditions.push(eq(kots.orderId, filter.orderId))
    if (filter.stationId) conditions.push(eq(kots.stationId, filter.stationId))
    if (filter.statuses && filter.statuses.length > 0) {
      conditions.push(inArray(kots.status, filter.statuses))
    }
    if (filter.openOnly) conditions.push(inArray(kots.status, [...OPEN_KOT_STATUSES]))
    if (filter.search) {
      const like = `%${escapeLike(filter.search)}%`
      conditions.push(
        sql`(${kots.kotNumber} like ${like} escape '\\' or ${orders.orderNumber} like ${like} escape '\\')`
      )
    }
    return this.loadSummaries(this.db, conditions, filter.limit ?? 200, filter.openOnly === true)
  }

  get(id: string): KotDetail {
    return this.loadDetail(this.db, id)
  }

  /**
   * What the kitchen display shows: every ticket still being worked on, oldest first, plus the
   * tickets cancelled in the last half hour so a cook who started one learns it was withdrawn.
   */
  board(stationId?: string): KotDetail[] {
    const since = new Date(this.clock() - RECENT_CANCEL_MS)
    const conditions: SQL[] = []
    const visible = or(
      inArray(kots.status, [...OPEN_KOT_STATUSES]),
      and(eq(kots.status, 'CANCELLED'), gte(kots.cancelledAt, since))
    )
    if (visible) conditions.push(visible)
    if (stationId) conditions.push(eq(kots.stationId, stationId))
    return this.loadSummaries(this.db, conditions, 200, true).map((summary) =>
      this.loadDetail(this.db, summary.id)
    )
  }

  /** The tickets of one order, oldest first; used to show them on the order itself. */
  forOrder(db: DbExecutor, orderId: string): KotSummary[] {
    return this.loadSummaries(db, [eq(kots.orderId, orderId)], 200, true)
  }

  // --- Issuing (called inside the transaction that sends the order) ------------------------

  /**
   * Issues the tickets for lines that were just sent: one per kitchen station. The first ticket of
   * an order is the "main" one; every later one is marked additional.
   */
  issue(tx: DbExecutor, auth: AuthContext, order: OrderRow, lines: readonly LineRow[]): KotRow[] {
    if (lines.length === 0) return []
    const restaurantId = requireRestaurantId(tx)
    const earlier = tx
      .select({ total: sql<number>`count(*)` })
      .from(kots)
      .where(and(eq(kots.orderId, order.id), isNull(kots.deletedAt)))
      .get()
    const isAdditional = (earlier?.total ?? 0) > 0

    const stationNames = new Map(
      tx
        .select({ id: kitchenStations.id, name: kitchenStations.name })
        .from(kitchenStations)
        .all()
        .map((station) => [station.id, station.name])
    )
    const addonRows = tx
      .select()
      .from(orderItemAddons)
      .where(
        inArray(
          orderItemAddons.orderItemId,
          lines.map((line) => line.id)
        )
      )
      .orderBy(asc(orderItemAddons.sortOrder), sql`rowid`)
      .all()

    const groups = new Map<string | null, LineRow[]>()
    for (const line of lines) {
      const group = groups.get(line.stationId)
      if (group) group.push(line)
      else groups.set(line.stationId, [line])
    }

    const issued: KotRow[] = []
    for (const [stationId, groupLines] of groups) {
      const stationName = stationId
        ? (stationNames.get(stationId) ?? GENERAL_KITCHEN)
        : GENERAL_KITCHEN
      const row = tx
        .insert(kots)
        .values({
          restaurantId,
          kotNumber: nextDocumentNumber(tx, restaurantId, 'KOT'),
          orderId: order.id,
          stationId,
          stationName,
          status: 'NEW',
          isAdditional,
          createdBy: auth.userId
        })
        .returning()
        .get()
      for (const [index, line] of groupLines.entries()) {
        tx.insert(kotItems)
          .values({
            kotId: row.id,
            orderItemId: line.id,
            menuItemId: line.menuItemId,
            itemName: line.itemName,
            variantName: line.variantName,
            foodType: line.foodType,
            quantity: line.quantity,
            addons: addonRows
              .filter((addon) => addon.orderItemId === line.id)
              .map((addon) => ({ name: addon.name, kind: addon.kind })),
            notes: line.notes,
            sortOrder: index
          })
          .run()
      }
      this.record(tx, auth, 'kot.created', row, order, {
        station: stationName,
        items: groupLines.length,
        quantity: groupLines.reduce((sum, line) => sum + line.quantity, 0),
        additional: isAdditional
      })
      issued.push(row)
    }
    return issued
  }

  // --- Kitchen progress --------------------------------------------------------------------

  /** Accept, start, finish or serve a ticket. Each step follows the one before it. */
  setStatus(auth: AuthContext, input: SetKotStatusData): KotDetail {
    this.db.transaction((tx) => {
      const { kot, order } = this.requireKot(tx, input.id)
      this.assertOrderOpen(order)
      if (!KOT_TRANSITIONS[kot.status].includes(input.status)) {
        throw new AppError(
          'CONFLICT',
          kot.status === 'CANCELLED'
            ? 'This ticket was cancelled.'
            : `A ticket that is "${KOT_STATUS_LABELS[kot.status]}" cannot be marked "${KOT_STATUS_LABELS[input.status]}".`
        )
      }
      const now = new Date(this.clock())
      const result = tx
        .update(kots)
        .set({ status: input.status, ...this.stamp(input.status, now), ...markModified(kots) })
        .where(and(eq(kots.id, kot.id), eq(kots.status, kot.status)))
        .run()
      if (result.changes !== 1) {
        throw new AppError('CONFLICT', 'This ticket was just changed somewhere else. Reopen it.')
      }
      this.record(tx, auth, 'kot.status_changed', kot, order, {
        statusFrom: kot.status,
        statusTo: input.status
      })
      this.syncOrderStatus(tx, order.id)
    })
    return this.get(input.id)
  }

  /**
   * Cancels a whole ticket. The items on it are cancelled on the order too, so they are not billed.
   */
  cancel(auth: AuthContext, input: CancelKotData): KotDetail {
    this.db.transaction((tx) => {
      const { kot, order } = this.requireKot(tx, input.id)
      this.assertOrderEditable(order)
      if (!KOT_TRANSITIONS[kot.status].includes('CANCELLED')) {
        throw new AppError(
          'CONFLICT',
          kot.status === 'CANCELLED'
            ? 'This ticket is already cancelled.'
            : 'The food on this ticket was already served. Cancel individual items instead.'
        )
      }
      const now = new Date(this.clock())
      const items = this.activeItems(tx, kot.id)
      if (isRestockable(kot.status)) {
        this.inventory.restore(
          tx,
          auth,
          items.map((item) => item.orderItemId),
          `Ticket ${kot.kotNumber} cancelled`
        )
      }
      for (const item of items) {
        this.cancelOrderLine(tx, auth, item.orderItemId, input.reason, now)
      }
      this.cancelTicket(tx, kot, input.reason, now, auth.userId)
      refreshOrderSubtotal(tx, order.id)
      this.record(tx, auth, 'kot.cancelled', kot, order, {
        statusFrom: kot.status,
        reason: input.reason,
        items: items.length
      })
      this.syncOrderStatus(tx, order.id)
    })
    return this.get(input.id)
  }

  // --- Hooks for the order service (inside its transaction) --------------------------------

  /**
   * An item that was already on a ticket is cancelled: the ticket keeps the item, struck through,
   * and its revision goes up so it is reprinted. A ticket left with nothing to cook is cancelled.
   */
  onLineCancelled(
    tx: DbExecutor,
    auth: AuthContext,
    order: OrderRow,
    orderItemId: string,
    reason: string
  ): void {
    const now = new Date(this.clock())
    const affected = tx
      .select()
      .from(kotItems)
      .where(
        and(
          eq(kotItems.orderItemId, orderItemId),
          eq(kotItems.status, 'ACTIVE'),
          isNull(kotItems.deletedAt)
        )
      )
      .all()
    for (const item of affected) {
      tx.update(kotItems)
        .set({
          status: 'CANCELLED',
          cancelReason: reason,
          cancelledAt: now,
          ...markModified(kotItems)
        })
        .where(eq(kotItems.id, item.id))
        .run()
      const kot = tx.select().from(kots).where(eq(kots.id, item.kotId)).get()
      if (!kot) continue
      if (isRestockable(kot.status)) {
        this.inventory.restore(tx, auth, [orderItemId], `${item.itemName} cancelled`)
      }
      const nothingLeft = this.activeItems(tx, kot.id).length === 0
      if (nothingLeft && kot.status !== 'CANCELLED' && kot.status !== 'SERVED') {
        this.cancelTicket(tx, kot, 'Every item on this ticket was cancelled.', now, auth.userId)
      } else {
        tx.update(kots)
          .set({ revision: sql`${kots.revision} + 1`, ...markModified(kots) })
          .where(eq(kots.id, kot.id))
          .run()
      }
      this.record(tx, auth, 'kot.item_cancelled', kot, order, {
        item: item.itemName,
        quantity: item.quantity,
        reason
      })
    }
    if (affected.length > 0) this.syncOrderStatus(tx, order.id)
  }

  /** The order is cancelled: tickets the kitchen has not finished serving are cancelled too. */
  onOrderCancelled(
    tx: DbExecutor,
    auth: AuthContext,
    order: OrderRow,
    reason: string | null
  ): void {
    const now = new Date(this.clock())
    const text = reason ?? 'The order was cancelled.'
    const open = tx
      .select()
      .from(kots)
      .where(
        and(
          eq(kots.orderId, order.id),
          isNull(kots.deletedAt),
          inArray(kots.status, [...OPEN_KOT_STATUSES])
        )
      )
      .all()
    for (const kot of open) {
      if (isRestockable(kot.status)) {
        this.inventory.restore(
          tx,
          auth,
          this.activeItems(tx, kot.id).map((item) => item.orderItemId),
          'Order cancelled'
        )
      }
      for (const item of this.activeItems(tx, kot.id)) {
        tx.update(kotItems)
          .set({
            status: 'CANCELLED',
            cancelReason: text,
            cancelledAt: now,
            ...markModified(kotItems)
          })
          .where(eq(kotItems.id, item.id))
          .run()
      }
      this.cancelTicket(tx, kot, text, now, auth.userId)
      this.record(tx, auth, 'kot.cancelled', kot, order, {
        statusFrom: kot.status,
        reason: text,
        viaOrder: true
      })
    }
  }

  /** The order is marked served by hand: every ticket still in the kitchen counts as served. */
  onOrderServed(tx: DbExecutor, orderId: string): void {
    const now = new Date(this.clock())
    tx.update(kots)
      .set({ status: 'SERVED', servedAt: now, ...markModified(kots) })
      .where(
        and(
          eq(kots.orderId, orderId),
          isNull(kots.deletedAt),
          inArray(kots.status, [...OPEN_KOT_STATUSES])
        )
      )
      .run()
  }

  /**
   * Puts the order's status in step with its tickets: cooking has started, the food is ready, all
   * of it was served, or new tickets are waiting. Orders past serving (bill asked for) and closed
   * orders are left alone.
   */
  syncOrderStatus(tx: DbExecutor, orderId: string): void {
    const order = tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
      .get()
    if (!order || !FOLLOWS_KITCHEN.includes(order.status)) return

    const live = tx
      .select({ status: kots.status })
      .from(kots)
      .where(and(eq(kots.orderId, orderId), isNull(kots.deletedAt), ne(kots.status, 'CANCELLED')))
      .all()
      .map((row) => row.status)
    const target = deriveOrderStatus(live)
    if (!target || target === order.status) return
    moveOrderStatus(tx, order, target, {
      ...(order.confirmedAt ? {} : { confirmedAt: new Date(this.clock()) })
    })
  }

  // --- Printing bookkeeping ----------------------------------------------------------------

  /** Remembers the outcome of a print attempt on the ticket. */
  recordPrint(
    tx: DbExecutor,
    kotId: string,
    outcome: { status: PrintStatus; error: string | null }
  ): void {
    const kot = tx.select().from(kots).where(eq(kots.id, kotId)).get()
    if (!kot) return
    const now = new Date(this.clock())
    if (outcome.status === 'PRINTED') {
      tx.update(kots)
        .set({
          printCount: sql`${kots.printCount} + 1`,
          firstPrintedAt: kot.firstPrintedAt ?? now,
          lastPrintedAt: now,
          printedRevision: kot.revision,
          lastPrintStatus: 'PRINTED',
          lastPrintError: null,
          ...markModified(kots)
        })
        .where(eq(kots.id, kotId))
        .run()
    } else {
      tx.update(kots)
        .set({
          lastPrintStatus: 'FAILED',
          lastPrintError: outcome.error,
          ...markModified(kots)
        })
        .where(eq(kots.id, kotId))
        .run()
    }
  }

  // --- Internals ---------------------------------------------------------------------------

  private stamp(status: KotStatus, now: Date): Partial<typeof kots.$inferInsert> {
    switch (status) {
      case 'ACCEPTED':
        return { acceptedAt: now }
      case 'PREPARING':
        return { preparingAt: now }
      case 'READY':
        return { readyAt: now }
      case 'SERVED':
        return { servedAt: now }
      default:
        return {}
    }
  }

  private cancelTicket(
    tx: DbExecutor,
    kot: KotRow,
    reason: string,
    now: Date,
    userId: string
  ): void {
    tx.update(kots)
      .set({
        status: 'CANCELLED',
        cancelReason: reason,
        cancelledAt: now,
        cancelledBy: userId,
        revision: sql`${kots.revision} + 1`,
        ...markModified(kots)
      })
      .where(eq(kots.id, kot.id))
      .run()
    // Items still active on the ticket are cancelled with it.
    tx.update(kotItems)
      .set({
        status: 'CANCELLED',
        cancelReason: reason,
        cancelledAt: now,
        ...markModified(kotItems)
      })
      .where(and(eq(kotItems.kotId, kot.id), eq(kotItems.status, 'ACTIVE')))
      .run()
  }

  /** Cancels the order line behind a ticket item, as if staff had cancelled it on the order. */
  private cancelOrderLine(
    tx: DbExecutor,
    auth: AuthContext,
    orderItemId: string,
    reason: string,
    now: Date
  ): void {
    tx.update(orderItems)
      .set({
        status: 'CANCELLED',
        cancelReason: reason,
        cancelledAt: now,
        cancelledBy: auth.userId,
        ...markModified(orderItems)
      })
      .where(and(eq(orderItems.id, orderItemId), ne(orderItems.status, 'CANCELLED')))
      .run()
  }

  private activeItems(db: DbExecutor, kotId: string): KotItemRow[] {
    return db
      .select()
      .from(kotItems)
      .where(
        and(eq(kotItems.kotId, kotId), eq(kotItems.status, 'ACTIVE'), isNull(kotItems.deletedAt))
      )
      .all()
  }

  private requireKot(db: DbExecutor, id: string): { kot: KotRow; order: OrderRow } {
    const kot = db
      .select()
      .from(kots)
      .where(and(eq(kots.id, id), isNull(kots.deletedAt)))
      .get()
    if (!kot) throw new AppError('NOT_FOUND', 'That ticket no longer exists.')
    const order = db.select().from(orders).where(eq(orders.id, kot.orderId)).get()
    if (!order) throw new AppError('NOT_FOUND', 'The order of this ticket no longer exists.')
    return { kot, order }
  }

  private assertOrderOpen(order: OrderRow): void {
    if (CLOSED_ORDER_STATUSES.includes(order.status)) {
      throw new AppError(
        'CONFLICT',
        order.status === 'CANCELLED'
          ? 'The order of this ticket was cancelled.'
          : 'The order of this ticket is completed.'
      )
    }
  }

  private assertOrderEditable(order: OrderRow): void {
    this.assertOrderOpen(order)
    if (!EDITABLE_ORDER_STATUSES.includes(order.status)) {
      throw new AppError(
        'CONFLICT',
        'The bill was requested. Reopen the order (mark it served) to change items.'
      )
    }
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: AuditAction,
    kot: KotRow,
    order: OrderRow,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'kot',
        entityId: kot.id,
        details: { kotNumber: kot.kotNumber, orderNumber: order.orderNumber, ...details }
      },
      tx
    )
  }

  // --- Loading -----------------------------------------------------------------------------

  private loadSummaries(
    db: DbExecutor,
    conditions: SQL[],
    limit: number,
    oldestFirst: boolean
  ): KotSummary[] {
    const rows = db
      .select({
        kot: kots,
        orderNumber: orders.orderNumber,
        orderType: orders.type,
        customerName: orders.customerName,
        tableNumber: diningTables.tableNumber,
        tableName: diningTables.displayName,
        areaName: areas.name,
        createdByName: users.fullName
      })
      .from(kots)
      .innerJoin(orders, eq(orders.id, kots.orderId))
      .leftJoin(diningTables, eq(diningTables.id, orders.tableId))
      .leftJoin(areas, eq(areas.id, diningTables.areaId))
      .innerJoin(users, eq(users.id, kots.createdBy))
      .where(and(isNull(kots.deletedAt), ...conditions))
      .orderBy(
        oldestFirst ? asc(kots.createdAt) : desc(kots.createdAt),
        oldestFirst ? asc(kots.kotNumber) : desc(kots.kotNumber)
      )
      .limit(limit)
      .all()
    if (rows.length === 0) return []

    const counts = db
      .select({
        kotId: kotItems.kotId,
        total: sql<number>`coalesce(sum(${kotItems.quantity}), 0)`
      })
      .from(kotItems)
      .where(
        and(
          inArray(
            kotItems.kotId,
            rows.map((row) => row.kot.id)
          ),
          eq(kotItems.status, 'ACTIVE'),
          isNull(kotItems.deletedAt)
        )
      )
      .groupBy(kotItems.kotId)
      .all()
    const itemCount = new Map(counts.map((count) => [count.kotId, count.total]))

    return rows.map(({ kot, ...rest }) => ({
      id: kot.id,
      kotNumber: kot.kotNumber,
      orderId: kot.orderId,
      orderNumber: rest.orderNumber,
      orderType: rest.orderType,
      tableNumber: rest.tableNumber,
      tableName: rest.tableName,
      areaName: rest.areaName,
      customerName: rest.customerName,
      stationId: kot.stationId,
      stationName: kot.stationName,
      status: kot.status,
      isAdditional: kot.isAdditional,
      revision: kot.revision,
      itemCount: itemCount.get(kot.id) ?? 0,
      printStatus: printStatusOf(kot),
      printCount: kot.printCount,
      lastPrintError: kot.lastPrintStatus === 'FAILED' ? kot.lastPrintError : null,
      createdByName: rest.createdByName,
      createdAt: kot.createdAt.toISOString(),
      acceptedAt: iso(kot.acceptedAt),
      preparingAt: iso(kot.preparingAt),
      readyAt: iso(kot.readyAt),
      servedAt: iso(kot.servedAt),
      cancelledAt: iso(kot.cancelledAt),
      cancelReason: kot.cancelReason
    }))
  }

  private loadDetail(db: DbExecutor, id: string): KotDetail {
    const summary = this.loadSummaries(db, [eq(kots.id, id)], 1, true)[0]
    if (!summary) throw new AppError('NOT_FOUND', 'That ticket no longer exists.')
    const order = db.select().from(orders).where(eq(orders.id, summary.orderId)).get()
    const items = db
      .select()
      .from(kotItems)
      .where(and(eq(kotItems.kotId, id), isNull(kotItems.deletedAt)))
      .orderBy(asc(kotItems.sortOrder))
      .all()
      .map((item): KotItem => ({
        id: item.id,
        orderItemId: item.orderItemId,
        name: item.itemName,
        variantName: item.variantName,
        foodType: item.foodType,
        quantity: item.quantity,
        addons: item.addons,
        notes: item.notes,
        status: item.status,
        cancelReason: item.cancelReason
      }))
    return {
      ...summary,
      items,
      orderNotes: order?.notes ?? null,
      guestCount: order?.guestCount ?? null,
      customerPhone: order?.customerPhone ?? null,
      deliveryAddress: order?.deliveryAddress ?? null,
      promisedAt: iso(order?.promisedAt ?? null)
    }
  }
}

function printStatusOf(kot: KotRow): KotPrintStatus {
  if (kot.lastPrintStatus === 'FAILED') return 'FAILED'
  if (kot.printCount === 0) return 'NOT_PRINTED'
  return kot.printedRevision < kot.revision ? 'NEEDS_REPRINT' : 'PRINTED'
}

/**
 * The status an order should show for its live (not cancelled) tickets. Cooking has started
 * if any ticket is preparing; otherwise an accepted ticket means the kitchen has it; otherwise
 * new tickets mean the kitchen has not looked yet (also when older tickets are ready or served:
 * there is new work). When everything is ready or served, the order is ready, or served.
 * Null when there are no live tickets.
 */
export function deriveOrderStatus(tickets: readonly KotStatus[]): OrderStatus | null {
  const live = tickets.filter((status) => status !== 'CANCELLED')
  if (live.length === 0) return null
  const unfinished = live.filter((status) => status !== 'SERVED')
  if (unfinished.length === 0) return 'SERVED'
  if (unfinished.includes('PREPARING')) return 'PREPARING'
  if (unfinished.includes('ACCEPTED')) return 'KOT_PENDING'
  if (unfinished.includes('NEW')) return 'CONFIRMED'
  return 'READY'
}
