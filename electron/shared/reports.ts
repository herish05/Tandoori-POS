import { z } from 'zod'
import { ORDER_TYPES } from './orders'

/**
 * Reports. Every report is worked out in the main process from the database and returned as a
 * ready-to-show table: the screen only draws it. The same result is what is printed, saved as a PDF
 * and exported as CSV, so the three can never disagree with each other.
 *
 * Money is whole paise and quantities are thousandths. Dates are `YYYY-MM-DD` in the terminal's local
 * time; a range includes both its first and last day.
 */

/** The longest range a report may cover, in days (five years). */
export const MAX_REPORT_DAYS = 1830

/** Rows kept in one report; a longer report says so rather than slowing the screen down. */
export const MAX_REPORT_ROWS = 10_000

export const REPORT_KINDS = [
  'SALES',
  'DAILY_SALES',
  'MONTHLY_SALES',
  'ITEM_SALES',
  'CATEGORY_SALES',
  'PAYMENTS',
  'TAX',
  'DISCOUNTS',
  'STAFF_SALES',
  'KOT',
  'CANCELLED_ORDERS',
  'CANCELLED_BILLS',
  'INVENTORY',
  'PURCHASES',
  'SUPPLIERS',
  'EXPENSES',
  'DAY_CLOSINGS'
] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export const REPORT_GROUPS = [
  'Sales',
  'Kitchen and cancellations',
  'Stock and purchasing',
  'Money'
] as const
export type ReportGroup = (typeof REPORT_GROUPS)[number]

/** The filters a report can use besides its date range. */
export const REPORT_FILTER_KEYS = [
  'search',
  'orderType',
  'method',
  'categoryId',
  'expenseCategoryId',
  'staffId',
  'supplierId',
  'status'
] as const
export type ReportFilterKey = (typeof REPORT_FILTER_KEYS)[number]

export interface ReportMeta {
  label: string
  group: ReportGroup
  description: string
  /** The filters this report understands. */
  filters: readonly ReportFilterKey[]
  /** What the search box looks in, when there is one. */
  searchHint?: string
  /** The values the status filter offers, when there is one. */
  statuses?: readonly { value: string; label: string }[]
}

export const REPORTS: Record<ReportKind, ReportMeta> = {
  SALES: {
    label: 'Sales report',
    group: 'Sales',
    description: 'Every settled bill in the period, with its discounts, charges, tax and refunds.',
    filters: ['search', 'orderType', 'method', 'staffId'],
    searchHint: 'Bill, order or customer'
  },
  DAILY_SALES: {
    label: 'Daily sales',
    group: 'Sales',
    description: 'Sales, discounts, tax and refunds for each day.',
    filters: ['orderType', 'method', 'staffId']
  },
  MONTHLY_SALES: {
    label: 'Monthly sales',
    group: 'Sales',
    description: 'Sales, discounts, tax and refunds for each month.',
    filters: ['orderType', 'method', 'staffId']
  },
  ITEM_SALES: {
    label: 'Item sales',
    group: 'Sales',
    description: 'How many of each item were sold and what they earned, best sellers first.',
    filters: ['search', 'orderType', 'categoryId'],
    searchHint: 'Item name'
  },
  CATEGORY_SALES: {
    label: 'Category sales',
    group: 'Sales',
    description: 'Sales grouped by menu category.',
    filters: ['orderType', 'categoryId']
  },
  PAYMENTS: {
    label: 'Payment report',
    group: 'Sales',
    description:
      'Every payment received in the period, with totals for each method and the refunds paid back.',
    filters: ['search', 'method', 'staffId'],
    searchHint: 'Bill or reference'
  },
  TAX: {
    label: 'Tax report',
    group: 'Sales',
    description: 'The taxable value and tax collected on settled bills, by tax and rate.',
    filters: ['orderType']
  },
  DISCOUNTS: {
    label: 'Discount report',
    group: 'Sales',
    description: 'Every discount given on a settled bill, with the reason and who gave it.',
    filters: ['search', 'orderType', 'staffId'],
    searchHint: 'Bill or reason'
  },
  STAFF_SALES: {
    label: 'Staff sales',
    group: 'Sales',
    description: 'What each team member billed, discounted and had cancelled.',
    filters: ['orderType']
  },
  KOT: {
    label: 'KOT report',
    group: 'Kitchen and cancellations',
    description: 'Kitchen tickets, the station they went to and how long they took.',
    filters: ['search', 'status', 'orderType'],
    searchHint: 'KOT, order or station',
    statuses: [
      { value: 'NEW', label: 'New' },
      { value: 'ACCEPTED', label: 'Accepted' },
      { value: 'PREPARING', label: 'Preparing' },
      { value: 'READY', label: 'Ready' },
      { value: 'SERVED', label: 'Served' },
      { value: 'CANCELLED', label: 'Cancelled' }
    ]
  },
  CANCELLED_ORDERS: {
    label: 'Cancelled orders',
    group: 'Kitchen and cancellations',
    description: 'Orders that were cancelled, who cancelled them and why.',
    filters: ['search', 'orderType', 'staffId'],
    searchHint: 'Order or reason'
  },
  CANCELLED_BILLS: {
    label: 'Cancelled bills',
    group: 'Kitchen and cancellations',
    description: 'Bills that were withdrawn, who withdrew them and why.',
    filters: ['search', 'orderType', 'staffId'],
    searchHint: 'Bill or reason'
  },
  INVENTORY: {
    label: 'Inventory report',
    group: 'Stock and purchasing',
    description: 'Stock on hand and its value now, with what came in and went out in the period.',
    filters: ['search', 'status'],
    searchHint: 'Item or category',
    statuses: [
      { value: 'LOW', label: 'Low stock' },
      { value: 'OUT', label: 'Out of stock' },
      { value: 'INACTIVE', label: 'Inactive' }
    ]
  },
  PURCHASES: {
    label: 'Purchase report',
    group: 'Stock and purchasing',
    description:
      'Received purchases dated in the period, what they cost and what is still owed. Pick a status to see drafts or cancelled ones.',
    filters: ['search', 'supplierId', 'status'],
    searchHint: 'Purchase, invoice or supplier',
    statuses: [
      { value: 'RECEIVED', label: 'Received' },
      { value: 'DRAFT', label: 'Draft' },
      { value: 'CANCELLED', label: 'Cancelled' }
    ]
  },
  SUPPLIERS: {
    label: 'Supplier report',
    group: 'Stock and purchasing',
    description: 'What was bought from each supplier, what was paid and what is still owed.',
    filters: ['search', 'supplierId'],
    searchHint: 'Supplier'
  },
  EXPENSES: {
    label: 'Expense report',
    group: 'Money',
    description: 'Expenses in the period by category and payment method.',
    filters: ['search', 'expenseCategoryId', 'method'],
    searchHint: 'Number, payee, reference or notes'
  },
  DAY_CLOSINGS: {
    label: 'Day closing report',
    group: 'Money',
    description:
      'Every closing in the period with the cash the book expected, what was counted and the difference.',
    filters: ['status'],
    statuses: [
      { value: 'STANDING', label: 'In force' },
      { value: 'REOPENED', label: 'Reopened' }
    ]
  }
}

// --- Validation ---------------------------------------------------------------------------------

const dateOnly = z
  .string('Choose a date.')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  }, 'Choose a real date.')

const optionalId = z.string().trim().min(1).max(64).optional()

export const reportFilterSchema = z
  .object({
    kind: z.enum(REPORT_KINDS, 'Choose a report.'),
    from: dateOnly,
    to: dateOnly,
    search: z.string().trim().max(80, 'Search is too long.').optional(),
    orderType: z.enum(ORDER_TYPES).optional(),
    method: z.string().trim().min(1).max(20).optional(),
    categoryId: optionalId,
    expenseCategoryId: optionalId,
    staffId: optionalId,
    supplierId: optionalId,
    status: z.string().trim().min(1).max(20).optional()
  })
  .superRefine((value, ctx) => {
    if (value.from > value.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'The end date is before the start date.'
      })
      return
    }
    const days =
      (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000 + 1
    if (days > MAX_REPORT_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `A report can cover at most ${String(MAX_REPORT_DAYS)} days.`
      })
    }
  })
export type ReportFilterInput = z.input<typeof reportFilterSchema>
export type ReportFilterData = z.output<typeof reportFilterSchema>

// --- Results ------------------------------------------------------------------------------------

/**
 * How a column's values are shown: money in paise, quantities in thousandths, percentages in basis
 * points (1250 is 12.50%), minutes whole, dates as `YYYY-MM-DD` and date-times as ISO strings.
 */
export type ReportColumnType =
  'text' | 'int' | 'money' | 'quantity' | 'percent' | 'minutes' | 'date' | 'datetime'

export type ReportCell = string | number | null

export interface ReportColumn {
  key: string
  label: string
  type: ReportColumnType
  /** True when the column adds up into the totals row. */
  total?: boolean
}

export interface ReportSummaryItem {
  label: string
  value: number | string
  type: ReportColumnType
}

export interface ReportResult {
  kind: ReportKind
  title: string
  from: string
  to: string
  /** ISO time the report was worked out. */
  generatedAt: string
  /** The filters in force, in words, e.g. "Order type: Dine-in". */
  filters: string[]
  summary: ReportSummaryItem[]
  columns: ReportColumn[]
  rows: Record<string, ReportCell>[]
  /** A total for the columns that add up, keyed like the rows; null when none do. */
  totals: Record<string, ReportCell> | null
  /** True when there were more than {@link MAX_REPORT_ROWS} rows and the rest were left out. */
  truncated: boolean
}

export interface ReportOption {
  id: string
  name: string
}

/** The lists the filters choose from. */
export interface ReportOptions {
  staff: ReportOption[]
  categories: ReportOption[]
  expenseCategories: ReportOption[]
  suppliers: ReportOption[]
}

/** What happened to an export: the file chosen, or nothing when the person cancelled. */
export interface ReportFileResult {
  saved: boolean
  path: string | null
}

/** A report's filename, e.g. `daily-sales_2026-01-01_2026-01-31`. */
export function reportFileStem(filter: { kind: ReportKind; from: string; to: string }): string {
  const name = REPORTS[filter.kind].label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `${name}_${filter.from}_${filter.to}`
}
