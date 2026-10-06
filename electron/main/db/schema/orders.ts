import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import { randomUUID } from 'node:crypto'
import { ADDON_KINDS, FOOD_TYPES } from '../../../shared/menu'
import { ORDER_LINE_STATUSES, ORDER_STATUSES, ORDER_TYPES } from '../../../shared/orders'
import { baseColumns } from './common'
import { restaurants, users } from './auth'
import { kitchenStations, menuAddons, menuItems, menuVariants } from './menu'
import { diningTables } from './tables'

/*
 * Order tables. Every price column holds whole paise (1 rupee = 100 paise). Order lines keep a
 * snapshot of the item name, prices, station and tax at the time of ordering, so editing the
 * menu later never changes an order that already exists.
 */

/** An order: one dine-in table's meal, or a take-away, pickup or delivery request. */
export const orders = sqliteTable(
  'orders',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    /** Human-readable and unique per restaurant, e.g. TB-ORD-000001. */
    orderNumber: text('order_number').notNull(),
    type: text('type', { enum: ORDER_TYPES }).notNull(),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('DRAFT'),
    /** Set for dine-in orders only. */
    tableId: text('table_id').references(() => diningTables.id),
    guestCount: integer('guest_count'),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    deliveryAddress: text('delivery_address'),
    notes: text('notes'),
    /** The live (not cancelled) lines added up; kept in step by every change to the lines. */
    subtotal: integer('subtotal').notNull().default(0),
    confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
    cancelReason: text('cancel_reason'),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    cancelledBy: text('cancelled_by').references(() => users.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id)
  },
  (table) => [
    uniqueIndex('orders_restaurant_number_unique').on(table.restaurantId, table.orderNumber),
    // One open order per table at any time.
    uniqueIndex('orders_open_table_unique')
      .on(table.tableId)
      .where(
        sql`${table.tableId} is not null and ${table.deletedAt} is null and ${table.status} not in ('COMPLETED', 'CANCELLED')`
      ),
    index('orders_status_idx').on(table.status),
    index('orders_table_idx').on(table.tableId),
    index('orders_created_idx').on(table.createdAt),
    check('orders_table_check', sql`(${table.type} = 'DINE_IN') = (${table.tableId} is not null)`),
    check('orders_subtotal_check', sql`${table.subtotal} >= 0`)
  ]
)

/** One line of an order: an item (and variant) with a quantity, add-ons and instructions. */
export const orderItems = sqliteTable(
  'order_items',
  {
    ...baseColumns(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    menuItemId: text('menu_item_id')
      .notNull()
      .references(() => menuItems.id),
    variantId: text('variant_id').references(() => menuVariants.id),
    itemName: text('item_name').notNull(),
    variantName: text('variant_name'),
    foodType: text('food_type', { enum: FOOD_TYPES }).notNull(),
    unitPrice: integer('unit_price').notNull(),
    /** The priced add-ons added up, per unit. */
    addonTotal: integer('addon_total').notNull().default(0),
    quantity: integer('quantity').notNull(),
    lineTotal: integer('line_total').notNull(),
    notes: text('notes'),
    status: text('status', { enum: ORDER_LINE_STATUSES }).notNull().default('NEW'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    cancelReason: text('cancel_reason'),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    cancelledBy: text('cancelled_by').references(() => users.id),
    /** The kitchen station this item goes to (the item's own, else its category's) when ordered. */
    stationId: text('station_id').references(() => kitchenStations.id),
    taxName: text('tax_name'),
    taxRateBps: integer('tax_rate_bps')
  },
  (table) => [
    index('order_items_order_idx').on(table.orderId),
    check('order_items_quantity_check', sql`${table.quantity} between 1 and 99`),
    check(
      'order_items_price_check',
      sql`${table.unitPrice} >= 0 and ${table.addonTotal} >= 0 and ${table.lineTotal} >= 0`
    )
  ]
)

/** An add-on or modifier chosen for a line, with the price it had at the time. */
export const orderItemAddons = sqliteTable(
  'order_item_addons',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    orderItemId: text('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    addonId: text('addon_id').references(() => menuAddons.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: ADDON_KINDS }).notNull(),
    price: integer('price').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0)
  },
  (table) => [
    index('order_item_addons_item_idx').on(table.orderItemId),
    check('order_item_addons_price_check', sql`${table.price} >= 0`)
  ]
)

/**
 * Numbering for documents (orders now, kitchen tickets and bills later): one counter per
 * restaurant and kind. The prefix is fixed when the counter is created so renaming the
 * restaurant never changes the numbers already printed.
 */
export const documentSequences = sqliteTable(
  'document_sequences',
  {
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    /** Short code of the document: ORD, KOT, BILL... */
    kind: text('kind').notNull(),
    prefix: text('prefix').notNull(),
    lastNumber: integer('last_number').notNull().default(0)
  },
  (table) => [
    primaryKey({ columns: [table.restaurantId, table.kind] }),
    check('document_sequences_number_check', sql`${table.lastNumber} >= 0`)
  ]
)
