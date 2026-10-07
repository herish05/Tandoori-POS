import { z } from 'zod'
import type { BillStatus } from './billing'
import type { KotSummary } from './kitchen'
import type { AddonKind, FoodType } from './menu'
import type { TableStatus } from './tables'

/**
 * Orders: what guests asked for, from the first item until the bill is settled or the order is
 * cancelled. Shared by the renderer (labels, instant feedback) and the main process (the real checks).
 *
 * Money is always a whole number of paise. A line keeps a snapshot of the item name and prices at
 * the moment it was ordered, so later menu edits never rewrite an existing order.
 */

export const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY', 'PICKUP', 'DELIVERY'] as const
export type OrderType = (typeof ORDER_TYPES)[number]

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Take away',
  PICKUP: 'Pickup',
  DELIVERY: 'Delivery'
}

export const ORDER_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'KOT_PENDING',
  'PREPARING',
  'READY',
  'SERVED',
  'BILL_REQUESTED',
  'COMPLETED',
  'CANCELLED'
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  KOT_PENDING: 'KOT pending',
  PREPARING: 'Preparing',
  READY: 'Ready',
  SERVED: 'Served',
  BILL_REQUESTED: 'Bill requested',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
}

/**
 * What staff call a status for this kind of order. A takeaway or pickup is "handed over", a
 * delivery is "out for delivery" once a rider has taken it and "delivered" afterwards; dine-in
 * keeps the plain names.
 */
export function orderStatusLabelFor(order: {
  type: OrderType
  status: OrderStatus
  dispatchedAt: string | null
}): string {
  if (order.type === 'DINE_IN') return ORDER_STATUS_LABELS[order.status]
  if (order.type === 'DELIVERY') {
    if (order.status === 'READY')
      return order.dispatchedAt ? 'Out for delivery' : 'Ready to dispatch'
    if (order.status === 'SERVED') return 'Delivered'
    return ORDER_STATUS_LABELS[order.status]
  }
  if (order.status === 'READY') return 'Ready for pickup'
  if (order.status === 'SERVED') return 'Handed over'
  return ORDER_STATUS_LABELS[order.status]
}

/**
 * A line is NEW until it is sent to the kitchen, then SENT. A cancelled line stays on the order
 * (struck through) so the kitchen and the audit trail can still explain what happened.
 */
export const ORDER_LINE_STATUSES = ['NEW', 'SENT', 'CANCELLED'] as const
export type OrderLineStatus = (typeof ORDER_LINE_STATUSES)[number]

/** Orders in these states are finished and no longer occupy a table. */
export const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED']
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (status) => !CLOSED_ORDER_STATUSES.includes(status)
)

/** Items can be added to, changed in or removed from an order in these states. */
export const EDITABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  'DRAFT',
  'CONFIRMED',
  'KOT_PENDING',
  'PREPARING',
  'READY',
  'SERVED'
]

/** Once the food is served the order can no longer be cancelled as a whole; settle the bill instead. */
export const CANCELLABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  'DRAFT',
  'CONFIRMED',
  'KOT_PENDING',
  'PREPARING',
  'READY'
]

/**
 * Which status may follow which. CANCELLED is reached through the cancel action (it needs a
 * reason) and COMPLETED through billing. KOT_PENDING, PREPARING and READY follow the kitchen
 * tickets and are never set by hand; staff can mark an order served and ask for the bill.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['KOT_PENDING', 'SERVED', 'CANCELLED'],
  KOT_PENDING: ['PREPARING', 'SERVED', 'CANCELLED'],
  PREPARING: ['READY', 'SERVED', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: ['BILL_REQUESTED'],
  BILL_REQUESTED: ['SERVED', 'COMPLETED'],
  COMPLETED: [],
  CANCELLED: []
}

/** The status the order's table shows while the order is in each state. */
export const TABLE_STATUS_FOR_ORDER: Record<OrderStatus, TableStatus> = {
  DRAFT: 'OCCUPIED',
  CONFIRMED: 'OCCUPIED',
  KOT_PENDING: 'KOT_PENDING',
  PREPARING: 'PREPARING',
  READY: 'READY',
  SERVED: 'OCCUPIED',
  BILL_REQUESTED: 'BILL_REQUESTED',
  COMPLETED: 'PAID',
  CANCELLED: 'AVAILABLE'
}

/** Statuses staff can set directly with the "set status" call. */
export const SETTABLE_ORDER_STATUSES = [
  'SERVED',
  'BILL_REQUESTED'
] as const satisfies readonly OrderStatus[]

/** Statuses that mirror the kitchen tickets of the order. */
export const KITCHEN_ORDER_STATUSES: readonly OrderStatus[] = [
  'CONFIRMED',
  'KOT_PENDING',
  'PREPARING',
  'READY'
]

/** How far ahead a pickup or delivery can be promised. */
export const MAX_PROMISE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000
/** A promised time may be this far in the past when the order is created (clock drift, typing). */
export const PROMISE_PAST_GRACE_MS = 5 * 60 * 1000

export const MAX_LINE_QUANTITY = 99
export const MAX_LINE_ADDONS = 20
export const MAX_ORDER_LINES = 100
export const MAX_LINE_NOTES = 200

export function computeLineTotal(unitPrice: number, addonTotal: number, quantity: number): number {
  return (unitPrice + addonTotal) * quantity
}

// --- Response shapes -----------------------------------------------------------------------

export interface OrderLineAddon {
  id: string
  name: string
  kind: AddonKind
  /** Paise per unit of the line; 0 for a modifier. */
  price: number
}

export interface OrderLine {
  id: string
  menuItemId: string
  variantId: string | null
  name: string
  variantName: string | null
  foodType: FoodType
  /** Paise: the item (or chosen variant) price when ordered. */
  unitPrice: number
  /** Paise: the priced add-ons, per unit. */
  addonTotal: number
  quantity: number
  /** (unitPrice + addonTotal) x quantity. */
  lineTotal: number
  addons: OrderLineAddon[]
  /** Special instructions for the kitchen. */
  notes: string | null
  status: OrderLineStatus
  cancelReason: string | null
  stationId: string | null
  stationName: string | null
  taxName: string | null
  taxRateBps: number | null
  createdAt: string
}

export interface OrderSummary {
  id: string
  orderNumber: string
  type: OrderType
  status: OrderStatus
  tableId: string | null
  tableNumber: string | null
  tableName: string | null
  areaName: string | null
  guestCount: number | null
  /** The customer record this order was matched to by phone number. */
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  /** Takeaway, pickup and delivery: when the customer was promised the food (ISO time). */
  promisedAt: string | null
  /** Delivery: the rider who took the order out. */
  riderName: string | null
  riderPhone: string | null
  /** Delivery: when it went out with the rider. */
  dispatchedAt: string | null
  /** Takeaway, pickup and delivery: when the customer got the food. */
  handedOverAt: string | null
  /** Quantity of the lines that are not cancelled. */
  itemCount: number
  /** Paise: the live lines added up. Tax and discounts come with billing. */
  subtotal: number
  createdByName: string
  createdAt: string
  updatedAt: string
}

/** The live (not cancelled) bill of an order. */
export interface OrderBillRef {
  id: string
  billNumber: string
  status: BillStatus
  grandTotal: number
}

export interface OrderDetail extends OrderSummary {
  deliveryAddress: string | null
  notes: string | null
  cancelReason: string | null
  cancelledAt: string | null
  confirmedAt: string | null
  lines: OrderLine[]
  /** Some lines have not been sent to the kitchen yet. */
  hasUnsentLines: boolean
  /** The bill made for this order, if any. */
  bill: OrderBillRef | null
  /** The kitchen tickets issued for this order, oldest first. */
  kots: KotSummary[]
}

export interface PosVariant {
  id: string
  name: string
  price: number
  isDefault: boolean
  isAvailable: boolean
}

export interface PosAddon {
  id: string
  name: string
  kind: AddonKind
  price: number
}

/** A menu item as the ordering screen needs it (no cost price, no picture). */
export interface PosItem {
  id: string
  name: string
  description: string | null
  categoryId: string
  foodType: FoodType
  /** Paise; with variants it is the default variant's price. */
  price: number
  isAvailable: boolean
  isBestSeller: boolean
  variants: PosVariant[]
  addons: PosAddon[]
}

export interface PosCategory {
  id: string
  name: string
  itemCount: number
}

export interface PosCatalog {
  categories: PosCategory[]
  items: PosItem[]
}

// --- Validation ----------------------------------------------------------------------------

const idSchema = z.uuid()

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${String(max)} characters.`)
    .nullish()
    .transform((value) => (value === null || value === undefined || value === '' ? null : value))

const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{5,17}$/

const phoneField = z
  .string()
  .trim()
  .regex(PHONE_PATTERN, 'Enter a valid phone number.')
  .nullish()
  .or(z.literal(''))
  .transform((value) => (value === null || value === undefined || value === '' ? null : value))

const quantity = z
  .number('Enter a quantity.')
  .int('Quantity must be a whole number.')
  .min(1, 'Quantity must be at least 1.')
  .max(MAX_LINE_QUANTITY, `At most ${String(MAX_LINE_QUANTITY)} of an item per line.`)

const guestCount = z
  .number('Enter the number of guests.')
  .int('Guests must be a whole number.')
  .min(1, 'At least 1 guest is needed.')
  .max(50, 'At most 50 guests.')
  .nullish()
  .transform((value) => value ?? null)

export const orderLineInputSchema = z
  .object({
    menuItemId: idSchema,
    /** Required for an item that has variants; the default variant is used if left out. */
    variantId: idSchema.nullish().transform((value) => value ?? null),
    quantity,
    addonIds: z.array(idSchema).max(MAX_LINE_ADDONS).default([]),
    notes: optionalText('Instructions', MAX_LINE_NOTES)
  })
  .superRefine((value, ctx) => {
    if (new Set(value.addonIds).size !== value.addonIds.length) {
      ctx.addIssue({ code: 'custom', path: ['addonIds'], message: 'An add-on was chosen twice.' })
    }
  })

const promisedAtField = z
  .union([z.iso.datetime({ offset: true, message: 'Enter a valid time.' }), z.literal('')])
  .nullish()
  .transform((value) => (value === null || value === undefined || value === '' ? null : value))

const customerFields = {
  customerName: optionalText('Customer name', 80),
  customerPhone: phoneField,
  deliveryAddress: optionalText('Address', 300),
  notes: optionalText('Order notes', 300),
  /** Takeaway, pickup and delivery only; ignored for dine-in. */
  promisedAt: promisedAtField
}

interface TypeRules {
  type: OrderType
  tableId: string | null
  customerName: string | null
  customerPhone: string | null
  deliveryAddress: string | null
}

const checkTypeRules = (value: TypeRules, ctx: z.RefinementCtx) => {
  if (value.type === 'DINE_IN') {
    if (!value.tableId) {
      ctx.addIssue({ code: 'custom', path: ['tableId'], message: 'Choose a table.' })
    }
    return
  }
  if (value.tableId) {
    ctx.addIssue({
      code: 'custom',
      path: ['tableId'],
      message: 'Only a dine-in order belongs to a table.'
    })
  }
  if (value.type === 'DELIVERY') {
    if (!value.customerName) {
      ctx.addIssue({
        code: 'custom',
        path: ['customerName'],
        message: 'Enter the customer name for a delivery.'
      })
    }
    if (!value.customerPhone) {
      ctx.addIssue({
        code: 'custom',
        path: ['customerPhone'],
        message: 'Enter a phone number for a delivery.'
      })
    }
    if (!value.deliveryAddress) {
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryAddress'],
        message: 'Enter the delivery address.'
      })
    }
  }
}

export const createOrderInputSchema = z
  .object({
    type: z.enum(ORDER_TYPES),
    tableId: idSchema.nullish().transform((value) => value ?? null),
    guestCount,
    ...customerFields,
    lines: z
      .array(orderLineInputSchema)
      .min(1, 'Add at least one item.')
      .max(MAX_ORDER_LINES, `An order can have at most ${String(MAX_ORDER_LINES)} lines.`)
  })
  .superRefine(checkTypeRules)

/** Order type and table cannot change; everything else on the header can. */
export const updateOrderInputSchema = z.object({
  id: idSchema,
  guestCount,
  ...customerFields
})

export const addItemsInputSchema = z.object({
  orderId: idSchema,
  lines: z
    .array(orderLineInputSchema)
    .min(1, 'Add at least one item.')
    .max(MAX_ORDER_LINES, `An order can have at most ${String(MAX_ORDER_LINES)} lines.`)
})

export const updateLineInputSchema = z.object({
  orderId: idSchema,
  lineId: idSchema,
  quantity,
  notes: optionalText('Instructions', MAX_LINE_NOTES)
})

export const removeLineInputSchema = z.object({ orderId: idSchema, lineId: idSchema })

const reason = (message: string) =>
  z.string(message).trim().min(3, message).max(200, 'The reason must be at most 200 characters.')

export const cancelLineInputSchema = z.object({
  orderId: idSchema,
  lineId: idSchema,
  reason: reason('Say why the item is being cancelled.')
})

/** A draft that was never sent can be dropped without a reason; anything else needs one. */
export const cancelOrderInputSchema = z.object({
  id: idSchema,
  reason: z
    .string()
    .trim()
    .max(200, 'The reason must be at most 200 characters.')
    .nullish()
    .transform((value) => (value === null || value === undefined || value === '' ? null : value))
})

/** Sends a delivery out with a rider (or hands it to another rider while it is still out). */
export const dispatchOrderInputSchema = z.object({
  orderId: idSchema,
  riderName: z
    .string('Enter the rider name.')
    .trim()
    .min(2, 'Enter the rider name.')
    .max(60, 'The rider name must be at most 60 characters.'),
  riderPhone: phoneField
})

export const setOrderStatusInputSchema = z.object({
  id: idSchema,
  status: z.enum(SETTABLE_ORDER_STATUSES)
})

export const orderFilterSchema = z.object({
  /** Only orders that are still open (not completed or cancelled). */
  activeOnly: z.boolean().optional(),
  statuses: z.array(z.enum(ORDER_STATUSES)).max(ORDER_STATUSES.length).optional(),
  type: z.enum(ORDER_TYPES).optional(),
  tableId: idSchema.optional(),
  customerId: idSchema.optional(),
  /** Matches the order number, customer name or phone. */
  search: z.string().trim().max(60).optional(),
  limit: z.number().int().min(1).max(500).optional()
})

export type OrderLineInput = z.input<typeof orderLineInputSchema>
export type CreateOrderInput = z.input<typeof createOrderInputSchema>
export type UpdateOrderInput = z.input<typeof updateOrderInputSchema>
export type AddItemsInput = z.input<typeof addItemsInputSchema>
export type UpdateLineInput = z.input<typeof updateLineInputSchema>
export type RemoveLineInput = z.input<typeof removeLineInputSchema>
export type CancelLineInput = z.input<typeof cancelLineInputSchema>
export type CancelOrderInput = z.input<typeof cancelOrderInputSchema>
export type DispatchOrderInput = z.input<typeof dispatchOrderInputSchema>
export type SetOrderStatusInput = z.input<typeof setOrderStatusInputSchema>
export type OrderFilterInput = z.input<typeof orderFilterSchema>

export type OrderLineData = z.output<typeof orderLineInputSchema>
export type CreateOrderData = z.output<typeof createOrderInputSchema>
export type UpdateOrderData = z.output<typeof updateOrderInputSchema>
export type AddItemsData = z.output<typeof addItemsInputSchema>
export type UpdateLineData = z.output<typeof updateLineInputSchema>
export type RemoveLineData = z.output<typeof removeLineInputSchema>
export type CancelLineData = z.output<typeof cancelLineInputSchema>
export type CancelOrderData = z.output<typeof cancelOrderInputSchema>
export type DispatchOrderData = z.output<typeof dispatchOrderInputSchema>
export type SetOrderStatusData = z.output<typeof setOrderStatusInputSchema>
export type OrderFilterData = z.output<typeof orderFilterSchema>
