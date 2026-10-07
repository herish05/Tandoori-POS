import { z } from 'zod'
import type { FoodType } from './menu'
import type { OrderStatus, OrderType } from './orders'

/**
 * Bills: the money side of an order. Shared by the renderer (labels, instant feedback) and the
 * main process (the real checks).
 *
 * Every amount is a whole number of paise (1 rupee = 100 paise). Percentages are basis points
 * (1% = 100). The renderer never sends a total: the main process calculates every figure from
 * the order lines, the discounts and the billing settings.
 */

// --- Settings ----------------------------------------------------------------------------

/**
 * How GST is split. Within the state a tax category's rate is shown half as CGST and half as
 * SGST; between states the whole rate is IGST.
 */
export const TAX_MODES = ['INTRA_STATE', 'INTER_STATE'] as const
export type TaxMode = (typeof TAX_MODES)[number]

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  INTRA_STATE: 'CGST + SGST (same state)',
  INTER_STATE: 'IGST (another state)'
}

export const TAX_COMPONENTS = ['CGST', 'SGST', 'IGST'] as const
export type TaxComponent = (typeof TAX_COMPONENTS)[number]

/** The grand total is rounded to a multiple of this many paise: 1 = no rounding, 100 = a rupee. */
export const ROUND_OFF_UNITS = [1, 10, 50, 100] as const
export type RoundOffUnit = (typeof ROUND_OFF_UNITS)[number]

export const ROUND_OFF_LABELS: Record<RoundOffUnit, string> = {
  1: 'No rounding',
  10: 'Nearest 10 paise',
  50: 'Nearest 50 paise',
  100: 'Nearest rupee'
}

export const MAX_SERVICE_CHARGE_BPS = 3000
/** The most a flat delivery or packaging charge can be (Rs 10,000), in paise. */
export const MAX_FLAT_CHARGE = 1_000_000
/** The highest GST rate that can be put on those charges, in basis points. */
export const MAX_CHARGE_TAX_BPS = 2800

export interface BillingSettings {
  taxMode: TaxMode
  /** Basis points of the bill after discounts; 0 = no service charge. */
  serviceChargeBps: number
  /** Charge it on dine-in orders only, not on take-away, pickup and delivery. */
  serviceChargeDineInOnly: boolean
  /** GST is charged on the service charge too, at each item's own rate. */
  serviceChargeTaxable: boolean
  roundOffUnit: RoundOffUnit
  /** Print the receipt as soon as a bill is paid (needs a printer set up). */
  autoPrintReceipt: boolean
  /** Paise charged on every delivery bill; 0 = no delivery charge. */
  deliveryCharge: number
  /** A delivery whose items add up to at least this many paise is free; 0 = never free. */
  deliveryFreeAbove: number
  /** GST on the delivery charge, in basis points. */
  deliveryChargeTaxBps: number
  /** Paise charged once on every takeaway, pickup and delivery bill; 0 = none. */
  packagingCharge: number
  /** GST on the packaging charge, in basis points. */
  packagingChargeTaxBps: number
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  taxMode: 'INTRA_STATE',
  serviceChargeBps: 0,
  serviceChargeDineInOnly: true,
  serviceChargeTaxable: true,
  roundOffUnit: 100,
  autoPrintReceipt: false,
  deliveryCharge: 0,
  deliveryFreeAbove: 0,
  deliveryChargeTaxBps: 0,
  packagingCharge: 0,
  packagingChargeTaxBps: 0
}

// --- Discounts ---------------------------------------------------------------------------

export const DISCOUNT_TYPES = ['PERCENTAGE', 'FIXED'] as const
export type DiscountType = (typeof DISCOUNT_TYPES)[number]

export const DISCOUNT_TYPE_LABELS: Record<DiscountType, string> = {
  PERCENTAGE: 'Percentage',
  FIXED: 'Fixed amount'
}

export const DISCOUNT_SCOPES = ['ITEM', 'BILL'] as const
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number]

// --- Bills and payments ------------------------------------------------------------------

export const BILL_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'REFUNDED', 'CANCELLED'] as const
export type BillStatus = (typeof BILL_STATUSES)[number]

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  PENDING: 'Unpaid',
  PARTIAL: 'Part paid',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled'
}

/** Bills that have taken money, so a refund can be given on them. */
export const REFUNDABLE_BILL_STATUSES: readonly BillStatus[] = ['PARTIAL', 'PAID']

/** A bill can be changed (discounts) or cancelled only while nothing has been paid on it. */
export const CHANGEABLE_BILL_STATUSES: readonly BillStatus[] = ['PENDING']
/** A bill that still has something to collect. */
export const PAYABLE_BILL_STATUSES: readonly BillStatus[] = ['PENDING', 'PARTIAL']

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'OTHER'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  OTHER: 'Other'
}

export const MAX_PAYMENTS_PER_REQUEST = 10
export const MAX_PAYMENT_REFERENCE = 60
/** Largest amount accepted in one payment line: ten lakh rupees, in paise. */
export const MAX_PAYMENT_AMOUNT = 100_000_000

/** Orders in these states can be billed. */
export const BILLABLE_ORDER_STATUSES: readonly OrderStatus[] = ['SERVED', 'BILL_REQUESTED']

// --- Response shapes ---------------------------------------------------------------------

export interface BillItem {
  id: string
  orderItemId: string
  name: string
  variantName: string | null
  foodType: FoodType
  quantity: number
  /** Paise per unit, with the priced add-ons included. */
  unitPrice: number
  /** unitPrice x quantity. */
  gross: number
  /** Paise taken off this line by an item discount. */
  itemDiscount: number
  /** This line's share of the bill discount. */
  billDiscountShare: number
  /** This line's share of the service charge. */
  serviceChargeShare: number
  /** What the GST is worked out on: gross minus discounts, plus the taxable service charge. */
  taxableValue: number
  taxName: string | null
  taxRateBps: number
}

export interface BillTaxLine {
  component: TaxComponent
  /** Basis points of the whole GST rate of the category (500 for 5%), shared by its CGST and SGST halves. */
  rateBps: number
  taxableAmount: number
  taxAmount: number
}

export interface BillDiscount {
  id: string
  scope: DiscountScope
  /** The bill line it applies to, for an item discount. */
  billItemId: string | null
  type: DiscountType
  /** Basis points for a percentage, paise for a fixed amount. */
  value: number
  /** Paise this discount actually took off. */
  amount: number
  reason: string
  appliedByName: string
  createdAt: string
}

export interface BillPayment {
  id: string
  method: PaymentMethod
  /** Paise that went against the bill. */
  amount: number
  /** Paise handed over; more than the amount only for cash, when change is given. */
  tendered: number
  change: number
  reference: string | null
  receivedByName: string
  receivedAt: string
}

export interface BillRefundLine {
  method: PaymentMethod
  /** Paise given back by this method. */
  amount: number
  reference: string | null
}

/** Money given back to the guest. Several can follow one bill until everything paid is returned. */
export interface BillRefund {
  id: string
  refundNumber: string
  /** Paise given back in all. */
  amount: number
  reason: string
  refundedByName: string
  refundedAt: string
  lines: BillRefundLine[]
}

/** How much can still be given back through one payment method. */
export interface RefundableAmount {
  method: PaymentMethod
  amount: number
}

export interface BillSummary {
  id: string
  billNumber: string
  status: BillStatus
  orderId: string
  orderNumber: string
  orderType: OrderType
  tableNumber: string | null
  customerName: string | null
  grandTotal: number
  paidTotal: number
  /** Paise given back so far; never more than was paid. */
  refundedTotal: number
  /** What is still to collect; 0 once paid. */
  balance: number
  createdAt: string
}

export interface BillDetail extends BillSummary {
  /** Gross of all lines, before any discount. */
  subtotal: number
  itemDiscountTotal: number
  billDiscountTotal: number
  /** Subtotal minus both discounts. */
  discountedSubtotal: number
  serviceChargeBps: number
  serviceCharge: number
  /** Paise charged for delivery on this bill; 0 when none. Not discounted; GST applies. */
  deliveryCharge: number
  /** Paise charged for packaging on this bill; 0 when none. */
  packagingCharge: number
  taxMode: TaxMode
  taxTotal: number
  /** Rounding up or down to the round-off unit; negative when rounded down. */
  roundOff: number
  roundOffUnit: RoundOffUnit
  items: BillItem[]
  taxes: BillTaxLine[]
  discounts: BillDiscount[]
  payments: BillPayment[]
  refunds: BillRefund[]
  /** What can still be returned, per method that took money; empty when nothing is refundable. */
  refundable: RefundableAmount[]
  createdByName: string
  cancelReason: string | null
  cancelledAt: string | null
  paidAt: string | null
  /** The order is no longer awaiting payment (it is complete or was cancelled). */
  orderClosed: boolean
}

export interface PayBillResult {
  bill: BillDetail
  /** Paise of change owed to the guest for the cash handed over. */
  changeDue: number
}

export interface RefundBillResult {
  bill: BillDetail
  refund: BillRefund
  /** The bill was only part paid, so refunding it withdrew the bill and reopened the order. */
  billCancelled: boolean
}

// --- Inputs ------------------------------------------------------------------------------

const idSchema = z.uuid()

const reason = (message: string) =>
  z.string(message).trim().min(3, message).max(200, 'The reason must be at most 200 characters.')

const chargeAmount = (label: string) =>
  z
    .number(`Enter the ${label}.`)
    .int('Enter a whole number of paise.')
    .min(0, `The ${label} cannot be negative.`)
    .max(MAX_FLAT_CHARGE, `The ${label} cannot be more than Rs 10,000.`)
    .default(0)

const chargeTax = (label: string) =>
  z
    .number(`Enter the GST on the ${label}.`)
    .int('Enter a whole number of basis points.')
    .min(0, 'GST cannot be negative.')
    .max(MAX_CHARGE_TAX_BPS, 'GST cannot be more than 28%.')
    .default(0)

export const updateBillingSettingsInputSchema = z.object({
  taxMode: z.enum(TAX_MODES),
  serviceChargeBps: z
    .number('Enter the service charge.')
    .int('Enter a whole number of basis points.')
    .min(0, 'The service charge cannot be negative.')
    .max(MAX_SERVICE_CHARGE_BPS, 'The service charge cannot be more than 30%.'),
  serviceChargeDineInOnly: z.boolean(),
  serviceChargeTaxable: z.boolean(),
  roundOffUnit: z.union([z.literal(1), z.literal(10), z.literal(50), z.literal(100)]),
  autoPrintReceipt: z.boolean().default(false),
  deliveryCharge: chargeAmount('delivery charge'),
  deliveryFreeAbove: chargeAmount('free-delivery amount'),
  deliveryChargeTaxBps: chargeTax('delivery charge'),
  packagingCharge: chargeAmount('packaging charge'),
  packagingChargeTaxBps: chargeTax('packaging charge')
})

export const generateBillInputSchema = z.object({ orderId: idSchema })

export const billFilterSchema = z.object({
  statuses: z.array(z.enum(BILL_STATUSES)).max(BILL_STATUSES.length).optional(),
  orderId: idSchema.optional(),
  /** Matches the bill or order number. */
  search: z.string().trim().max(60).optional(),
  limit: z.number().int().min(1).max(500).optional()
})

const discountFields = z.object({
  billId: idSchema,
  scope: z.enum(DISCOUNT_SCOPES),
  billItemId: idSchema.nullish().transform((value) => value ?? null),
  type: z.enum(DISCOUNT_TYPES),
  /** Basis points for a percentage, paise for a fixed amount. */
  value: z.number('Enter the discount.').int('Enter a whole number.').min(1, 'Enter the discount.'),
  reason: reason('Say why the discount is given.')
})

export const applyDiscountInputSchema = discountFields.superRefine((value, ctx) => {
  if (value.scope === 'ITEM' && value.billItemId === null) {
    ctx.addIssue({ code: 'custom', path: ['billItemId'], message: 'Choose the item.' })
  }
  if (value.scope === 'BILL' && value.billItemId !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['billItemId'],
      message: 'A bill discount does not belong to one item.'
    })
  }
  if (value.type === 'PERCENTAGE' && value.value > 10_000) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'A percentage cannot be more than 100.'
    })
  }
})

export const removeDiscountInputSchema = z.object({ billId: idSchema, discountId: idSchema })

export const cancelBillInputSchema = z.object({
  id: idSchema,
  reason: reason('Say why the bill is being cancelled.')
})

const paymentLine = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount: z
      .number('Enter the amount.')
      .int('Enter a whole number of paise.')
      .min(1, 'Enter the amount.')
      .max(MAX_PAYMENT_AMOUNT, 'That amount is too large.'),
    /** Cash handed over, when it is more than the amount. */
    tendered: z.number().int().min(1).max(MAX_PAYMENT_AMOUNT).nullish(),
    reference: z
      .string()
      .trim()
      .max(MAX_PAYMENT_REFERENCE, `Keep the reference under ${MAX_PAYMENT_REFERENCE} characters.`)
      .nullish()
      .transform((value) => (value?.length ? value : null))
  })
  .superRefine((value, ctx) => {
    if (value.tendered != null && value.method !== 'CASH') {
      ctx.addIssue({
        code: 'custom',
        path: ['tendered'],
        message: 'Only cash can be handed over for more than the amount.'
      })
    }
    if (value.tendered != null && value.tendered < value.amount) {
      ctx.addIssue({
        code: 'custom',
        path: ['tendered'],
        message: 'The cash handed over is less than the amount.'
      })
    }
    if (value.method === 'OTHER' && !value.reference) {
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'Say how it was paid (for example voucher or wallet).'
      })
    }
  })

/** An empty list settles a bill whose total is zero (for example a fully discounted one). */
export const payBillInputSchema = z.object({
  billId: idSchema,
  payments: z.array(paymentLine).max(MAX_PAYMENTS_PER_REQUEST)
})

const refundLine = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount: z
      .number('Enter the amount.')
      .int('Enter a whole number of paise.')
      .min(1, 'Enter the amount.')
      .max(MAX_PAYMENT_AMOUNT, 'That amount is too large.'),
    reference: z
      .string()
      .trim()
      .max(MAX_PAYMENT_REFERENCE, `Keep the reference under ${MAX_PAYMENT_REFERENCE} characters.`)
      .nullish()
      .transform((value) => (value?.length ? value : null))
  })
  .superRefine((value, ctx) => {
    if (value.method === 'OTHER' && !value.reference) {
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'Say how it was returned (for example voucher or wallet).'
      })
    }
  })

/** One line per payment method; the amounts are checked against what each method took. */
export const refundBillInputSchema = z
  .object({
    billId: idSchema,
    reason: reason('Say why the money is being returned.'),
    lines: z.array(refundLine).min(1, 'Enter the amount to return.').max(PAYMENT_METHODS.length)
  })
  .superRefine((value, ctx) => {
    const methods = value.lines.map((line) => line.method)
    if (new Set(methods).size !== methods.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Use each payment method once.'
      })
    }
  })

export type UpdateBillingSettingsInput = z.input<typeof updateBillingSettingsInputSchema>
export type RefundBillInput = z.input<typeof refundBillInputSchema>
export type RefundBillData = z.output<typeof refundBillInputSchema>
export type GenerateBillInput = z.input<typeof generateBillInputSchema>
export type BillFilterInput = z.input<typeof billFilterSchema>
export type ApplyDiscountInput = z.input<typeof applyDiscountInputSchema>
export type RemoveDiscountInput = z.input<typeof removeDiscountInputSchema>
export type CancelBillInput = z.input<typeof cancelBillInputSchema>
export type PayBillInput = z.input<typeof payBillInputSchema>
export type PaymentLineInput = z.input<typeof paymentLine>

export type UpdateBillingSettingsData = z.output<typeof updateBillingSettingsInputSchema>
export type BillFilterData = z.output<typeof billFilterSchema>
export type ApplyDiscountData = z.output<typeof applyDiscountInputSchema>
export type PayBillData = z.output<typeof payBillInputSchema>
