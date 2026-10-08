import { z } from 'zod'

/**
 * The cash drawer. Cash comes in from bills paid in cash and goes out with cash refunds, cash
 * expenses and cash supplier payments; none of these are copied anywhere, the "cash book" reads
 * them from where they live. What is recorded here is the rest: the opening float, cash added or
 * taken out (bank deposits, owner withdrawals). Entries are never edited; a wrong one is voided.
 * Closing the day adds the two count entries (shortage and excess) so the book agrees with the cash
 * actually counted; those are made by the day closing, never by hand.
 *
 * Money is whole paise. Dates the user picks are `YYYY-MM-DD` in the terminal's local time.
 */

export const CASH_ENTRY_KINDS = [
  'OPENING_FLOAT',
  'CASH_ADDED',
  'BANK_DEPOSIT',
  'OWNER_WITHDRAWAL',
  'CASH_REMOVED',
  'COUNT_SHORT',
  'COUNT_EXCESS'
] as const
export type CashEntryKind = (typeof CASH_ENTRY_KINDS)[number]

/** The kinds staff can record by hand; the count kinds come only from closing the day. */
export const MANUAL_CASH_ENTRY_KINDS = [
  'OPENING_FLOAT',
  'CASH_ADDED',
  'BANK_DEPOSIT',
  'OWNER_WITHDRAWAL',
  'CASH_REMOVED'
] as const satisfies readonly CashEntryKind[]

export type CashDirection = 'IN' | 'OUT'

export const CASH_ENTRY_DIRECTION: Record<CashEntryKind, CashDirection> = {
  OPENING_FLOAT: 'IN',
  CASH_ADDED: 'IN',
  BANK_DEPOSIT: 'OUT',
  OWNER_WITHDRAWAL: 'OUT',
  CASH_REMOVED: 'OUT',
  COUNT_SHORT: 'OUT',
  COUNT_EXCESS: 'IN'
}

export const CASH_ENTRY_LABELS: Record<CashEntryKind, string> = {
  OPENING_FLOAT: 'Opening float',
  CASH_ADDED: 'Cash added',
  BANK_DEPOSIT: 'Deposited in bank',
  OWNER_WITHDRAWAL: 'Owner withdrawal',
  CASH_REMOVED: 'Other cash taken out',
  COUNT_SHORT: 'Cash short at day closing',
  COUNT_EXCESS: 'Cash excess at day closing'
}

/** Where a line of the cash book comes from. */
export const CASH_BOOK_SOURCES = ['SALE', 'REFUND', 'EXPENSE', 'SUPPLIER_PAYMENT', 'ENTRY'] as const
export type CashBookSource = (typeof CASH_BOOK_SOURCES)[number]

export const CASH_BOOK_SOURCE_LABELS: Record<CashBookSource, string> = {
  SALE: 'Bill payment',
  REFUND: 'Refund',
  EXPENSE: 'Expense',
  SUPPLIER_PAYMENT: 'Supplier payment',
  ENTRY: 'Drawer entry'
}

/** The largest single cash entry, in paise (₹1 crore). */
export const MAX_CASH_AMOUNT = 1_000_000_000

// --- Records -------------------------------------------------------------------------------

export interface CashEntry {
  id: string
  kind: CashEntryKind
  direction: CashDirection
  amount: number
  notes: string | null
  /** When it happened (ISO). */
  occurredAt: string
  recordedBy: string | null
  voidedAt: string | null
  voidedBy: string | null
  voidReason: string | null
}

export interface CashBookRow {
  /** `source:id`, unique within the book. */
  key: string
  at: string
  source: CashBookSource
  direction: CashDirection
  amount: number
  description: string
  /** The bill, refund or expense number, or the id of a drawer entry. */
  reference: string | null
}

/** Every cash movement over a range of days, with the balance before and after. */
export interface CashBook {
  /** `YYYY-MM-DD`, inclusive. */
  from: string
  to: string
  openingBalance: number
  totalIn: number
  totalOut: number
  closingBalance: number
  rows: CashBookRow[]
}

/** How much cash the drawer should hold now, and today's movement. */
export interface CashSummary {
  balance: number
  todayIn: number
  todayOut: number
  /** When the opening float was last set; null if it never was. */
  lastFloatAt: string | null
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

const dateOnly = z
  .string('Choose a date.')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  }, 'Choose a real date.')

export const recordCashEntryInputSchema = z.object({
  kind: z.enum(MANUAL_CASH_ENTRY_KINDS, 'Choose what happened.'),
  amount: z
    .number('Amount is required.')
    .int('Amount must be a whole number of paise.')
    .min(1, 'Amount must be more than zero.')
    .max(MAX_CASH_AMOUNT, 'Amount is too large.'),
  notes: optionalText('Notes', 200),
  /** When it happened; now if left out. */
  occurredAt: z.iso.datetime().optional()
})

export const voidCashEntryInputSchema = z.object({
  id: idSchema,
  reason: requiredText('Reason', 200)
})

export const cashEntryFilterSchema = z.object({
  /** `YYYY-MM-DD`, inclusive. */
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  includeVoided: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional()
})

export const cashBookFilterSchema = z.object({
  /** `YYYY-MM-DD`, inclusive; today if left out. */
  from: dateOnly.optional(),
  to: dateOnly.optional()
})

export type RecordCashEntryInput = z.input<typeof recordCashEntryInputSchema>
export type VoidCashEntryInput = z.input<typeof voidCashEntryInputSchema>
export type CashEntryFilterInput = z.input<typeof cashEntryFilterSchema>
export type CashBookFilterInput = z.input<typeof cashBookFilterSchema>

export type RecordCashEntryData = z.output<typeof recordCashEntryInputSchema>
export type VoidCashEntryData = z.output<typeof voidCashEntryInputSchema>
export type CashEntryFilterData = z.output<typeof cashEntryFilterSchema>
export type CashBookFilterData = z.output<typeof cashBookFilterSchema>
