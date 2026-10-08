import { ORDER_TYPES } from '@shared/orders'
import {
  REPORTS,
  type ReportFilterInput,
  type ReportFilterKey,
  type ReportKind
} from '@shared/reports'
import { currentMonth } from '@/modules/expenses/hooks'

/** What the filter bar holds while a report is being chosen. An empty string means "any". */
export interface ReportDraft {
  kind: ReportKind
  from: string
  to: string
  search: string
  orderType: string
  method: string
  categoryId: string
  expenseCategoryId: string
  staffId: string
  supplierId: string
  status: string
}

export const REPORT_KEYS = {
  options: ['reports', 'options'],
  run: (filter: unknown) => ['reports', 'run', filter]
} as const

export function initialDraft(kind: ReportKind = 'SALES'): ReportDraft {
  return {
    kind,
    ...currentMonth(),
    search: '',
    orderType: '',
    method: '',
    categoryId: '',
    expenseCategoryId: '',
    staffId: '',
    supplierId: '',
    status: ''
  }
}

/** Changing report keeps the dates but drops filters the new report does not have. */
export function switchKind(draft: ReportDraft, kind: ReportKind): ReportDraft {
  return { ...initialDraft(kind), from: draft.from, to: draft.to }
}

/** The request for a draft: only the filters the report understands, and only those that are set. */
export function toFilter(draft: ReportDraft): ReportFilterInput {
  const uses = (key: ReportFilterKey): boolean => REPORTS[draft.kind].filters.includes(key)
  const text = (key: ReportFilterKey, value: string) =>
    uses(key) && value.trim() !== '' ? value.trim() : null
  const search = text('search', draft.search)
  const method = text('method', draft.method)
  const categoryId = text('categoryId', draft.categoryId)
  const expenseCategoryId = text('expenseCategoryId', draft.expenseCategoryId)
  const staffId = text('staffId', draft.staffId)
  const supplierId = text('supplierId', draft.supplierId)
  const status = text('status', draft.status)
  const orderType = uses('orderType') ? ORDER_TYPES.find((t) => t === draft.orderType) : undefined
  return {
    kind: draft.kind,
    from: draft.from,
    to: draft.to,
    ...(search ? { search } : {}),
    ...(orderType ? { orderType } : {}),
    ...(method ? { method } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(expenseCategoryId ? { expenseCategoryId } : {}),
    ...(staffId ? { staffId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(status ? { status } : {})
  }
}
