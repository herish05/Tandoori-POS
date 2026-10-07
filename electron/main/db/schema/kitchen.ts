import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { randomUUID } from 'node:crypto'
import {
  KOT_ITEM_STATUSES,
  KOT_STATUSES,
  PRINT_STATUSES,
  PRINTER_KINDS,
  type KotItemAddon,
  type PaperWidth
} from '../../../shared/kitchen'
import { FOOD_TYPES } from '../../../shared/menu'
import { baseColumns } from './common'
import { restaurants, users } from './auth'
import { kitchenStations, menuItems } from './menu'
import { orderItems, orders } from './orders'

/*
 * Kitchen tickets and printers. A KOT and its items are snapshots: database triggers (see
 * drizzle/0005) refuse to rewrite what was issued, so the only changes after the ticket exists
 * are its progress through the kitchen and a controlled cancellation, which raises `revision`.
 */

/** One kitchen order ticket: what one station has to cook for one "send" of an order. */
export const kots = sqliteTable(
  'kots',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    /** Human-readable and unique per restaurant, e.g. TB-KOT-000001. */
    kotNumber: text('kot_number').notNull(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    /** Null for items that have no station; they go to the general kitchen. */
    stationId: text('station_id').references(() => kitchenStations.id),
    /** The station's name when the ticket was issued. */
    stationName: text('station_name').notNull(),
    status: text('status', { enum: KOT_STATUSES }).notNull().default('NEW'),
    /** Sent after an earlier KOT of the same order. */
    isAdditional: integer('is_additional', { mode: 'boolean' }).notNull().default(false),
    /** Raised by each controlled change (an item cancelled) after the ticket was issued. */
    revision: integer('revision').notNull().default(0),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    preparingAt: integer('preparing_at', { mode: 'timestamp_ms' }),
    readyAt: integer('ready_at', { mode: 'timestamp_ms' }),
    servedAt: integer('served_at', { mode: 'timestamp_ms' }),
    cancelReason: text('cancel_reason'),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    cancelledBy: text('cancelled_by').references(() => users.id),
    printCount: integer('print_count').notNull().default(0),
    firstPrintedAt: integer('first_printed_at', { mode: 'timestamp_ms' }),
    lastPrintedAt: integer('last_printed_at', { mode: 'timestamp_ms' }),
    /** The revision on the last paper copy; behind `revision` means the ticket needs a reprint. */
    printedRevision: integer('printed_revision').notNull().default(0),
    lastPrintStatus: text('last_print_status', { enum: PRINT_STATUSES }),
    lastPrintError: text('last_print_error')
  },
  (table) => [
    uniqueIndex('kots_restaurant_number_unique').on(table.restaurantId, table.kotNumber),
    index('kots_order_idx').on(table.orderId),
    index('kots_status_idx').on(table.status),
    index('kots_station_idx').on(table.stationId),
    check('kots_revision_check', sql`${table.revision} >= 0 and ${table.printedRevision} >= 0`)
  ]
)

/** One line on a ticket: a copy of an order line as it was sent. */
export const kotItems = sqliteTable(
  'kot_items',
  {
    ...baseColumns(),
    kotId: text('kot_id')
      .notNull()
      .references(() => kots.id),
    orderItemId: text('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    menuItemId: text('menu_item_id')
      .notNull()
      .references(() => menuItems.id),
    itemName: text('item_name').notNull(),
    variantName: text('variant_name'),
    foodType: text('food_type', { enum: FOOD_TYPES }).notNull(),
    quantity: integer('quantity').notNull(),
    /** Add-ons and modifiers, as printed on the ticket. */
    addons: text('addons', { mode: 'json' }).$type<KotItemAddon[]>().notNull(),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status', { enum: KOT_ITEM_STATUSES }).notNull().default('ACTIVE'),
    cancelReason: text('cancel_reason'),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' })
  },
  (table) => [
    index('kot_items_kot_idx').on(table.kotId),
    index('kot_items_order_item_idx').on(table.orderItemId),
    check('kot_items_quantity_check', sql`${table.quantity} between 1 and 99`)
  ]
)

/** A printer kitchen tickets can be sent to. */
export const printers = sqliteTable(
  'printers',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: PRINTER_KINDS }).notNull(),
    /** NETWORK: host or host:port. SYSTEM: the operating system's printer name. */
    address: text('address').notNull(),
    paperWidth: integer('paper_width').$type<PaperWidth>().notNull().default(80),
    /** The station this printer serves; null for a printer that is not tied to one. */
    stationId: text('station_id').references(() => kitchenStations.id),
    /** Prints the tickets of every station that has no printer of its own. */
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true)
  },
  (table) => [
    uniqueIndex('printers_restaurant_name_unique')
      .on(table.restaurantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex('printers_station_unique')
      .on(table.stationId)
      .where(sql`${table.stationId} is not null and ${table.deletedAt} is null`),
    uniqueIndex('printers_default_unique')
      .on(table.restaurantId)
      .where(sql`${table.isDefault} = 1 and ${table.deletedAt} is null`),
    check('printers_paper_width_check', sql`${table.paperWidth} in (58, 80)`)
  ]
)

/** Every attempt to print a document, successful or not: the record of printer trouble. */
export const printJobs = sqliteTable(
  'print_jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    /** KOT now; bills and receipts later. */
    documentType: text('document_type').notNull(),
    documentId: text('document_id'),
    documentNumber: text('document_number'),
    printerId: text('printer_id').references(() => printers.id),
    printerName: text('printer_name'),
    status: text('status', { enum: PRINT_STATUSES }).notNull(),
    error: text('error'),
    isReprint: integer('is_reprint', { mode: 'boolean' }).notNull().default(false),
    revision: integer('revision').notNull().default(0),
    /** Receipts: the bill's state when printed (status, paid, refunded) so duplicates can be told. */
    snapshot: text('snapshot'),
    requestedBy: text('requested_by').references(() => users.id)
  },
  (table) => [
    index('print_jobs_document_idx').on(table.documentType, table.documentId),
    index('print_jobs_created_idx').on(table.createdAt)
  ]
)
