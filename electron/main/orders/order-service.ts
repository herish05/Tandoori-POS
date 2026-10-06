import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql, type SQL } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext, Clock } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import {
  areas,
  categories,
  diningTables,
  kitchenStations,
  markModified,
  menuAddons,
  menuItemAddons,
  menuItems,
  menuVariants,
  orderItemAddons,
  orderItems,
  orders,
  taxCategories,
  users
} from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import {
  CANCELLABLE_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  EDITABLE_ORDER_STATUSES,
  MAX_ORDER_LINES,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  TABLE_STATUS_FOR_ORDER,
  computeLineTotal,
  type AddItemsData,
  type CancelLineData,
  type CancelOrderData,
  type CreateOrderData,
  type OrderDetail,
  type OrderFilterData,
  type OrderLine,
  type OrderLineData,
  type OrderStatus,
  type OrderSummary,
  type RemoveLineData,
  type SetOrderStatusData,
  type UpdateLineData,
  type UpdateOrderData
} from '@shared/orders'
import { nextDocumentNumber } from './numbering'

type OrderRow = typeof orders.$inferSelect
type LineRow = typeof orderItems.$inferSelect

const OPENABLE_TABLE_STATUSES = ['AVAILABLE', 'RESERVED'] as const

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (match) => `\\${match}`)

/** A line that is ready to be stored, with its add-ons. */
interface PreparedLine {
  values: typeof orderItems.$inferInsert
  addons: (typeof orderItemAddons.$inferInsert)[]
}

export class OrderService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  list(filter: OrderFilterData = {}): OrderSummary[] {
    const conditions: SQL[] = []
    if (filter.activeOnly) {
      conditions.push(notInArray(orders.status, [...CLOSED_ORDER_STATUSES]))
    }
    if (filter.statuses && filter.statuses.length > 0) {
      conditions.push(inArray(orders.status, filter.statuses))
    }
    if (filter.type) conditions.push(eq(orders.type, filter.type))
    if (filter.tableId) conditions.push(eq(orders.tableId, filter.tableId))
    if (filter.search) {
      const like = `%${escapeLike(filter.search)}%`
      conditions.push(
        sql`(${orders.orderNumber} like ${like} escape '\\'
          or ${orders.customerName} like ${like} escape '\\'
          or ${orders.customerPhone} like ${like} escape '\\')`
      )
    }
    return this.loadSummaries(this.db, conditions, filter.limit ?? 200)
  }

  get(id: string): OrderDetail {
    return this.loadDetail(this.db, id)
  }

  // --- Writes ------------------------------------------------------------------------------

  /** Creates an order with its first lines; a dine-in order also opens its table. */
  create(auth: AuthContext, input: CreateOrderData): OrderDetail {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      if (input.type === 'DINE_IN' && input.tableId) {
        this.claimTable(tx, auth, input.tableId, input.guestCount)
      }

      const orderNumber = nextDocumentNumber(tx, restaurantId, 'ORD')
      const row = tx
        .insert(orders)
        .values({
          restaurantId,
          orderNumber,
          type: input.type,
          status: 'DRAFT',
          tableId: input.type === 'DINE_IN' ? input.tableId : null,
          guestCount: input.type === 'DINE_IN' ? input.guestCount : null,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          deliveryAddress: input.deliveryAddress,
          notes: input.notes,
          createdBy: auth.userId
        })
        .returning()
        .get()

      this.insertLines(tx, restaurantId, row.id, input.lines)
      const subtotal = this.refreshSubtotal(tx, row.id)
      this.record(tx, auth, 'order.created', row, {
        type: row.type,
        tableId: row.tableId,
        lines: input.lines.length,
        subtotal
      })
      return row.id
    })
    return this.get(id)
  }

  /** Edits the order's header: guests, customer details and notes. Type and table are fixed. */
  update(auth: AuthContext, input: UpdateOrderData): OrderDetail {
    this.db.transaction((tx) => {
      const order = this.requireOrder(tx, input.id)
      this.assertOpen(order)

      if (order.type === 'DELIVERY') {
        if (!input.customerName) {
          throw new AppError('VALIDATION_ERROR', 'Enter the customer name for a delivery.')
        }
        if (!input.customerPhone) {
          throw new AppError('VALIDATION_ERROR', 'Enter a phone number for a delivery.')
        }
        if (!input.deliveryAddress) {
          throw new AppError('VALIDATION_ERROR', 'Enter the delivery address.')
        }
      }
      const guestCount = order.type === 'DINE_IN' ? input.guestCount : null
      const next = {
        guestCount,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        deliveryAddress: input.deliveryAddress,
        notes: input.notes
      }
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
        (field) => next[field] !== order[field]
      )
      if (changed.length === 0) return

      tx.update(orders)
        .set({ ...next, ...markModified(orders) })
        .where(eq(orders.id, order.id))
        .run()
      if (order.tableId && changed.includes('guestCount')) {
        tx.update(diningTables)
          .set({ guestCount, ...markModified(diningTables) })
          .where(eq(diningTables.id, order.tableId))
          .run()
      }
      this.record(tx, auth, 'order.updated', order, { changedFields: changed })
    })
    return this.get(input.id)
  }

  addItems(auth: AuthContext, input: AddItemsData): OrderDetail {
    this.db.transaction((tx) => {
      const order = this.requireOrder(tx, input.orderId)
      this.assertEditable(order)
      const existing = tx
        .select({ total: sql<number>`count(*)` })
        .from(orderItems)
        .where(and(eq(orderItems.orderId, order.id), isNull(orderItems.deletedAt)))
        .get()
      if ((existing?.total ?? 0) + input.lines.length > MAX_ORDER_LINES) {
        throw new AppError(
          'CONFLICT',
          `An order can have at most ${String(MAX_ORDER_LINES)} lines.`
        )
      }

      this.insertLines(tx, order.restaurantId, order.id, input.lines)
      const subtotal = this.refreshSubtotal(tx, order.id)
      this.record(tx, auth, 'order.items_added', order, {
        lines: input.lines.length,
        subtotal
      })
    })
    return this.get(input.orderId)
  }

  /** Quantity and instructions can change until the line is sent to the kitchen. */
  updateLine(auth: AuthContext, input: UpdateLineData): OrderDetail {
    this.db.transaction((tx) => {
      const order = this.requireOrder(tx, input.orderId)
      this.assertEditable(order)
      const line = this.requireLine(tx, order.id, input.lineId)
      if (line.status !== 'NEW') {
        throw new AppError(
          'CONFLICT',
          line.status === 'CANCELLED'
            ? 'This item is already cancelled.'
            : 'This item was already sent to the kitchen. Add it again as a new item, or cancel it.'
        )
      }
      if (line.quantity === input.quantity && line.notes === input.notes) return

      tx.update(orderItems)
        .set({
          quantity: input.quantity,
          notes: input.notes,
          lineTotal: computeLineTotal(line.unitPrice, line.addonTotal, input.quantity),
          ...markModified(orderItems)
        })
        .where(eq(orderItems.id, line.id))
        .run()
      this.refreshSubtotal(tx, order.id)
      this.record(tx, auth, 'order.item_updated', order, {
        item: line.itemName,
        quantityFrom: line.quantity,
        quantityTo: input.quantity
      })
    })
    return this.get(input.orderId)
  }

  /** Takes a line that was never sent off the order altogether. */
  removeLine(auth: AuthContext, input: RemoveLineData): OrderDetail {
    this.db.transaction((tx) => {
      const order = this.requireOrder(tx, input.orderId)
      this.assertEditable(order)
      const line = this.requireLine(tx, order.id, input.lineId)
      if (line.status !== 'NEW') {
        throw new AppError(
          'CONFLICT',
          line.status === 'CANCELLED'
            ? 'This item is already cancelled.'
            : 'This item was already sent to the kitchen. Cancel it instead.'
        )
      }
      tx.update(orderItems)
        .set({ deletedAt: new Date(this.clock()), ...markModified(orderItems) })
        .where(eq(orderItems.id, line.id))
        .run()
      this.refreshSubtotal(tx, order.id)
      this.record(tx, auth, 'order.item_removed', order, {
        item: line.itemName,
        quantity: line.quantity
      })
    })
    return this.get(input.orderId)
  }

  /** A line the kitchen already knows about stays on the order, struck through, with the reason. */
  cancelLine(auth: AuthContext, input: CancelLineData): OrderDetail {
    this.db.transaction((tx) => {
      const order = this.requireOrder(tx, input.orderId)
      this.assertEditable(order)
      const line = this.requireLine(tx, order.id, input.lineId)
      if (line.status === 'CANCELLED') {
        throw new AppError('CONFLICT', 'This item is already cancelled.')
      }
      if (line.status === 'NEW') {
        throw new AppError(
          'CONFLICT',
          'This item was not sent to the kitchen yet. Remove it instead.'
        )
      }
      tx.update(orderItems)
        .set({
          status: 'CANCELLED',
          cancelReason: input.reason,
          cancelledAt: new Date(this.clock()),
          cancelledBy: auth.userId,
          ...markModified(orderItems)
        })
        .where(eq(orderItems.id, line.id))
        .run()
      this.refreshSubtotal(tx, order.id)
      this.record(tx, auth, 'order.item_cancelled', order, {
        item: line.itemName,
        quantity: line.quantity,
        reason: input.reason
      })
    })
    return this.get(input.orderId)
  }

  /**
   * Sends everything not yet sent to the kitchen. A draft becomes CONFIRMED. On an order that
   * is further along, new items put it back to CONFIRMED when everything before was already
   * ready or served (there is new work again); otherwise its status stays.
   */
  send(auth: AuthContext, id: string): OrderDetail {
    this.db.transaction((tx) => {
      const order = this.requireOrder(tx, id)
      this.assertEditable(order)
      const pending = this.lines(tx, order.id).filter((line) => line.status === 'NEW')
      if (pending.length === 0) {
        throw new AppError('CONFLICT', 'There is nothing new to send to the kitchen.')
      }
      const now = new Date(this.clock())
      tx.update(orderItems)
        .set({ status: 'SENT', sentAt: now, ...markModified(orderItems) })
        .where(
          and(
            eq(orderItems.orderId, order.id),
            eq(orderItems.status, 'NEW'),
            isNull(orderItems.deletedAt)
          )
        )
        .run()

      const next: OrderStatus =
        order.status === 'DRAFT' || order.status === 'READY' || order.status === 'SERVED'
          ? 'CONFIRMED'
          : order.status
      if (next !== order.status) {
        this.moveOrder(tx, order, next, { confirmedAt: order.confirmedAt ?? now })
      } else {
        this.touch(tx, order.id)
      }
      this.record(tx, auth, 'order.sent', order, {
        lines: pending.length,
        quantity: pending.reduce((sum, line) => sum + line.quantity, 0),
        statusFrom: order.status,
        statusTo: next
      })
    })
    return this.get(id)
  }

  /** Moves an order along its life: kitchen steps, served, bill requested. */
  setStatus(auth: AuthContext, input: SetOrderStatusData): OrderDetail {
    this.db.transaction((tx) => {
      const order = this.requireOrder(tx, input.id)
      const allowed = ORDER_TRANSITIONS[order.status]
      if (!allowed.includes(input.status)) {
        throw new AppError(
          'CONFLICT',
          `An order that is "${ORDER_STATUS_LABELS[order.status]}" cannot be marked "${ORDER_STATUS_LABELS[input.status]}".`
        )
      }
      if (input.status === 'SERVED' || input.status === 'BILL_REQUESTED') {
        const lines = this.lines(tx, order.id)
        if (lines.some((line) => line.status === 'NEW')) {
          throw new AppError('CONFLICT', 'Send the new items to the kitchen first.')
        }
        if (
          input.status === 'BILL_REQUESTED' &&
          !lines.some((line) => line.status !== 'CANCELLED')
        ) {
          throw new AppError('CONFLICT', 'There is nothing to bill on this order.')
        }
      }
      this.moveOrder(tx, order, input.status)
      this.record(tx, auth, 'order.status_changed', order, {
        statusFrom: order.status,
        statusTo: input.status
      })
    })
    return this.get(input.id)
  }

  /**
   * Cancels the whole order and frees its table. A draft that was never sent can be dropped by
   * anyone who takes orders; anything the kitchen already knows about needs the cancel permission
   * and a reason.
   */
  cancel(auth: AuthContext, input: CancelOrderData): OrderDetail {
    this.db.transaction((tx) => {
      const order = this.requireOrder(tx, input.id)
      if (!CANCELLABLE_ORDER_STATUSES.includes(order.status)) {
        throw new AppError('CONFLICT', this.uncancellableMessage(order.status))
      }
      if (order.status !== 'DRAFT') {
        if (!auth.permissions.has('orders.cancel')) {
          throw new AppError('FORBIDDEN', 'You are not allowed to cancel an order in progress.')
        }
        if (!input.reason || input.reason.length < 3) {
          throw new AppError('VALIDATION_ERROR', 'Say why the order is being cancelled.')
        }
      }
      this.moveOrder(tx, order, 'CANCELLED', {
        cancelReason: input.reason,
        cancelledAt: new Date(this.clock()),
        cancelledBy: auth.userId
      })
      this.record(tx, auth, 'order.cancelled', order, {
        statusFrom: order.status,
        reason: input.reason
      })
    })
    return this.get(input.id)
  }

  // --- Table handling ----------------------------------------------------------------------

  /**
   * Makes the table ready for a new order: a free table is opened (so the floor shows it
   * occupied), a table staff opened by hand is reused, anything else is refused.
   */
  private claimTable(
    tx: DbExecutor,
    auth: AuthContext,
    tableId: string,
    guestCount: number | null
  ): void {
    const table = tx
      .select()
      .from(diningTables)
      .where(and(eq(diningTables.id, tableId), isNull(diningTables.deletedAt)))
      .get()
    if (!table) throw new AppError('NOT_FOUND', 'That table no longer exists.')
    const area = tx.select().from(areas).where(eq(areas.id, table.areaId)).get()
    if (!table.isActive || !area?.isActive) {
      throw new AppError('CONFLICT', 'This table is not in use. Activate it first.')
    }
    if (table.status === 'BLOCKED') {
      throw new AppError('CONFLICT', 'This table is blocked. Unblock it first.')
    }

    const running = tx
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
      throw new AppError('CONFLICT', `This table already has order ${running.orderNumber} open.`)
    }

    if (table.status === 'AVAILABLE' || table.status === 'RESERVED') {
      // Guarded by the expected status so two terminals can never both take the same table.
      const result = tx
        .update(diningTables)
        .set({
          status: 'OCCUPIED',
          openedAt: new Date(this.clock()),
          openedBy: auth.userId,
          guestCount,
          ...markModified(diningTables)
        })
        .where(
          and(
            eq(diningTables.id, table.id),
            inArray(diningTables.status, [...OPENABLE_TABLE_STATUSES])
          )
        )
        .run()
      if (result.changes !== 1) {
        throw new AppError('CONFLICT', 'This table was just taken somewhere else.')
      }
      this.audit.record(
        {
          action: 'table.opened',
          userId: auth.userId,
          username: auth.username,
          entityType: 'table',
          entityId: table.id,
          details: { tableNumber: table.tableNumber, guestCount, viaOrder: true }
        },
        tx
      )
      return
    }
    if (table.status !== 'OCCUPIED') {
      throw new AppError('CONFLICT', 'This table must be closed before a new order can start.')
    }
    if (guestCount !== null && guestCount !== table.guestCount) {
      tx.update(diningTables)
        .set({ guestCount, ...markModified(diningTables) })
        .where(eq(diningTables.id, table.id))
        .run()
    }
  }

  /** Changes the order's status and makes the table show the matching state. */
  private moveOrder(
    tx: DbExecutor,
    order: OrderRow,
    status: OrderStatus,
    extra: Partial<typeof orders.$inferInsert> = {}
  ): void {
    const result = tx
      .update(orders)
      .set({ ...extra, status, ...markModified(orders) })
      .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
      .run()
    if (result.changes !== 1) {
      throw new AppError('CONFLICT', 'This order was just changed somewhere else. Reopen it.')
    }
    if (!order.tableId) return

    const target = TABLE_STATUS_FOR_ORDER[status]
    tx.update(diningTables)
      .set({
        status: target,
        ...(target === 'AVAILABLE' ? { openedAt: null, openedBy: null, guestCount: null } : {}),
        ...markModified(diningTables)
      })
      .where(eq(diningTables.id, order.tableId))
      .run()
  }

  // --- Lines -------------------------------------------------------------------------------

  private insertLines(
    tx: DbExecutor,
    restaurantId: string,
    orderId: string,
    lines: readonly OrderLineData[]
  ): void {
    for (const input of lines) {
      const prepared = this.prepareLine(tx, restaurantId, orderId, input)
      const row = tx.insert(orderItems).values(prepared.values).returning().get()
      for (const addon of prepared.addons) {
        tx.insert(orderItemAddons)
          .values({ ...addon, orderItemId: row.id })
          .run()
      }
    }
  }

  /**
   * Checks that the item can be ordered and prices it from the menu as it is right now; the
   * client only says what and how many, never how much.
   */
  private prepareLine(
    tx: DbExecutor,
    restaurantId: string,
    orderId: string,
    input: OrderLineData
  ): PreparedLine {
    const item = tx
      .select()
      .from(menuItems)
      .where(
        and(
          eq(menuItems.id, input.menuItemId),
          eq(menuItems.restaurantId, restaurantId),
          isNull(menuItems.deletedAt)
        )
      )
      .get()
    if (!item?.isActive) {
      throw new AppError('CONFLICT', 'That item is no longer on the menu.')
    }
    const category = tx.select().from(categories).where(eq(categories.id, item.categoryId)).get()
    if (!category?.isActive || category.deletedAt) {
      throw new AppError('CONFLICT', `"${item.name}" is not on the menu right now.`)
    }
    if (!item.isAvailable) {
      throw new AppError('CONFLICT', `"${item.name}" is sold out.`)
    }

    const variants = tx
      .select()
      .from(menuVariants)
      .where(and(eq(menuVariants.menuItemId, item.id), isNull(menuVariants.deletedAt)))
      .orderBy(asc(menuVariants.sortOrder))
      .all()
    let unitPrice = item.price
    let variantId: string | null = null
    let variantName: string | null = null
    if (variants.length > 0) {
      const chosen = input.variantId
        ? variants.find((variant) => variant.id === input.variantId)
        : (variants.find((variant) => variant.isDefault) ?? variants[0])
      if (!chosen) {
        throw new AppError('VALIDATION_ERROR', `Choose a valid size for "${item.name}".`)
      }
      if (!chosen.isAvailable) {
        throw new AppError('CONFLICT', `"${item.name} (${chosen.name})" is sold out.`)
      }
      unitPrice = chosen.price
      variantId = chosen.id
      variantName = chosen.name
    } else if (input.variantId) {
      throw new AppError('VALIDATION_ERROR', `"${item.name}" has no sizes to choose from.`)
    }

    const offered = new Map(
      input.addonIds.length === 0
        ? []
        : tx
            .select({ addon: menuAddons })
            .from(menuItemAddons)
            .innerJoin(menuAddons, eq(menuAddons.id, menuItemAddons.addonId))
            .where(
              and(
                eq(menuItemAddons.menuItemId, item.id),
                inArray(menuItemAddons.addonId, input.addonIds),
                isNull(menuAddons.deletedAt)
              )
            )
            .all()
            .map((row) => [row.addon.id, row.addon] as const)
    )
    const addons: PreparedLine['addons'] = []
    for (const [index, addonId] of input.addonIds.entries()) {
      const addon = offered.get(addonId)
      if (!addon) {
        throw new AppError('VALIDATION_ERROR', `That extra is not offered with "${item.name}".`)
      }
      if (!addon.isActive) {
        throw new AppError('CONFLICT', `"${addon.name}" is not available right now.`)
      }
      addons.push({
        orderItemId: '',
        addonId: addon.id,
        name: addon.name,
        kind: addon.kind,
        price: addon.kind === 'MODIFIER' ? 0 : addon.price,
        sortOrder: index
      })
    }
    const addonTotal = addons.reduce((sum, addon) => sum + (addon.price ?? 0), 0)

    const tax = item.taxCategoryId
      ? tx.select().from(taxCategories).where(eq(taxCategories.id, item.taxCategoryId)).get()
      : undefined

    return {
      values: {
        orderId,
        menuItemId: item.id,
        variantId,
        itemName: item.name,
        variantName,
        foodType: item.foodType,
        unitPrice,
        addonTotal,
        quantity: input.quantity,
        lineTotal: computeLineTotal(unitPrice, addonTotal, input.quantity),
        notes: input.notes,
        status: 'NEW',
        stationId: item.stationId ?? category.stationId ?? null,
        taxName: tax?.name ?? null,
        taxRateBps: tax?.rateBps ?? null
      },
      addons
    }
  }

  /** Re-adds the live lines into the order's subtotal and bumps its version. */
  private refreshSubtotal(tx: DbExecutor, orderId: string): number {
    const sum = tx
      .select({ total: sql<number>`coalesce(sum(${orderItems.lineTotal}), 0)` })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.orderId, orderId),
          isNull(orderItems.deletedAt),
          ne(orderItems.status, 'CANCELLED')
        )
      )
      .get()
    const subtotal = sum?.total ?? 0
    tx.update(orders)
      .set({ subtotal, ...markModified(orders) })
      .where(eq(orders.id, orderId))
      .run()
    return subtotal
  }

  private touch(tx: DbExecutor, orderId: string): void {
    tx.update(orders).set(markModified(orders)).where(eq(orders.id, orderId)).run()
  }

  private lines(db: DbExecutor, orderId: string): LineRow[] {
    return db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), isNull(orderItems.deletedAt)))
      .orderBy(asc(orderItems.createdAt), sql`rowid`)
      .all()
  }

  private requireLine(db: DbExecutor, orderId: string, lineId: string): LineRow {
    const row = db
      .select()
      .from(orderItems)
      .where(
        and(
          eq(orderItems.id, lineId),
          eq(orderItems.orderId, orderId),
          isNull(orderItems.deletedAt)
        )
      )
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That item is no longer on this order.')
    return row
  }

  // --- Guards ------------------------------------------------------------------------------

  private requireOrder(db: DbExecutor, id: string): OrderRow {
    const row = db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That order no longer exists.')
    return row
  }

  /** Header details (guests, customer, notes) can change until the order is finished. */
  private assertOpen(order: OrderRow): void {
    if (CLOSED_ORDER_STATUSES.includes(order.status)) {
      throw new AppError(
        'CONFLICT',
        order.status === 'CANCELLED'
          ? 'This order was cancelled.'
          : 'This order is completed and can no longer be changed.'
      )
    }
  }

  /** Items can change until the bill is asked for. */
  private assertEditable(order: OrderRow): void {
    this.assertOpen(order)
    if (!EDITABLE_ORDER_STATUSES.includes(order.status)) {
      throw new AppError(
        'CONFLICT',
        'The bill was requested. Reopen the order (mark it served) to change items.'
      )
    }
  }

  private uncancellableMessage(status: OrderStatus): string {
    switch (status) {
      case 'CANCELLED':
        return 'This order was already cancelled.'
      case 'COMPLETED':
        return 'A completed order cannot be cancelled.'
      default:
        return 'The food was already served. Cancel individual items, or settle the bill.'
    }
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

  // --- Loading -----------------------------------------------------------------------------

  private loadSummaries(db: DbExecutor, conditions: SQL[], limit: number): OrderSummary[] {
    const rows = db
      .select({
        order: orders,
        tableNumber: diningTables.tableNumber,
        tableName: diningTables.displayName,
        areaName: areas.name,
        createdByName: users.fullName
      })
      .from(orders)
      .leftJoin(diningTables, eq(diningTables.id, orders.tableId))
      .leftJoin(areas, eq(areas.id, diningTables.areaId))
      .innerJoin(users, eq(users.id, orders.createdBy))
      .where(and(isNull(orders.deletedAt), ...conditions))
      .orderBy(desc(orders.createdAt), desc(orders.orderNumber))
      .limit(limit)
      .all()
    if (rows.length === 0) return []

    const counts = db
      .select({
        orderId: orderItems.orderId,
        total: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`
      })
      .from(orderItems)
      .where(
        and(
          inArray(
            orderItems.orderId,
            rows.map((row) => row.order.id)
          ),
          isNull(orderItems.deletedAt),
          ne(orderItems.status, 'CANCELLED')
        )
      )
      .groupBy(orderItems.orderId)
      .all()
    const itemCount = new Map(counts.map((count) => [count.orderId, count.total]))

    return rows.map(({ order, tableNumber, tableName, areaName, createdByName }) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      type: order.type,
      status: order.status,
      tableId: order.tableId,
      tableNumber,
      tableName,
      areaName,
      guestCount: order.guestCount,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      itemCount: itemCount.get(order.id) ?? 0,
      subtotal: order.subtotal,
      createdByName,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString()
    }))
  }

  private loadDetail(db: DbExecutor, id: string): OrderDetail {
    const summary = this.loadSummaries(db, [eq(orders.id, id)], 1)[0]
    const order = db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .get()
    if (!summary || !order) throw new AppError('NOT_FOUND', 'That order no longer exists.')

    const lineRows = this.lines(db, id)
    const addonRows =
      lineRows.length === 0
        ? []
        : db
            .select()
            .from(orderItemAddons)
            .where(
              inArray(
                orderItemAddons.orderItemId,
                lineRows.map((line) => line.id)
              )
            )
            .orderBy(asc(orderItemAddons.sortOrder), sql`rowid`)
            .all()
    const stationNames = new Map(
      db
        .select({ id: kitchenStations.id, name: kitchenStations.name })
        .from(kitchenStations)
        .all()
        .map((station) => [station.id, station.name])
    )

    const lines = lineRows.map((line): OrderLine => ({
      id: line.id,
      menuItemId: line.menuItemId,
      variantId: line.variantId,
      name: line.itemName,
      variantName: line.variantName,
      foodType: line.foodType,
      unitPrice: line.unitPrice,
      addonTotal: line.addonTotal,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      addons: addonRows
        .filter((addon) => addon.orderItemId === line.id)
        .map((addon) => ({
          id: addon.id,
          name: addon.name,
          kind: addon.kind,
          price: addon.price
        })),
      notes: line.notes,
      status: line.status,
      cancelReason: line.cancelReason,
      stationId: line.stationId,
      stationName: line.stationId ? (stationNames.get(line.stationId) ?? null) : null,
      taxName: line.taxName,
      taxRateBps: line.taxRateBps,
      createdAt: line.createdAt.toISOString()
    }))

    return {
      ...summary,
      deliveryAddress: order.deliveryAddress,
      notes: order.notes,
      cancelReason: order.cancelReason,
      cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
      confirmedAt: order.confirmedAt ? order.confirmedAt.toISOString() : null,
      lines,
      hasUnsentLines: lines.some((line) => line.status === 'NEW')
    }
  }
}
