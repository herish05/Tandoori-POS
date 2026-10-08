import { asc, isNull } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext, Clock } from '../auth/types'
import type { AppDatabase } from '../db/client'
import { categories, expenseCategories, restaurants, suppliers, users } from '../db/schema'
import { endOfLocalDay, startOfLocalDay } from '../finance/dates'
import { AppError } from '../ipc/errors'
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@shared/billing'
import { EXPENSE_PAYMENT_LABELS, EXPENSE_PAYMENT_METHODS } from '@shared/expenses'
import { ORDER_TYPE_LABELS } from '@shared/orders'
import {
  MAX_REPORT_ROWS,
  REPORTS,
  reportFileStem,
  type ReportCell,
  type ReportFilterData,
  type ReportKind,
  type ReportOption,
  type ReportOptions,
  type ReportResult
} from '@shared/reports'
import {
  dayClosingsReport,
  expensesReport,
  inventoryReport,
  purchasesReport,
  suppliersReport
} from './back-office-reports'
import type { ReportBody, ReportContext } from './context'
import { reportToCsv, reportToHtml } from './format'
import { cancelledBillsReport, cancelledOrdersReport, kotReport } from './operations-reports'
import {
  categorySalesReport,
  dailySalesReport,
  discountsReport,
  itemSalesReport,
  monthlySalesReport,
  paymentsReport,
  salesReport,
  staffSalesReport,
  taxReport
} from './sales-reports'

const BUILDERS: Record<ReportKind, (ctx: ReportContext) => ReportBody> = {
  SALES: salesReport,
  DAILY_SALES: dailySalesReport,
  MONTHLY_SALES: monthlySalesReport,
  ITEM_SALES: itemSalesReport,
  CATEGORY_SALES: categorySalesReport,
  PAYMENTS: paymentsReport,
  TAX: taxReport,
  DISCOUNTS: discountsReport,
  STAFF_SALES: staffSalesReport,
  KOT: kotReport,
  CANCELLED_ORDERS: cancelledOrdersReport,
  CANCELLED_BILLS: cancelledBillsReport,
  INVENTORY: inventoryReport,
  PURCHASES: purchasesReport,
  SUPPLIERS: suppliersReport,
  EXPENSES: expensesReport,
  DAY_CLOSINGS: dayClosingsReport
}

export interface ReportFile {
  filename: string
  content: string
}

export interface ReportPage {
  /** Name to suggest when saving, without an extension. */
  stem: string
  html: string
}

/** Works out the reports from the live tables. Read-only: it never changes anything. */
export class ReportService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock
  ) {}

  /** Notes in the audit trail that a report left the app, as a file or on paper. */
  recordExport(auth: AuthContext, filter: ReportFilterData, how: 'csv' | 'pdf' | 'print'): void {
    this.audit.record({
      action: 'report.exported',
      userId: auth.userId,
      username: auth.username,
      entityType: 'report',
      entityId: filter.kind,
      details: { how, from: filter.from, to: filter.to }
    })
  }

  run(input: ReportFilterData): ReportResult {
    const meta = REPORTS[input.kind]
    const filter = this.narrow(input)
    const ctx: ReportContext = {
      db: this.db,
      filter,
      from: startOfLocalDay(filter.from),
      to: endOfLocalDay(filter.to),
      users: this.userNames()
    }
    const body = BUILDERS[filter.kind](ctx)

    const totalled = body.columns.filter((c) => c.total === true)
    const totals: Record<string, ReportCell> | null =
      totalled.length > 0 && body.rows.length > 0
        ? Object.fromEntries(
            totalled.map((c) => [
              c.key,
              body.rows.reduce((acc, row) => {
                const value = row[c.key]
                return acc + (typeof value === 'number' ? value : 0)
              }, 0)
            ])
          )
        : null

    return {
      kind: filter.kind,
      title: meta.label,
      from: filter.from,
      to: filter.to,
      generatedAt: new Date(this.clock()).toISOString(),
      filters: this.describeFilters(filter),
      summary: body.summary,
      columns: body.columns,
      rows: body.rows.slice(0, MAX_REPORT_ROWS),
      totals,
      truncated: body.rows.length > MAX_REPORT_ROWS
    }
  }

  exportCsv(filter: ReportFilterData): ReportFile {
    const result = this.run(filter)
    return { filename: `${reportFileStem(filter)}.csv`, content: reportToCsv(result) }
  }

  renderPage(filter: ReportFilterData): ReportPage {
    const result = this.run(filter)
    return { stem: reportFileStem(filter), html: reportToHtml(result, this.restaurantName()) }
  }

  options(): ReportOptions {
    const named = (rows: { id: string; name: string }[]): ReportOption[] =>
      rows.map((r) => ({ id: r.id, name: r.name }))
    return {
      staff: this.db
        .select({ id: users.id, name: users.fullName })
        .from(users)
        .where(isNull(users.deletedAt))
        .orderBy(asc(users.fullName))
        .all(),
      categories: named(
        this.db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(isNull(categories.deletedAt))
          .orderBy(asc(categories.name))
          .all()
      ),
      expenseCategories: named(
        this.db
          .select({ id: expenseCategories.id, name: expenseCategories.name })
          .from(expenseCategories)
          .where(isNull(expenseCategories.deletedAt))
          .orderBy(asc(expenseCategories.name))
          .all()
      ),
      suppliers: named(
        this.db
          .select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(isNull(suppliers.deletedAt))
          .orderBy(asc(suppliers.name))
          .all()
      )
    }
  }

  /** Keeps only the filters a report understands and rejects values it does not offer. */
  private narrow(input: ReportFilterData): ReportFilterData {
    const meta = REPORTS[input.kind]
    const uses = (key: (typeof meta.filters)[number]): boolean => meta.filters.includes(key)
    const filter: ReportFilterData = { kind: input.kind, from: input.from, to: input.to }
    if (uses('search') && input.search) filter.search = input.search
    if (uses('orderType') && input.orderType) filter.orderType = input.orderType
    if (uses('categoryId') && input.categoryId) filter.categoryId = input.categoryId
    if (uses('expenseCategoryId') && input.expenseCategoryId) {
      filter.expenseCategoryId = input.expenseCategoryId
    }
    if (uses('staffId') && input.staffId) filter.staffId = input.staffId
    if (uses('supplierId') && input.supplierId) filter.supplierId = input.supplierId
    if (uses('method') && input.method) {
      const allowed: readonly string[] =
        input.kind === 'EXPENSES' ? EXPENSE_PAYMENT_METHODS : PAYMENT_METHODS
      if (!allowed.includes(input.method)) {
        throw new AppError('VALIDATION_ERROR', 'Choose a payment method from the list.')
      }
      filter.method = input.method
    }
    if (uses('status') && input.status) {
      if (!meta.statuses?.some((s) => s.value === input.status)) {
        throw new AppError('VALIDATION_ERROR', 'Choose a status from the list.')
      }
      filter.status = input.status
    }
    return filter
  }

  private describeFilters(filter: ReportFilterData): string[] {
    const meta = REPORTS[filter.kind]
    const lines: string[] = []
    if (filter.search) lines.push(`Search: "${filter.search}"`)
    if (filter.orderType) lines.push(`Order type: ${ORDER_TYPE_LABELS[filter.orderType]}`)
    if (filter.method) {
      const label =
        filter.kind === 'EXPENSES'
          ? EXPENSE_PAYMENT_LABELS[
              EXPENSE_PAYMENT_METHODS.find((m) => m === filter.method) ?? 'OTHER'
            ]
          : PAYMENT_METHOD_LABELS[PAYMENT_METHODS.find((m) => m === filter.method) ?? 'OTHER']
      lines.push(`Method: ${label}`)
    }
    const options =
      filter.categoryId ?? filter.expenseCategoryId ?? filter.staffId ?? filter.supplierId
    if (options) {
      const all = this.options()
      const find = (list: ReportOption[], id: string | undefined): string | null =>
        id ? (list.find((o) => o.id === id)?.name ?? 'Unknown') : null
      const category = find(all.categories, filter.categoryId)
      if (category) lines.push(`Category: ${category}`)
      const expenseCategory = find(all.expenseCategories, filter.expenseCategoryId)
      if (expenseCategory) lines.push(`Category: ${expenseCategory}`)
      const staff = find(all.staff, filter.staffId)
      if (staff) lines.push(`Team member: ${staff}`)
      const supplier = find(all.suppliers, filter.supplierId)
      if (supplier) lines.push(`Supplier: ${supplier}`)
    }
    if (filter.status) {
      lines.push(
        `Status: ${meta.statuses?.find((s) => s.value === filter.status)?.label ?? filter.status}`
      )
    }
    return lines
  }

  private userNames(): Map<string, string> {
    return new Map(
      this.db
        .select({ id: users.id, name: users.fullName })
        .from(users)
        .all()
        .map((u) => [u.id, u.name])
    )
  }

  private restaurantName(): string {
    const [row] = this.db.select({ name: restaurants.name }).from(restaurants).limit(1).all()
    return row?.name ?? 'Restaurant'
  }
}
