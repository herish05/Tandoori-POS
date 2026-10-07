import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { randomUUID } from 'node:crypto'
import {
  BILL_STATUSES,
  DISCOUNT_SCOPES,
  DISCOUNT_TYPES,
  PAYMENT_METHODS,
  TAX_COMPONENTS,
  TAX_MODES
} from '../../../shared/billing'
import { FOOD_TYPES } from '../../../shared/menu'
import { baseColumns } from './common'
import { restaurants, users } from './auth'
import { orderItems, orders } from './orders'

/*
 * Billing tables. Every amount is whole paise; every percentage is basis points. A bill keeps a
 * snapshot of the order lines, the tax rates and the settings it was worked out with, so later
 * menu or settings changes never alter a bill that already exists.
 */

/** How this restaurant bills: GST split, service charge and round off. One row per restaurant. */
export const billingSettings = sqliteTable(
  'billing_settings',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    taxMode: text('tax_mode', { enum: TAX_MODES }).notNull(),
    serviceChargeBps: integer('service_charge_bps').notNull().default(0),
    serviceChargeDineInOnly: integer('service_charge_dine_in_only', { mode: 'boolean' })
      .notNull()
      .default(true),
    serviceChargeTaxable: integer('service_charge_taxable', { mode: 'boolean' })
      .notNull()
      .default(true),
    roundOffUnit: integer('round_off_unit').notNull().default(100),
    autoPrintReceipt: integer('auto_print_receipt', { mode: 'boolean' }).notNull().default(false),
    /** Flat charges for takeaway and delivery, in paise; their GST in basis points. */
    deliveryCharge: integer('delivery_charge').notNull().default(0),
    deliveryFreeAbove: integer('delivery_free_above').notNull().default(0),
    deliveryChargeTaxBps: integer('delivery_charge_tax_bps').notNull().default(0),
    packagingCharge: integer('packaging_charge').notNull().default(0),
    packagingChargeTaxBps: integer('packaging_charge_tax_bps').notNull().default(0),
    updatedBy: text('updated_by').references(() => users.id)
  },
  (table) => [
    uniqueIndex('billing_settings_restaurant_unique').on(table.restaurantId),
    check(
      'billing_settings_service_charge_check',
      sql`${table.serviceChargeBps} between 0 and 3000`
    ),
    check('billing_settings_round_off_check', sql`${table.roundOffUnit} in (1, 10, 50, 100)`)
  ]
)

/** A bill for one order, e.g. TB-BILL-000001. */
export const bills = sqliteTable(
  'bills',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    billNumber: text('bill_number').notNull(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    status: text('status', { enum: BILL_STATUSES }).notNull().default('PENDING'),
    // The settings in force when the bill was made.
    taxMode: text('tax_mode', { enum: TAX_MODES }).notNull(),
    /** 0 when the service charge does not apply to this bill. */
    serviceChargeBps: integer('service_charge_bps').notNull().default(0),
    serviceChargeTaxable: integer('service_charge_taxable', { mode: 'boolean' })
      .notNull()
      .default(true),
    roundOffUnit: integer('round_off_unit').notNull().default(100),
    /** Flat delivery and packaging charges fixed when the bill was made (0 = none), and their GST. */
    deliveryCharge: integer('delivery_charge').notNull().default(0),
    deliveryChargeTaxBps: integer('delivery_charge_tax_bps').notNull().default(0),
    packagingCharge: integer('packaging_charge').notNull().default(0),
    packagingChargeTaxBps: integer('packaging_charge_tax_bps').notNull().default(0),
    // The worked-out figures, recalculated by the server whenever a discount changes.
    subtotal: integer('subtotal').notNull(),
    itemDiscountTotal: integer('item_discount_total').notNull().default(0),
    billDiscountTotal: integer('bill_discount_total').notNull().default(0),
    serviceCharge: integer('service_charge').notNull().default(0),
    taxTotal: integer('tax_total').notNull().default(0),
    /** Signed: negative when the total was rounded down. */
    roundOff: integer('round_off').notNull().default(0),
    grandTotal: integer('grand_total').notNull(),
    paidTotal: integer('paid_total').notNull().default(0),
    /** Paise given back so far (0 to paid_total; a trigger keeps it in range). */
    refundedTotal: integer('refunded_total').notNull().default(0),
    paidAt: integer('paid_at', { mode: 'timestamp_ms' }),
    cancelReason: text('cancel_reason'),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    cancelledBy: text('cancelled_by').references(() => users.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id)
  },
  (table) => [
    uniqueIndex('bills_restaurant_number_unique').on(table.restaurantId, table.billNumber),
    // One live bill per order; a cancelled bill makes room for a new one.
    uniqueIndex('bills_live_order_unique')
      .on(table.orderId)
      .where(sql`${table.status} <> 'CANCELLED' and ${table.deletedAt} is null`),
    index('bills_order_idx').on(table.orderId),
    index('bills_status_idx').on(table.status),
    index('bills_created_idx').on(table.createdAt),
    check(
      'bills_amounts_check',
      sql`${table.subtotal} >= 0 and ${table.grandTotal} >= 0 and ${table.paidTotal} >= 0 and ${table.paidTotal} <= ${table.grandTotal}`
    )
  ]
)

/** One line of a bill: a snapshot of an order line and how each figure on it was worked out. */
export const billItems = sqliteTable(
  'bill_items',
  {
    ...baseColumns(),
    billId: text('bill_id')
      .notNull()
      .references(() => bills.id),
    orderItemId: text('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    itemName: text('item_name').notNull(),
    variantName: text('variant_name'),
    foodType: text('food_type', { enum: FOOD_TYPES }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
    gross: integer('gross').notNull(),
    itemDiscount: integer('item_discount').notNull().default(0),
    billDiscountShare: integer('bill_discount_share').notNull().default(0),
    serviceChargeShare: integer('service_charge_share').notNull().default(0),
    taxableValue: integer('taxable_value').notNull(),
    taxName: text('tax_name'),
    taxRateBps: integer('tax_rate_bps').notNull().default(0)
  },
  (table) => [
    index('bill_items_bill_idx').on(table.billId),
    check('bill_items_amounts_check', sql`${table.gross} >= 0 and ${table.taxableValue} >= 0`)
  ]
)

/** The GST on a bill, one row per rate and component (CGST and SGST, or IGST). */
export const billTaxes = sqliteTable(
  'bill_taxes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    billId: text('bill_id')
      .notNull()
      .references(() => bills.id),
    component: text('component', { enum: TAX_COMPONENTS }).notNull(),
    /** The tax category's whole rate; CGST and SGST each charge half of it. */
    rateBps: integer('rate_bps').notNull(),
    taxableAmount: integer('taxable_amount').notNull(),
    taxAmount: integer('tax_amount').notNull()
  },
  (table) => [
    index('bill_taxes_bill_idx').on(table.billId),
    check('bill_taxes_amounts_check', sql`${table.taxableAmount} >= 0 and ${table.taxAmount} >= 0`)
  ]
)

/** A discount applied to a bill or to one of its items. Removed ones keep `deletedAt`. */
export const billDiscounts = sqliteTable(
  'bill_discounts',
  {
    ...baseColumns(),
    billId: text('bill_id')
      .notNull()
      .references(() => bills.id),
    scope: text('scope', { enum: DISCOUNT_SCOPES }).notNull(),
    billItemId: text('bill_item_id').references(() => billItems.id),
    type: text('type', { enum: DISCOUNT_TYPES }).notNull(),
    /** Basis points for a percentage, paise for a fixed amount. */
    value: integer('value').notNull(),
    /** Paise this discount took off when last calculated. */
    amount: integer('amount').notNull().default(0),
    reason: text('reason').notNull(),
    appliedBy: text('applied_by')
      .notNull()
      .references(() => users.id)
  },
  (table) => [
    index('bill_discounts_bill_idx').on(table.billId),
    check('bill_discounts_value_check', sql`${table.value} >= 1 and ${table.amount} >= 0`),
    check(
      'bill_discounts_scope_check',
      sql`(${table.scope} = 'ITEM') = (${table.billItemId} is not null)`
    )
  ]
)

/** Money received against a bill. A bill can be paid with several of these (split payment). */
export const payments = sqliteTable(
  'payments',
  {
    ...baseColumns(),
    billId: text('bill_id')
      .notNull()
      .references(() => bills.id),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    /** Paise that went against the bill. */
    amount: integer('amount').notNull(),
    /** Paise handed over; more than `amount` only for cash. */
    tendered: integer('tendered').notNull(),
    reference: text('reference'),
    receivedBy: text('received_by')
      .notNull()
      .references(() => users.id),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    index('payments_bill_idx').on(table.billId),
    check(
      'payments_amount_check',
      sql`${table.amount} >= 1 and ${table.tendered} >= ${table.amount}`
    )
  ]
)

/**
 * Money given back to the guest. Rows are never changed or deleted (database triggers see to
 * that); several can follow one bill until everything paid has been returned.
 */
export const refunds = sqliteTable(
  'refunds',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    refundNumber: text('refund_number').notNull(),
    billId: text('bill_id')
      .notNull()
      .references(() => bills.id),
    /** Paise given back in all. */
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    refundedBy: text('refunded_by')
      .notNull()
      .references(() => users.id),
    refundedAt: integer('refunded_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    uniqueIndex('refunds_restaurant_number_unique').on(table.restaurantId, table.refundNumber),
    index('refunds_bill_idx').on(table.billId),
    index('refunds_refunded_at_idx').on(table.refundedAt),
    check('refunds_amount_check', sql`${table.amount} >= 1`)
  ]
)

/** The part of a refund that went back through one payment method. */
export const refundLines = sqliteTable(
  'refund_lines',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    refundId: text('refund_id')
      .notNull()
      .references(() => refunds.id),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    amount: integer('amount').notNull(),
    reference: text('reference')
  },
  (table) => [
    index('refund_lines_refund_idx').on(table.refundId),
    check('refund_lines_amount_check', sql`${table.amount} >= 1`)
  ]
)
