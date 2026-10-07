import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { INVENTORY_UNITS, MOVEMENT_TYPES } from '../../../shared/inventory'
import { baseColumns } from './common'
import { restaurants, users } from './auth'
import { menuItems, menuVariants } from './menu'
import { orderItems, orders } from './orders'

/*
 * Inventory tables. Quantities are whole thousandths of the item's unit, costs are whole paise
 * per unit. `inventory_items.on_hand` is a running total kept in step with the ledger inside
 * the same transaction; the ledger (`stock_movements`) is the record and is never rewritten.
 */

/** A raw material the kitchen buys and cooks with. */
export const inventoryItems = sqliteTable(
  'inventory_items',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    unit: text('unit', { enum: INVENTORY_UNITS }).notNull(),
    category: text('category'),
    onHand: integer('on_hand').notNull().default(0),
    reorderLevel: integer('reorder_level').notNull().default(0),
    unitCost: integer('unit_cost').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true)
  },
  (table) => [
    uniqueIndex('inventory_items_restaurant_name_unique')
      .on(table.restaurantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    check(
      'inventory_items_amounts_check',
      sql`${table.reorderLevel} >= 0 and ${table.unitCost} >= 0`
    )
  ]
)

/**
 * The stock ledger: one row for every change to an item's stock. `quantity` is signed (negative
 * when stock went out) and `balance_after` is the item's stock right after the change.
 */
export const stockMovements = sqliteTable(
  'stock_movements',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    inventoryItemId: text('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id),
    type: text('type', { enum: MOVEMENT_TYPES }).notNull(),
    quantity: integer('quantity').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    /** The item's cost per unit when the movement happened. */
    unitCost: integer('unit_cost'),
    reason: text('reason'),
    orderId: text('order_id').references(() => orders.id),
    orderItemId: text('order_item_id').references(() => orderItems.id),
    /** For a reversal: the consumption it takes back. A consumption is reversed at most once. */
    reversesMovementId: text('reverses_movement_id').references(
      (): AnySQLiteColumn => stockMovements.id
    ),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id)
  },
  (table) => [
    index('stock_movements_item_idx').on(table.inventoryItemId, table.createdAt),
    index('stock_movements_order_item_idx').on(table.orderItemId),
    uniqueIndex('stock_movements_reverses_unique')
      .on(table.reversesMovementId)
      .where(sql`${table.reversesMovementId} is not null`),
    check('stock_movements_quantity_check', sql`${table.quantity} <> 0`)
  ]
)

/**
 * What one portion of a menu item uses. `variant_id` null is the recipe for the item as a whole
 * (used by every size that has no recipe of its own).
 */
export const recipeLines = sqliteTable(
  'recipe_lines',
  {
    ...baseColumns(),
    menuItemId: text('menu_item_id')
      .notNull()
      .references(() => menuItems.id),
    variantId: text('variant_id').references(() => menuVariants.id),
    inventoryItemId: text('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id),
    quantity: integer('quantity').notNull()
  },
  (table) => [
    uniqueIndex('recipe_lines_item_unique')
      .on(table.menuItemId, table.inventoryItemId)
      .where(sql`${table.deletedAt} is null and ${table.variantId} is null`),
    uniqueIndex('recipe_lines_variant_unique')
      .on(table.variantId, table.inventoryItemId)
      .where(sql`${table.deletedAt} is null and ${table.variantId} is not null`),
    index('recipe_lines_ingredient_idx').on(table.inventoryItemId),
    check('recipe_lines_quantity_check', sql`${table.quantity} > 0`)
  ]
)
