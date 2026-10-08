import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus, Tags } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { CategoriesPanel } from '@/modules/expenses/CategoriesPanel'
import { ExpenseFormDialog } from '@/modules/expenses/ExpenseFormDialog'
import { EXPENSE_KEYS, currentMonth, formatDay, useRefreshExpenses } from '@/modules/expenses/hooks'
import { useDebouncedValue } from '@/modules/menu/hooks'
import { ReasonDialog } from '@/modules/purchasing/ReasonDialog'
import { expenseCategoryService, expenseService } from '@/services/expenses.service'
import { usePermission } from '@/stores/auth.store'
import {
  EXPENSE_PAYMENT_LABELS,
  EXPENSE_PAYMENT_METHODS,
  type Expense,
  type ExpensePaymentMethod
} from '@shared/expenses'

/** Admin: money spent besides stock, by category and how it was paid. */
export function ExpensesPage() {
  const canOperate = usePermission('expenses.operate')
  const canManage = usePermission('expenses.manage')
  const refresh = useRefreshExpenses()
  const month = currentMonth()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim())
  const [categoryId, setCategoryId] = useState('')
  const [method, setMethod] = useState<ExpensePaymentMethod | ''>('')
  const [from, setFrom] = useState(month.from)
  const [to, setTo] = useState(month.to)
  const [showVoided, setShowVoided] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [form, setForm] = useState<'closed' | 'new' | Expense>('closed')
  const [voiding, setVoiding] = useState<Expense | null>(null)

  const rangeValid = from !== '' && to !== '' && from <= to
  const range = { from, to }
  const filter = {
    ...range,
    ...(debounced ? { search: debounced } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(method ? { method } : {}),
    ...(showVoided ? { includeVoided: true } : {})
  }
  const categories = useQuery({
    queryKey: EXPENSE_KEYS.categories(true),
    queryFn: () => expenseCategoryService.list({ includeInactive: true }),
    staleTime: 0
  })
  const summary = useQuery({
    queryKey: EXPENSE_KEYS.summary(range),
    queryFn: () => expenseService.summary(range),
    enabled: rangeValid,
    staleTime: 0
  })
  const expenses = useQuery({
    queryKey: EXPENSE_KEYS.list(filter),
    queryFn: () => expenseService.list(filter),
    enabled: rangeValid,
    staleTime: 0
  })
  const voidExpense = useMutation({
    mutationFn: expenseService.void,
    onSuccess: async () => {
      await refresh()
      setVoiding(null)
    }
  })

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Expenses</h2>
          <p className="text-sm text-muted-foreground">
            Rent, gas, salaries and other money spent besides stock. Cash expenses come out of the
            cash drawer.
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button
              variant="outline"
              onClick={() => {
                setShowCategories((current) => !current)
              }}
            >
              <Tags /> {showCategories ? 'Hide categories' : 'Categories'}
            </Button>
          )}
          {canOperate && (
            <Button
              onClick={() => {
                setForm('new')
              }}
            >
              <Plus /> Add expense
            </Button>
          )}
        </div>
      </div>

      {showCategories && canManage && <CategoriesPanel />}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1 text-xs font-medium">
          Search
          <Input
            className="w-56"
            placeholder="Number, payee or notes"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </label>
        <label className="block space-y-1 text-xs font-medium">
          Category
          <Select
            className="w-44"
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value)
            }}
          >
            <option value="">All categories</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-xs font-medium">
          Paid by
          <Select
            className="w-40"
            value={method}
            onChange={(event) => {
              setMethod(event.target.value as ExpensePaymentMethod | '')
            }}
          >
            <option value="">Any method</option>
            {EXPENSE_PAYMENT_METHODS.map((entry) => (
              <option key={entry} value={entry}>
                {EXPENSE_PAYMENT_LABELS[entry]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-xs font-medium">
          From
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value)
            }}
          />
        </label>
        <label className="block space-y-1 text-xs font-medium">
          To
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
            }}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(event) => {
              setShowVoided(event.target.checked)
            }}
          />
          Show voided
        </label>
      </div>
      {!rangeValid && (
        <p role="alert" className="text-sm font-medium text-destructive">
          Choose a start date that is on or before the end date.
        </p>
      )}

      {summary.isSuccess && (
        <div className="grid gap-3 md:grid-cols-3" data-testid="expense-summary">
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Spent, {formatDay(summary.data.from)} to {formatDay(summary.data.to)}
            </div>
            <div className="mt-1 text-xl font-bold">{formatMoney(summary.data.total)}</div>
            <div className="text-xs text-muted-foreground">
              {summary.data.count} expense{summary.data.count === 1 ? '' : 's'}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              By category
            </div>
            {summary.data.byCategory.length === 0 ? (
              <div className="mt-1 text-sm text-muted-foreground">Nothing spent.</div>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {summary.data.byCategory.map((row) => (
                  <li key={row.categoryId} className="flex justify-between gap-3">
                    <span>{row.name}</span>
                    <span className="font-medium">{formatMoney(row.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              By payment method
            </div>
            {summary.data.byMethod.length === 0 ? (
              <div className="mt-1 text-sm text-muted-foreground">Nothing spent.</div>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {summary.data.byMethod.map((row) => (
                  <li key={row.method} className="flex justify-between gap-3">
                    <span>{EXPENSE_PAYMENT_LABELS[row.method]}</span>
                    <span className="font-medium">{formatMoney(row.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {summary.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(summary.error)}
        </p>
      )}

      {rangeValid && expenses.isPending && <Skeleton className="h-64 w-full" />}
      {expenses.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(expenses.error)}
        </p>
      )}
      {rangeValid && expenses.isSuccess && expenses.data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {debounced || categoryId || method
            ? 'No expense matches.'
            : 'No expenses in this period.'}
        </div>
      )}
      {rangeValid && expenses.isSuccess && expenses.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" data-testid="expenses-table">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Spent</th>
                <th className="px-3 py-2">Expense</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Paid to</th>
                <th className="px-3 py-2">Paid by</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {expenses.data.map((expense) => (
                <tr
                  key={expense.id}
                  className={`hover:bg-accent/50 ${expense.voidedAt ? 'text-muted-foreground' : ''}`}
                >
                  <td className="px-3 py-2">{formatDateTime(expense.spentAt)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{expense.expenseNumber}</div>
                    {expense.recordedBy && (
                      <div className="text-xs text-muted-foreground">by {expense.recordedBy}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">{expense.categoryName}</td>
                  <td className="px-3 py-2">
                    <div>{expense.payee ?? ''}</div>
                    {(expense.reference ?? expense.notes) && (
                      <div className="text-xs text-muted-foreground">
                        {[expense.reference, expense.notes].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {expense.voidedAt && (
                      <div className="text-xs">
                        <Badge variant="destructive">Voided</Badge> {expense.voidReason}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{EXPENSE_PAYMENT_LABELS[expense.method]}</td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${expense.voidedAt ? 'line-through' : ''}`}
                  >
                    {formatMoney(expense.amount)}
                  </td>
                  <td className="px-3 py-2">
                    {canOperate && !expense.voidedAt && (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setForm(expense)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            voidExpense.reset()
                            setVoiding(expense)
                          }}
                        >
                          Void
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ExpenseFormDialog
        open={form !== 'closed'}
        expense={form === 'closed' || form === 'new' ? null : form}
        categories={categories.data ?? []}
        onClose={() => {
          setForm('closed')
        }}
      />
      <ReasonDialog
        open={voiding !== null}
        title="Void expense"
        description={`${voiding?.expenseNumber ?? 'This expense'} stays on record but no longer counts in totals or the cash drawer.`}
        confirmLabel="Void expense"
        pending={voidExpense.isPending}
        error={voidExpense.isError ? toUserMessage(voidExpense.error) : undefined}
        onConfirm={(reason) => {
          if (voiding) voidExpense.mutate({ id: voiding.id, reason })
        }}
        onClose={() => {
          setVoiding(null)
        }}
      />
    </div>
  )
}
