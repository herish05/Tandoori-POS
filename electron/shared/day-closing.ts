import { z } from 'zod'
import type { OrderType } from './orders'

/**
 * Closing the day. At the end of a business day (the machine's local calendar day, as everywhere
 * else) the person in charge counts the cash in the drawer and closes the day. Closing freezes a
 * summary of what the day took and paid out, compares the cash counted with the cash the book says
 * the drawer should hold, and keeps the difference on record.
 *
 * Once a day is closed nothing can be dated inside it: no payments, refunds, expenses, supplier
 * payments or drawer entries, and none of them can be voided. A day can be reopened, with a reason,
 * only while no later day is closed. Closing again makes a new closing; the old one stays on record.
 *
 * Money is whole paise. Dates are `YYYY-MM-DD` in the terminal's local time.
 */

/** Notes and coins staff count, in paise, largest first. Used by the counting grid. */
export const CASH_DENOMINATIONS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100] as const

/** The largest cash count, in paise (₹1 crore). */
export const MAX_COUNTED_CASH = 1_000_000_000

/** How far back the days that were never closed are looked for. */
export const UNCLOSED_LOOKBACK_DAYS = 31

// --- Records -----------------------------------------------------------------------------------

/** What one payment method took or paid out over a day. */
export interface MethodTotal {
  method: string
  count: number
  amount: number
}

export interface DaySales {
  /** Bills settled during the day. */
  bills: number
  subtotal: number
  discounts: number
  serviceCharge: number
  tax: number
  roundOff: number
  /** What the settled bills came to, before any refund. */
  total: number
}

export interface DayOrderTypeTotal {
  type: OrderType
  bills: number
  total: number
}

export interface DayCash {
  /** What the book says the drawer held when the day began. */
  opening: number
  in: number
  out: number
  /** What the book says the drawer should hold when the day ends. */
  expected: number
}

/** Everything a day took and paid out. Frozen into the closing when the day is closed. */
export interface DaySummary {
  date: string
  sales: DaySales
  byOrderType: DayOrderTypeTotal[]
  /** Bills withdrawn during the day. */
  cancelledBills: number
  /** Money received against bills, by method. */
  collections: MethodTotal[]
  /** Money given back to guests, by method. */
  refunds: MethodTotal[]
  /** Expenses paid, by method. */
  expenses: MethodTotal[]
  /** Payments to suppliers, by method. */
  supplierPayments: MethodTotal[]
  cash: DayCash
}

export interface CashCount {
  /** A note or coin value, in paise. */
  value: number
  count: number
}

export interface DayClosing {
  id: string
  /** e.g. TB-DAY-000001 */
  closingNumber: string
  date: string
  closedAt: string
  closedBy: string | null
  summary: DaySummary
  expectedCash: number
  countedCash: number
  /** Counted minus expected: positive when there is more cash than the book says. */
  variance: number
  denominations: CashCount[]
  notes: string | null
  /** The drawer entry that made the book agree with the count; null when there was no difference. */
  adjustmentEntryId: string | null
  reopenedAt: string | null
  reopenedBy: string | null
  reopenReason: string | null
}

/** One line of the closing history. */
export interface DayClosingListItem {
  id: string
  closingNumber: string
  date: string
  closedAt: string
  closedBy: string | null
  billCount: number
  salesTotal: number
  expectedCash: number
  countedCash: number
  variance: number
  reopenedAt: string | null
}

/** One day as it stands: still open (with what it has taken so far) or closed. */
export interface DayStatus {
  date: string
  isToday: boolean
  /** The standing closing of the day; null while the day is open. */
  closing: DayClosing | null
  /** Live figures while open; the frozen figures once closed. */
  summary: DaySummary
  /** Why the day cannot be closed yet. */
  blockers: string[]
  canClose: boolean
}

export interface DayOverview {
  today: string
  todayClosed: boolean
  /** The latest day that stands closed. */
  lastClosed: DayClosingListItem | null
  /** Earlier days with money activity that were never closed, oldest first. */
  unclosedDays: string[]
}

// --- Validation --------------------------------------------------------------------------------

const dateOnly = z
  .string('Choose a date.')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  }, 'Choose a real date.')

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

const cashCountSchema = z.object({
  value: z.number().int().min(1, 'Enter the note or coin value.').max(MAX_COUNTED_CASH),
  count: z
    .number('Enter how many.')
    .int('Enter a whole number.')
    .min(1, 'Enter how many.')
    .max(1_000_000, 'That is too many.')
})

export const dayStatusInputSchema = z.object({
  /** Today if left out. */
  date: dateOnly.optional()
})

export const closeDayInputSchema = z
  .object({
    date: dateOnly,
    countedCash: z
      .number('Enter the cash counted.')
      .int('Cash must be a whole number of paise.')
      .min(0, 'Cash cannot be negative.')
      .max(MAX_COUNTED_CASH, 'That amount is too large.'),
    /** The count by note and coin, when it was done that way. It must add up to `countedCash`. */
    denominations: z.array(cashCountSchema).max(20).optional(),
    notes: optionalText('Notes', 300)
  })
  .superRefine((value, ctx) => {
    if (!value.denominations) return
    const values = value.denominations.map((line) => line.value)
    if (new Set(values).size !== values.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['denominations'],
        message: 'Each note or coin value can appear only once.'
      })
    }
    const sum = value.denominations.reduce((total, line) => total + line.value * line.count, 0)
    if (sum !== value.countedCash) {
      ctx.addIssue({
        code: 'custom',
        path: ['countedCash'],
        message: 'The notes and coins do not add up to the cash counted.'
      })
    }
  })

export const reopenDayInputSchema = z.object({
  id: z.uuid(),
  reason: requiredText('Reason', 200)
})

export const dayClosingFilterSchema = z.object({
  /** `YYYY-MM-DD`, inclusive. */
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  /** Also list closings that were reopened. */
  includeReopened: z.boolean().optional(),
  limit: z.number().int().min(1).max(366).optional()
})

export type DayStatusInput = z.input<typeof dayStatusInputSchema>
export type CloseDayInput = z.input<typeof closeDayInputSchema>
export type ReopenDayInput = z.input<typeof reopenDayInputSchema>
export type DayClosingFilterInput = z.input<typeof dayClosingFilterSchema>

export type DayStatusData = z.output<typeof dayStatusInputSchema>
export type CloseDayData = z.output<typeof closeDayInputSchema>
export type ReopenDayData = z.output<typeof reopenDayInputSchema>
export type DayClosingFilterData = z.output<typeof dayClosingFilterSchema>
