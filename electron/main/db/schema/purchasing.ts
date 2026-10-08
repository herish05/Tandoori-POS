import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { PURCHASE_STATUSES, SUPPLIER_PAYMENT_METHODS } from '../../../shared/purchasing'
import { INVENTORY_UNITS } from '../../../shared/inventory'
import { baseColumns } from './common'
import { restaurants, users } from './auth'
import { inventoryItems } from './inventory'

/*
 * Suppliers and purchases. Money is whole paise; quantities are whole thousandths of the stock
 * item's unit. A purchase is a draft until it is received, which puts its lines into stock; after
 * that its lines and totals never change (database triggers). Payments are never edited either:
 * a wrong one is voided.
 */

/** Someone the restaurant buys from. */
export const suppliers = sqliteTable(
  'suppliers',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    contactPerson: text('contact_person'),
    /** Normalised digits. */
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    gstin: text('gstin'),
    notes: text('notes'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true)
  },
  (table) => [
    uniqueIndex('suppliers_restaurant_name_unique')
      .on(table.restaurantId, table.name)
      .where(sql`${table.deletedAt} is null`)
  ]
)

/** One supplier invoice: a draft until received into stock. */
export const purchases = sqliteTable(
  'purchases',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    purchaseNumber: text('purchase_number').notNull(),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    /** The supplier's own bill number. */
    invoiceNumber: text('invoice_number'),
    /** `YYYY-MM-DD`. */
    purchaseDate: text('purchase_date').notNull(),
    status: text('status', { enum: PURCHASE_STATUSES }).notNull().default('DRAFT'),
    notes: text('notes'),
    subtotal: integer('subtotal').notNull().default(0),
    discount: integer('discount').notNull().default(0),
    tax: integer('tax').notNull().default(0),
    total: integer('total').notNull().default(0),
    /** Kept in step with the payments that are not voided, in the same transaction. */
    amountPaid: integer('amount_paid').notNull().default(0),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }),
    receivedBy: text('received_by').references(() => users.id),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    cancelledBy: text('cancelled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id)
  },
  (table) => [
    uniqueIndex('purchases_number_unique').on(table.restaurantId, table.purchaseNumber),
    index('purchases_supplier_idx').on(table.supplierId, table.purchaseDate),
    index('purchases_status_idx').on(table.status),
    check(
      'purchases_amounts_check',
      sql`${table.subtotal} >= 0 and ${table.discount} >= 0 and ${table.discount} <= ${table.subtotal} and ${table.tax} >= 0 and ${table.total} = ${table.subtotal} - ${table.discount} + ${table.tax} and ${table.amountPaid} >= 0 and ${table.amountPaid} <= ${table.total}`
    )
  ]
)

/** What was bought on a purchase. The name and unit are copied so the invoice stays readable. */
export const purchaseLines = sqliteTable(
  'purchase_lines',
  {
    ...baseColumns(),
    purchaseId: text('purchase_id')
      .notNull()
      .references(() => purchases.id),
    inventoryItemId: text('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id),
    itemName: text('item_name').notNull(),
    unit: text('unit', { enum: INVENTORY_UNITS }).notNull(),
    quantity: integer('quantity').notNull(),
    /** Paise per whole unit. */
    unitCost: integer('unit_cost').notNull(),
    lineTotal: integer('line_total').notNull(),
    sortOrder: integer('sort_order').notNull().default(0)
  },
  (table) => [
    index('purchase_lines_purchase_idx').on(table.purchaseId),
    index('purchase_lines_item_idx').on(table.inventoryItemId),
    check(
      'purchase_lines_amounts_check',
      sql`${table.quantity} > 0 and ${table.unitCost} >= 0 and ${table.lineTotal} >= 0`
    )
  ]
)

/** Money paid to a supplier against a purchase. */
export const supplierPayments = sqliteTable(
  'supplier_payments',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    purchaseId: text('purchase_id')
      .notNull()
      .references(() => purchases.id),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    amount: integer('amount').notNull(),
    method: text('method', { enum: SUPPLIER_PAYMENT_METHODS }).notNull(),
    reference: text('reference'),
    notes: text('notes'),
    paidAt: integer('paid_at', { mode: 'timestamp_ms' }).notNull(),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => users.id),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    voidedBy: text('voided_by').references(() => users.id),
    voidReason: text('void_reason')
  },
  (table) => [
    index('supplier_payments_purchase_idx').on(table.purchaseId),
    index('supplier_payments_supplier_idx').on(table.supplierId, table.paidAt),
    check('supplier_payments_amount_check', sql`${table.amount} > 0`)
  ]
)
