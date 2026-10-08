import { z } from 'zod'
import { MAX_QUANTITY, type InventoryUnit } from './inventory'
import { MAX_PHONE_DIGITS, MIN_PHONE_DIGITS, normalizePhone } from './customers'

/**
 * Suppliers and purchases: who the restaurant buys raw materials from, what was bought on each
 * invoice, and what is still owed. Receiving a purchase puts its quantities into stock. Shared by
 * the renderer (instant feedback) and the main process (the checks).
 *
 * Money is whole paise. Quantities are whole thousandths of the item's unit (see `inventory.ts`).
 */

export const PURCHASE_STATUSES = ['DRAFT', 'RECEIVED', 'CANCELLED'] as const
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number]

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: 'Draft',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled'
}

/** Where a received purchase stands against what was paid for it. */
export type PurchasePaymentStatus = 'NOT_DUE' | 'UNPAID' | 'PARTIAL' | 'PAID'

export const PAYMENT_STATUS_LABELS: Record<PurchasePaymentStatus, string> = {
  NOT_DUE: '—',
  UNPAID: 'Unpaid',
  PARTIAL: 'Part paid',
  PAID: 'Paid'
}

export const SUPPLIER_PAYMENT_METHODS = ['CASH', 'UPI', 'BANK', 'CHEQUE', 'OTHER'] as const
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number]

export const SUPPLIER_PAYMENT_LABELS: Record<SupplierPaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK: 'Bank transfer',
  CHEQUE: 'Cheque',
  OTHER: 'Other'
}

export const MAX_PURCHASE_LINES = 60
/** Largest money amount accepted in one field: one crore rupees, in paise. */
export const MAX_PURCHASE_AMOUNT = 10_000_000_00

// --- Helpers -------------------------------------------------------------------------------

export function paymentStatusOf(
  status: PurchaseStatus,
  total: number,
  amountPaid: number
): PurchasePaymentStatus {
  if (status !== 'RECEIVED') return 'NOT_DUE'
  if (amountPaid >= total) return 'PAID'
  return amountPaid > 0 ? 'PARTIAL' : 'UNPAID'
}

// --- Response shapes -----------------------------------------------------------------------

export interface Supplier {
  id: string
  name: string
  contactPerson: string | null
  /** Normalised digits. */
  phone: string | null
  email: string | null
  address: string | null
  gstin: string | null
  notes: string | null
  isActive: boolean
  /** Received purchases only. */
  purchaseCount: number
  /** Paise: the total of all received purchases. */
  totalPurchased: number
  /** Paise: what is still owed to this supplier. */
  amountDue: number
  lastPurchaseDate: string | null
  createdAt: string
}

export interface PurchasingSummary {
  draftCount: number
  /** Received purchases that are not fully paid. */
  unpaidCount: number
  /** Paise: owed to suppliers over all received purchases. */
  totalDue: number
  /** Paise: received this calendar month. */
  purchasedThisMonth: number
}

export interface PurchaseSummary {
  id: string
  purchaseNumber: string
  supplierId: string
  supplierName: string
  invoiceNumber: string | null
  /** `YYYY-MM-DD`. */
  purchaseDate: string
  status: PurchaseStatus
  paymentStatus: PurchasePaymentStatus
  lineCount: number
  total: number
  amountPaid: number
  /** Paise still owed; 0 unless the purchase is received. */
  amountDue: number
  createdAt: string
}

export interface PurchaseLine {
  id: string
  inventoryItemId: string
  itemName: string
  unit: InventoryUnit
  /** Thousandths of the unit. */
  quantity: number
  /** Paise per whole unit. */
  unitCost: number
  /** Paise. */
  lineTotal: number
}

export interface SupplierPayment {
  id: string
  amount: number
  method: SupplierPaymentMethod
  reference: string | null
  notes: string | null
  paidAt: string
  recordedBy: string | null
  voidedAt: string | null
  voidReason: string | null
}

export interface Purchase extends PurchaseSummary {
  notes: string | null
  subtotal: number
  discount: number
  tax: number
  lines: PurchaseLine[]
  payments: SupplierPayment[]
  receivedAt: string | null
  receivedBy: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdBy: string | null
}

// --- Validation ----------------------------------------------------------------------------

const idSchema = z.uuid()

const requiredText = (label: string, max: number) =>
  z
    .string(`${label} is required.`)
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${String(max)} characters.`)

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${String(max)} characters.`)
    .nullish()
    .transform((value) => (value === null || value === undefined || value === '' ? null : value))

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

const optionalPhone = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value === null || value === undefined || value === '' ? null : value))
  .refine(
    (value) =>
      value === null ||
      (/^\+?[0-9][0-9\s-]{3,20}$/.test(value) &&
        normalizePhone(value).length >= MIN_PHONE_DIGITS &&
        normalizePhone(value).length <= MAX_PHONE_DIGITS),
    'Enter a valid phone number.'
  )
  .transform((value) => (value === null ? null : normalizePhone(value)))

const optionalGstin = z
  .string()
  .trim()
  .nullish()
  .transform((value) =>
    value === null || value === undefined || value === '' ? null : value.toUpperCase()
  )
  .refine(
    (value) => value === null || GSTIN_PATTERN.test(value),
    'Enter a valid 15-character GSTIN.'
  )

const paise = (label: string) =>
  z
    .number(`${label} is required.`)
    .int(`${label} must be a whole number of paise.`)
    .min(0, `${label} cannot be negative.`)
    .max(MAX_PURCHASE_AMOUNT, `${label} is too large.`)

const positivePaise = (label: string) => paise(label).min(1, `${label} must be more than zero.`)

const dateOnly = z
  .string('Choose the purchase date.')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the purchase date.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  }, 'Choose a real date.')

const supplierFields = {
  name: requiredText('Supplier name', 80),
  contactPerson: optionalText('Contact person', 80),
  phone: optionalPhone,
  email: optionalText('Email', 120).refine(
    (value) => value === null || z.email().safeParse(value).success,
    'Enter a valid email address.'
  ),
  address: optionalText('Address', 300),
  gstin: optionalGstin,
  notes: optionalText('Notes', 300)
}

export const createSupplierInputSchema = z.object(supplierFields)
export const updateSupplierInputSchema = z.object({ id: idSchema, ...supplierFields })
export const setSupplierActiveInputSchema = z.object({ id: idSchema, isActive: z.boolean() })
export const supplierFilterSchema = z.object({
  search: z.string().trim().max(60).optional(),
  includeInactive: z.boolean().optional(),
  /** Only suppliers that are owed money. */
  dueOnly: z.boolean().optional()
})

const lineSchema = z.object({
  inventoryItemId: idSchema,
  quantity: z
    .number('Quantity is required.')
    .int('Quantity must be a whole number of thousandths.')
    .min(1, 'Quantity must be more than zero.')
    .max(MAX_QUANTITY, 'Quantity is too large.'),
  /** Paise per whole unit. */
  unitCost: paise('Price')
})

const purchaseFields = {
  supplierId: idSchema,
  purchaseDate: dateOnly,
  invoiceNumber: optionalText('Invoice number', 40),
  notes: optionalText('Notes', 300),
  discount: paise('Discount').default(0),
  tax: paise('Tax').default(0),
  lines: z
    .array(lineSchema)
    .min(1, 'Add at least one item.')
    .max(MAX_PURCHASE_LINES, `A purchase can have at most ${String(MAX_PURCHASE_LINES)} items.`)
}

/** Each stock item can be on a purchase once; add the quantity up instead. */
const uniqueItems = (input: { lines: { inventoryItemId: string }[] }): boolean =>
  new Set(input.lines.map((line) => line.inventoryItemId)).size === input.lines.length

const UNIQUE_ITEMS_ISSUE = {
  message: 'Each item can appear only once on a purchase.',
  path: ['lines']
}

export const createPurchaseInputSchema = z
  .object(purchaseFields)
  .refine(uniqueItems, UNIQUE_ITEMS_ISSUE)
export const updatePurchaseInputSchema = z
  .object({ id: idSchema, ...purchaseFields })
  .refine(uniqueItems, UNIQUE_ITEMS_ISSUE)

export const cancelPurchaseInputSchema = z.object({
  id: idSchema,
  reason: requiredText('Reason', 200)
})

export const purchaseFilterSchema = z.object({
  status: z.enum(PURCHASE_STATUSES).optional(),
  supplierId: idSchema.optional(),
  search: z.string().trim().max(60).optional(),
  /** Received purchases that are not fully paid. */
  unpaidOnly: z.boolean().optional(),
  /** `YYYY-MM-DD`, inclusive. */
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  limit: z.number().int().min(1).max(1000).optional()
})

export const recordPaymentInputSchema = z.object({
  purchaseId: idSchema,
  amount: positivePaise('Amount'),
  method: z.enum(SUPPLIER_PAYMENT_METHODS, 'Choose how it was paid.'),
  reference: optionalText('Reference', 60),
  notes: optionalText('Notes', 200),
  /** When it was paid; now if left out. */
  paidAt: z.iso.datetime().optional()
})

export const voidPaymentInputSchema = z.object({
  id: idSchema,
  reason: requiredText('Reason', 200)
})

export type CreateSupplierInput = z.input<typeof createSupplierInputSchema>
export type UpdateSupplierInput = z.input<typeof updateSupplierInputSchema>
export type SetSupplierActiveInput = z.input<typeof setSupplierActiveInputSchema>
export type SupplierFilterInput = z.input<typeof supplierFilterSchema>
export type CreatePurchaseInput = z.input<typeof createPurchaseInputSchema>
export type UpdatePurchaseInput = z.input<typeof updatePurchaseInputSchema>
export type CancelPurchaseInput = z.input<typeof cancelPurchaseInputSchema>
export type PurchaseFilterInput = z.input<typeof purchaseFilterSchema>
export type RecordPaymentInput = z.input<typeof recordPaymentInputSchema>
export type VoidPaymentInput = z.input<typeof voidPaymentInputSchema>

export type CreateSupplierData = z.output<typeof createSupplierInputSchema>
export type UpdateSupplierData = z.output<typeof updateSupplierInputSchema>
export type SetSupplierActiveData = z.output<typeof setSupplierActiveInputSchema>
export type SupplierFilterData = z.output<typeof supplierFilterSchema>
export type CreatePurchaseData = z.output<typeof createPurchaseInputSchema>
export type UpdatePurchaseData = z.output<typeof updatePurchaseInputSchema>
export type CancelPurchaseData = z.output<typeof cancelPurchaseInputSchema>
export type PurchaseFilterData = z.output<typeof purchaseFilterSchema>
export type RecordPaymentData = z.output<typeof recordPaymentInputSchema>
export type VoidPaymentData = z.output<typeof voidPaymentInputSchema>
