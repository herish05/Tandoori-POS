import { ORDER_TYPE_LABELS, ORDER_TYPES } from '@shared/orders'
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@shared/billing'
import { EXPENSE_PAYMENT_LABELS, EXPENSE_PAYMENT_METHODS } from '@shared/expenses'
import {
  REPORTS,
  type ReportFilterKey,
  type ReportOption,
  type ReportOptions
} from '@shared/reports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { ReportDraft } from './draft'

interface Props {
  draft: ReportDraft
  options: ReportOptions | undefined
  busy: boolean
  onChange: (draft: ReportDraft) => void
  onRun: () => void
}

function Choice({
  label,
  value,
  any,
  choices,
  onChange
}: {
  label: string
  value: string
  any: string
  choices: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block space-y-1 text-xs font-medium">
      {label}
      <Select
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      >
        <option value="">{any}</option>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </Select>
    </label>
  )
}

const fromOptions = (list: ReportOption[] | undefined) =>
  (list ?? []).map((o) => ({ value: o.id, label: o.name }))

/** Dates plus the filters the chosen report understands. Nothing runs until "Show report". */
export function ReportFilters({ draft, options, busy, onChange, onRun }: Props) {
  const meta = REPORTS[draft.kind]
  const uses = (key: ReportFilterKey): boolean => meta.filters.includes(key)
  const set = (patch: Partial<ReportDraft>) => {
    onChange({ ...draft, ...patch })
  }
  const methods =
    draft.kind === 'EXPENSES'
      ? EXPENSE_PAYMENT_METHODS.map((m) => ({ value: m, label: EXPENSE_PAYMENT_LABELS[m] }))
      : PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))

  return (
    <form
      className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Report filters"
      onSubmit={(event) => {
        event.preventDefault()
        onRun()
      }}
    >
      <label className="block space-y-1 text-xs font-medium">
        From
        <Input
          type="date"
          value={draft.from}
          required
          onChange={(event) => {
            set({ from: event.target.value })
          }}
        />
      </label>
      <label className="block space-y-1 text-xs font-medium">
        To
        <Input
          type="date"
          value={draft.to}
          required
          onChange={(event) => {
            set({ to: event.target.value })
          }}
        />
      </label>
      {uses('search') && (
        <label className="block space-y-1 text-xs font-medium">
          Search
          <Input
            type="search"
            value={draft.search}
            maxLength={80}
            placeholder={meta.searchHint ?? ''}
            onChange={(event) => {
              set({ search: event.target.value })
            }}
          />
        </label>
      )}
      {uses('orderType') && (
        <Choice
          label="Order type"
          any="All types"
          value={draft.orderType}
          choices={ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABELS[t] }))}
          onChange={(orderType) => {
            set({ orderType })
          }}
        />
      )}
      {uses('method') && (
        <Choice
          label="Payment method"
          any="All methods"
          value={draft.method}
          choices={methods}
          onChange={(method) => {
            set({ method })
          }}
        />
      )}
      {uses('categoryId') && (
        <Choice
          label="Category"
          any="All categories"
          value={draft.categoryId}
          choices={fromOptions(options?.categories)}
          onChange={(categoryId) => {
            set({ categoryId })
          }}
        />
      )}
      {uses('expenseCategoryId') && (
        <Choice
          label="Expense category"
          any="All categories"
          value={draft.expenseCategoryId}
          choices={fromOptions(options?.expenseCategories)}
          onChange={(expenseCategoryId) => {
            set({ expenseCategoryId })
          }}
        />
      )}
      {uses('staffId') && (
        <Choice
          label="Staff"
          any="Everyone"
          value={draft.staffId}
          choices={fromOptions(options?.staff)}
          onChange={(staffId) => {
            set({ staffId })
          }}
        />
      )}
      {uses('supplierId') && (
        <Choice
          label="Supplier"
          any="All suppliers"
          value={draft.supplierId}
          choices={fromOptions(options?.suppliers)}
          onChange={(supplierId) => {
            set({ supplierId })
          }}
        />
      )}
      {uses('status') && meta.statuses && (
        <Choice
          label="Status"
          any={draft.kind === 'PURCHASES' ? 'Received (default)' : 'Any status'}
          value={draft.status}
          choices={[...meta.statuses]}
          onChange={(status) => {
            set({ status })
          }}
        />
      )}
      <div className="flex items-end">
        <Button type="submit" disabled={busy}>
          Show report
        </Button>
      </div>
    </form>
  )
}
