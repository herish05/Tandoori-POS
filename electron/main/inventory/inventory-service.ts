import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext, Clock } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import {
  inventoryItems,
  markModified,
  orders,
  recipeLines,
  stockMovements,
  users,
  type orderItems
} from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import {
  UNIT_LABELS,
  costOfQuantity,
  formatQuantity,
  type CreateInventoryItemData,
  type InventoryFilterData,
  type InventoryItem,
  type InventorySummary,
  type MovementFilterData,
  type MovementType,
  type SetInventoryItemActiveData,
  type StockCountData,
  type StockInData,
  type StockMovement,
  type UpdateInventoryItemData,
  type WastageData
} from '@shared/inventory'

type ItemRow = typeof inventoryItems.$inferSelect
type LineRow = Pick<
  typeof orderItems.$inferSelect,
  'id' | 'menuItemId' | 'variantId' | 'quantity' | 'itemName'
>

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (match) => `\\${match}`)

interface MovementExtras {
  unitCost?: number | null
  reason?: string | null
  orderId?: string | null
  orderItemId?: string | null
  reversesMovementId?: string | null
}

/**
 * The stock of raw materials. Every change goes through `post`, which moves the running total on
 * the item and writes the ledger row in the same transaction, so the two always agree. Selling
 * food takes stock out through `consume` (called when the kitchen ticket is issued) and a
 * cancelled ticket puts it back through `restore`.
 */
export class InventoryService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  summary(): InventorySummary {
    const active = this.load(this.db, [eq(inventoryItems.isActive, true)])
    return {
      activeItems: active.length,
      lowItems: active.filter((item) => item.isLow).length,
      outOfStockItems: active.filter((item) => item.onHand <= 0).length,
      stockValue: active.reduce((sum, item) => sum + item.stockValue, 0)
    }
  }

  list(filter: InventoryFilterData = {}): InventoryItem[] {
    const conditions: SQL[] = []
    if (!filter.includeInactive) conditions.push(eq(inventoryItems.isActive, true))
    if (filter.search) {
      const like = `%${escapeLike(filter.search)}%`
      conditions.push(
        sql`(${inventoryItems.name} like ${like} escape '\\' or ${inventoryItems.category} like ${like} escape '\\')`
      )
    }
    const items = this.load(this.db, conditions)
    return filter.lowOnly ? items.filter((item) => item.isLow || item.onHand <= 0) : items
  }

  get(id: string): InventoryItem {
    const found = this.load(this.db, [eq(inventoryItems.id, id)]).at(0)
    if (!found) throw new AppError('NOT_FOUND', 'That stock item no longer exists.')
    return found
  }

  /** The ledger, newest first. */
  movements(filter: MovementFilterData = {}): StockMovement[] {
    const conditions: SQL[] = [isNull(stockMovements.deletedAt)]
    if (filter.itemId) conditions.push(eq(stockMovements.inventoryItemId, filter.itemId))
    if (filter.types && filter.types.length > 0) {
      conditions.push(inArray(stockMovements.type, filter.types))
    }
    if (filter.from) conditions.push(gte(stockMovements.createdAt, new Date(filter.from)))
    if (filter.to) conditions.push(lt(stockMovements.createdAt, new Date(filter.to)))
    const rows = this.db
      .select({
        movement: stockMovements,
        itemName: inventoryItems.name,
        unit: inventoryItems.unit,
        orderNumber: orders.orderNumber,
        staff: users.fullName
      })
      .from(stockMovements)
      .innerJoin(inventoryItems, eq(inventoryItems.id, stockMovements.inventoryItemId))
      .leftJoin(orders, eq(orders.id, stockMovements.orderId))
      .leftJoin(users, eq(users.id, stockMovements.createdBy))
      .where(and(...conditions))
      .orderBy(desc(stockMovements.createdAt), sql`stock_movements.rowid desc`)
      .limit(filter.limit ?? 200)
      .all()
    return rows.map(({ movement, itemName, unit, orderNumber, staff }) => ({
      id: movement.id,
      itemId: movement.inventoryItemId,
      itemName,
      unit,
      type: movement.type,
      quantity: movement.quantity,
      balanceAfter: movement.balanceAfter,
      unitCost: movement.unitCost,
      reason: movement.reason,
      orderId: movement.orderId,
      orderNumber,
      createdBy: staff,
      createdAt: movement.createdAt.toISOString()
    }))
  }

  // --- Items -------------------------------------------------------------------------------

  create(auth: AuthContext, input: CreateInventoryItemData): InventoryItem {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      this.assertNameFree(tx, restaurantId, input.name)
      const row = tx
        .insert(inventoryItems)
        .values({
          restaurantId,
          name: input.name,
          unit: input.unit,
          category: input.category,
          reorderLevel: input.reorderLevel,
          unitCost: input.unitCost
        })
        .returning()
        .get()
      if (input.openingStock > 0) {
        this.post(tx, auth, row, 'OPENING', input.openingStock, { reason: 'Opening stock' })
      }
      this.record(tx, auth, 'inventory.item_created', row.id, {
        name: row.name,
        unit: row.unit,
        openingStock: input.openingStock
      })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateInventoryItemData): InventoryItem {
    this.db.transaction((tx) => {
      const current = this.requireItem(tx, input.id)
      if (input.name !== current.name) {
        this.assertNameFree(tx, current.restaurantId, input.name, current.id)
      }
      if (input.unit !== current.unit && this.hasMovements(tx, current.id)) {
        throw new AppError(
          'CONFLICT',
          'The unit cannot change once stock has been recorded. Add a new item instead.'
        )
      }
      const next = {
        name: input.name,
        unit: input.unit,
        category: input.category,
        reorderLevel: input.reorderLevel,
        unitCost: input.unitCost
      }
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
        (field) => next[field] !== current[field]
      )
      if (changed.length === 0) return
      tx.update(inventoryItems)
        .set({ ...next, ...markModified(inventoryItems) })
        .where(eq(inventoryItems.id, current.id))
        .run()
      this.record(tx, auth, 'inventory.item_updated', current.id, { changedFields: changed })
    })
    return this.get(input.id)
  }

  /** An item that recipes still use cannot be retired: it would keep being deducted unseen. */
  setActive(auth: AuthContext, input: SetInventoryItemActiveData): InventoryItem {
    this.db.transaction((tx) => {
      const current = this.requireItem(tx, input.id)
      if (current.isActive === input.isActive) return
      if (!input.isActive && this.recipeCount(tx, current.id) > 0) {
        throw new AppError(
          'CONFLICT',
          'This item is used in recipes. Take it out of those recipes before deactivating it.'
        )
      }
      tx.update(inventoryItems)
        .set({ isActive: input.isActive, ...markModified(inventoryItems) })
        .where(eq(inventoryItems.id, current.id))
        .run()
      this.record(
        tx,
        auth,
        input.isActive ? 'inventory.item_activated' : 'inventory.item_deactivated',
        current.id,
        { name: current.name }
      )
    })
    return this.get(input.id)
  }

  /** Only an item with no history can be deleted; the ledger keeps everything else. */
  delete(auth: AuthContext, id: string): null {
    this.db.transaction((tx) => {
      const current = this.requireItem(tx, id)
      if (this.hasMovements(tx, id)) {
        throw new AppError(
          'CONFLICT',
          'Stock has been recorded for this item, so it cannot be deleted. Deactivate it instead.'
        )
      }
      if (this.recipeCount(tx, id) > 0) {
        throw new AppError(
          'CONFLICT',
          'This item is used in recipes. Take it out of those recipes first.'
        )
      }
      tx.update(inventoryItems)
        .set({ deletedAt: new Date(this.clock()), ...markModified(inventoryItems) })
        .where(eq(inventoryItems.id, id))
        .run()
      this.record(tx, auth, 'inventory.item_deleted', id, { name: current.name })
    })
    return null
  }

  // --- Stock changes -----------------------------------------------------------------------

  stockIn(auth: AuthContext, input: StockInData): InventoryItem {
    this.db.transaction((tx) => {
      const current = this.requireItem(tx, input.itemId)
      const unitCost = input.unitCost ?? current.unitCost
      if (input.unitCost !== null && input.unitCost !== undefined) {
        tx.update(inventoryItems)
          .set({ unitCost: input.unitCost, ...markModified(inventoryItems) })
          .where(eq(inventoryItems.id, current.id))
          .run()
      }
      this.post(tx, auth, current, 'STOCK_IN', input.quantity, {
        unitCost,
        reason: input.reason
      })
      this.record(tx, auth, 'inventory.stock_in', current.id, {
        name: current.name,
        quantity: input.quantity,
        unitCost
      })
    })
    return this.get(input.itemId)
  }

  /**
   * Puts bought stock in as part of a larger transaction (a received purchase): sets the item's
   * latest price and writes the `STOCK_IN` ledger row. The caller audits the whole purchase.
   */
  receiveStock(
    tx: DbExecutor,
    auth: AuthContext,
    itemId: string,
    quantity: number,
    unitCost: number,
    reason: string
  ): void {
    const current = this.requireItem(tx, itemId)
    tx.update(inventoryItems)
      .set({ unitCost, ...markModified(inventoryItems) })
      .where(eq(inventoryItems.id, current.id))
      .run()
    this.post(tx, auth, current, 'STOCK_IN', quantity, { unitCost, reason })
  }

  wastage(auth: AuthContext, input: WastageData): InventoryItem {
    this.db.transaction((tx) => {
      const current = this.requireItem(tx, input.itemId)
      if (input.quantity > current.onHand) {
        throw new AppError(
          'CONFLICT',
          `Only ${formatQuantity(Math.max(current.onHand, 0))} ${UNIT_LABELS[current.unit]} of ${current.name} is in stock. Do a stock count first if the shelf holds more.`
        )
      }
      this.post(tx, auth, current, 'WASTAGE', -input.quantity, { reason: input.reason })
      this.record(tx, auth, 'inventory.wastage', current.id, {
        name: current.name,
        quantity: input.quantity,
        reason: input.reason
      })
    })
    return this.get(input.itemId)
  }

  /** Brings the recorded stock in line with what was counted; the difference is the adjustment. */
  count(auth: AuthContext, input: StockCountData): InventoryItem {
    this.db.transaction((tx) => {
      const current = this.requireItem(tx, input.itemId)
      const difference = input.counted - current.onHand
      if (difference === 0) return
      this.post(tx, auth, current, 'ADJUSTMENT', difference, {
        reason: input.reason ?? 'Stock count'
      })
      this.record(tx, auth, 'inventory.stock_counted', current.id, {
        name: current.name,
        recorded: current.onHand,
        counted: input.counted,
        difference
      })
    })
    return this.get(input.itemId)
  }

  // --- Hooks for the order flow (inside its transaction) -----------------------------------

  /**
   * Takes the ingredients of the sent lines out of stock, one ledger row per line and ingredient
   * so a cancelled line can be put back exactly. A size without its own recipe uses the item's
   * shared one; an item with no recipe uses no stock. Stock may go below zero: the kitchen is
   * never stopped from selling, the shortfall shows on the stock screen.
   */
  consume(tx: DbExecutor, auth: AuthContext, orderId: string, lines: readonly LineRow[]): void {
    if (lines.length === 0) return
    const menuItemIds = [...new Set(lines.map((line) => line.menuItemId))]
    const recipe = tx
      .select()
      .from(recipeLines)
      .where(and(inArray(recipeLines.menuItemId, menuItemIds), isNull(recipeLines.deletedAt)))
      .all()
    if (recipe.length === 0) return
    const items = new Map(
      tx
        .select()
        .from(inventoryItems)
        .where(inArray(inventoryItems.id, [...new Set(recipe.map((row) => row.inventoryItemId))]))
        .all()
        .map((item) => [item.id, item])
    )

    for (const line of lines) {
      const own = recipe.filter(
        (row) => row.menuItemId === line.menuItemId && row.variantId === line.variantId
      )
      const used =
        own.length > 0 || line.variantId === null
          ? own
          : recipe.filter((row) => row.menuItemId === line.menuItemId && row.variantId === null)
      for (const row of used) {
        const item = items.get(row.inventoryItemId)
        if (!item) continue
        this.post(tx, auth, item, 'CONSUMPTION', -(row.quantity * line.quantity), {
          unitCost: item.unitCost,
          reason: `${line.itemName} × ${String(line.quantity)}`,
          orderId,
          orderItemId: line.id
        })
      }
    }
  }

  /** Puts back what `consume` took for these order lines; a line is never put back twice. */
  restore(
    tx: DbExecutor,
    auth: AuthContext,
    orderItemIds: readonly string[],
    reason: string
  ): void {
    if (orderItemIds.length === 0) return
    const rows = tx
      .select()
      .from(stockMovements)
      .where(
        and(
          inArray(stockMovements.orderItemId, [...orderItemIds]),
          inArray(stockMovements.type, ['CONSUMPTION', 'CONSUMPTION_REVERSAL'])
        )
      )
      .orderBy(asc(stockMovements.createdAt), sql`stock_movements.rowid asc`)
      .all()
    const reversed = new Set(
      rows.flatMap((row) => (row.reversesMovementId ? [row.reversesMovementId] : []))
    )
    for (const original of rows) {
      if (original.type !== 'CONSUMPTION' || reversed.has(original.id)) continue
      const item = tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, original.inventoryItemId))
        .get()
      if (!item) continue
      this.post(tx, auth, item, 'CONSUMPTION_REVERSAL', -original.quantity, {
        unitCost: original.unitCost,
        reason,
        orderId: original.orderId,
        orderItemId: original.orderItemId,
        reversesMovementId: original.id
      })
    }
  }

  // --- Internals ---------------------------------------------------------------------------

  /** Moves the item's running total and writes the ledger row for it. */
  private post(
    tx: DbExecutor,
    auth: AuthContext,
    item: ItemRow,
    type: MovementType,
    delta: number,
    extras: MovementExtras = {}
  ): void {
    const [updated] = tx
      .update(inventoryItems)
      .set({ onHand: sql`${inventoryItems.onHand} + ${delta}`, ...markModified(inventoryItems) })
      .where(eq(inventoryItems.id, item.id))
      .returning({ onHand: inventoryItems.onHand })
      .all()
    if (!updated) throw new AppError('NOT_FOUND', 'That stock item no longer exists.')
    tx.insert(stockMovements)
      .values({
        restaurantId: item.restaurantId,
        inventoryItemId: item.id,
        type,
        quantity: delta,
        balanceAfter: updated.onHand,
        unitCost: extras.unitCost ?? null,
        reason: extras.reason ?? null,
        orderId: extras.orderId ?? null,
        orderItemId: extras.orderItemId ?? null,
        reversesMovementId: extras.reversesMovementId ?? null,
        createdBy: auth.userId,
        createdAt: new Date(this.clock())
      })
      .run()
  }

  private load(db: DbExecutor, conditions: SQL[]): InventoryItem[] {
    const rows = db
      .select()
      .from(inventoryItems)
      .where(and(isNull(inventoryItems.deletedAt), ...conditions))
      .orderBy(asc(inventoryItems.name))
      .all()
    if (rows.length === 0) return []

    const ids = rows.map((row) => row.id)
    const recipeCounts = new Map(
      db
        .select({
          id: recipeLines.inventoryItemId,
          total: sql<number>`count(distinct ${recipeLines.menuItemId})`
        })
        .from(recipeLines)
        .where(and(inArray(recipeLines.inventoryItemId, ids), isNull(recipeLines.deletedAt)))
        .groupBy(recipeLines.inventoryItemId)
        .all()
        .map((row) => [row.id, row.total])
    )
    const lastMoves = new Map(
      db
        .select({
          id: stockMovements.inventoryItemId,
          at: sql<number>`max(${stockMovements.createdAt})`
        })
        .from(stockMovements)
        .where(inArray(stockMovements.inventoryItemId, ids))
        .groupBy(stockMovements.inventoryItemId)
        .all()
        .map((row) => [row.id, row.at])
    )

    return rows.map((row) => {
      const lastAt = lastMoves.get(row.id)
      return {
        id: row.id,
        name: row.name,
        unit: row.unit,
        category: row.category,
        onHand: row.onHand,
        reorderLevel: row.reorderLevel,
        unitCost: row.unitCost,
        stockValue: costOfQuantity(Math.max(row.onHand, 0), row.unitCost),
        isActive: row.isActive,
        isLow: row.reorderLevel > 0 && row.onHand <= row.reorderLevel,
        usedInRecipes: recipeCounts.get(row.id) ?? 0,
        lastMovementAt: lastAt === undefined ? null : new Date(lastAt).toISOString(),
        createdAt: row.createdAt.toISOString()
      }
    })
  }

  private requireItem(db: DbExecutor, id: string): ItemRow {
    const row = db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, id), isNull(inventoryItems.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That stock item no longer exists.')
    return row
  }

  private assertNameFree(
    db: DbExecutor,
    restaurantId: string,
    name: string,
    exceptId?: string
  ): void {
    const clash = db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.restaurantId, restaurantId),
          isNull(inventoryItems.deletedAt),
          sql`lower(${inventoryItems.name}) = lower(${name})`
        )
      )
      .all()
      .find((row) => row.id !== exceptId)
    if (clash) throw new AppError('CONFLICT', 'There is already a stock item with that name.')
  }

  private hasMovements(db: DbExecutor, itemId: string): boolean {
    return (
      db
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(eq(stockMovements.inventoryItemId, itemId))
        .limit(1)
        .get() !== undefined
    )
  }

  private recipeCount(db: DbExecutor, itemId: string): number {
    return (
      db
        .select({ total: sql<number>`count(*)` })
        .from(recipeLines)
        .where(and(eq(recipeLines.inventoryItemId, itemId), isNull(recipeLines.deletedAt)))
        .get()?.total ?? 0
    )
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: AuditAction,
    itemId: string,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'inventory_item',
        entityId: itemId,
        details
      },
      tx
    )
  }
}
