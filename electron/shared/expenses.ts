import { z } from 'zod'

/**
 * Expenses: money the restaurant spends that is not a stock purchase (rent, gas, salaries paid in
 * cash, repairs...). Each expense has a category, an amount and how it was paid. Expenses paid in
 * cash come out of the cash drawer (see `cash.ts`). Shared by the renderer (instant feedback) and
 * the main process (the checks).
 *
 * Money is whole paise. Dates the user picks are `YYYY-MM-DD` in the terminal's local time.
 */

export const EXPENSE_PAYMENT_METHODS = ['CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE', 'OTHER'] as const
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number]

export const EXPENSE_PAYMENT_LABELS: Record<ExpensePaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK: 'Bank transfer',
  CARD: 'Card',
  CHEQUE: 'Cheque',
  OTHER: 'Other'
}

/** The largest single expense, in paise (₹1 crore). */
export const MAX_EXPENSE_AMOUNT = 1_000_000_000

// --- Records -------------------------------------------------------------------------------

export interface ExpenseCategory {
  id: string
  name: string
  description: string | null
  isActive: boolean
  /** Expenses on record in this category, voided ones included. */
  expenseCount: number
}

export interface Expense {
  id: string
  expenseNumber: string
  categoryId: string
  categoryName: string
  amount: number
  method: ExpensePaymentMethod
  payee: string | null
  reference: string | null
  notes: string | null
  /** When the money was spent (ISO). */
  spentAt: string
  recordedBy: string | null
  createdAt: string
  voidedAt: string | null
  voidedBy: string | null
  voidReason: string | null
}

export interface ExpenseTotal {
  total: number
  count: number
}

/** What was spent over a range of days, voided expenses left out. */
export interface ExpenseSummary extends ExpenseTotal {
  /** `YYYY-MM-DD`, inclusive. */
  from: string
  to: string
  byCategory: (ExpenseTotal & { categoryId: string; name: string })[]
  byMethod: (ExpenseTotal & { method: ExpensePaymentMethod })[]
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

export const createExpenseCategoryInputSchema = z.object({
  name: requiredText('Category name', 60),
  description: optionalText('Description', 200)
})

export const updateExpenseCategoryInputSchema = createExpenseCategoryInputSchema.extend({
  id: idSchema
})

export const expenseCategoryFilterSchema = z.object({
  includeInactive: z.boolean().optional()
})

export const setExpenseCategoryActiveInputSchema = z.object({
  id: idSchema,
  isActive: z.boolean()
})

const expenseFields = {
  categoryId: idSchema,
  amount: z
    .number('Amount is required.')
    .int('Amount must be a whole number of paise.')
    .min(1, 'Amount must be more than zero.')
    .max(MAX_EXPENSE_AMOUNT, 'Amount is too large.'),
  method: z.enum(EXPENSE_PAYMENT_METHODS, 'Choose how it was paid.'),
  payee: optionalText('Paid to', 80),
  reference: optionalText('Reference', 60),
  notes: optionalText('Notes', 300),
  /** When it was spent; now if left out. */
  spentAt: z.iso.datetime().optional()
}

export const createExpenseInputSchema = z.object(expenseFields)

export const updateExpenseInputSchema = z.object({ id: idSchema, ...expenseFields })

export const voidExpenseInputSchema = z.object({
  id: idSchema,
  reason: requiredText('Reason', 200)
})

export const expenseFilterSchema = z.object({
  categoryId: idSchema.optional(),
  method: z.enum(EXPENSE_PAYMENT_METHODS).optional(),
  search: z.string().trim().max(60).optional(),
  /** `YYYY-MM-DD`, inclusive. */
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  includeVoided: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional()
})

export const expenseSummaryFilterSchema = z.object({
  /** `YYYY-MM-DD`, inclusive; the current month if left out. */
  from: dateOnly.optional(),
  to: dateOnly.optional()
})

export type CreateExpenseCategoryInput = z.input<typeof createExpenseCategoryInputSchema>
export type UpdateExpenseCategoryInput = z.input<typeof updateExpenseCategoryInputSchema>
export type ExpenseCategoryFilterInput = z.input<typeof expenseCategoryFilterSchema>
export type SetExpenseCategoryActiveInput = z.input<typeof setExpenseCategoryActiveInputSchema>
export type CreateExpenseInput = z.input<typeof createExpenseInputSchema>
export type UpdateExpenseInput = z.input<typeof updateExpenseInputSchema>
export type VoidExpenseInput = z.input<typeof voidExpenseInputSchema>
export type ExpenseFilterInput = z.input<typeof expenseFilterSchema>
export type ExpenseSummaryFilterInput = z.input<typeof expenseSummaryFilterSchema>

export type CreateExpenseCategoryData = z.output<typeof createExpenseCategoryInputSchema>
export type UpdateExpenseCategoryData = z.output<typeof updateExpenseCategoryInputSchema>
export type ExpenseCategoryFilterData = z.output<typeof expenseCategoryFilterSchema>
export type SetExpenseCategoryActiveData = z.output<typeof setExpenseCategoryActiveInputSchema>
export type CreateExpenseData = z.output<typeof createExpenseInputSchema>
export type UpdateExpenseData = z.output<typeof updateExpenseInputSchema>
export type VoidExpenseData = z.output<typeof voidExpenseInputSchema>
export type ExpenseFilterData = z.output<typeof expenseFilterSchema>
export type ExpenseSummaryFilterData = z.output<typeof expenseSummaryFilterSchema>
