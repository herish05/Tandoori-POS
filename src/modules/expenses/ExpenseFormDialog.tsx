import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  EXPENSE_PAYMENT_LABELS,
  EXPENSE_PAYMENT_METHODS,
  createExpenseInputSchema,
  updateExpenseInputSchema,
  type Expense,
  type ExpenseCategory,
  type ExpensePaymentMethod
} from '@shared/expenses'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { paiseToInput, parseRupees } from '@/lib/money'
import { expenseService } from '@/services/expenses.service'
import { toDateTimeInput, useRefreshExpenses } from './hooks'

interface ExpenseFormDialogProps {
  open: boolean
  /** The expense being corrected; null records a new one. */
  expense: Expense | null
  /** Every category; deactivated ones are offered only to an expense already filed there. */
  categories: ExpenseCategory[]
  onClose: () => void
}

/** Record an expense, or correct one that has not been voided. */
export function ExpenseFormDialog({ open, expense, categories, onClose }: ExpenseFormDialogProps) {
  return (
    <Dialog
      open={open}
      title={expense ? `Edit ${expense.expenseNumber}` : 'New expense'}
      description="Money spent that is not a stock purchase. Cash expenses come out of the cash drawer."
      onClose={onClose}
    >
      <ExpenseForm
        key={expense?.id ?? 'new'}
        expense={expense}
        categories={categories}
        onClose={onClose}
      />
    </Dialog>
  )
}

function ExpenseForm({ expense, categories, onClose }: Omit<ExpenseFormDialogProps, 'open'>) {
  const refresh = useRefreshExpenses()
  const choices = categories.filter(
    (category) => category.isActive || category.id === expense?.categoryId
  )
  const [values, setValues] = useState({
    categoryId: expense?.categoryId ?? choices[0]?.id ?? '',
    amount: expense ? paiseToInput(expense.amount) : '',
    method: expense?.method ?? 'CASH',
    payee: expense?.payee ?? '',
    reference: expense?.reference ?? '',
    notes: expense?.notes ?? '',
    spentAt: toDateTimeInput(expense ? new Date(expense.spentAt) : new Date())
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const done = async (): Promise<void> => {
    await refresh()
    onClose()
  }
  const create = useMutation({ mutationFn: expenseService.create, onSuccess: done })
  const update = useMutation({ mutationFn: expenseService.update, onSuccess: done })
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  const text =
    (key: keyof typeof values) =>
    (event: { target: { value: string } }): void => {
      setValues((current) => ({ ...current, [key]: event.target.value }))
    }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const paise = parseRupees(values.amount)
    if (Number.isNaN(paise)) {
      setErrors({ amount: 'Enter an amount in rupees.' })
      return
    }
    const spent = new Date(values.spentAt)
    if (Number.isNaN(spent.getTime())) {
      setErrors({ spentAt: 'Choose when it was spent.' })
      return
    }
    const input = {
      categoryId: values.categoryId,
      amount: paise,
      method: values.method,
      payee: values.payee,
      reference: values.reference,
      notes: values.notes,
      spentAt: spent.toISOString()
    }
    const parsed = expense
      ? updateExpenseInputSchema.safeParse({ id: expense.id, ...input })
      : createExpenseInputSchema.safeParse(input)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    if (expense) {
      update.mutate({ id: expense.id, ...parsed.data })
    } else {
      create.mutate(parsed.data)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {choices.length === 0 && (
        <p role="alert" className="text-sm font-medium text-warning">
          There is no active expense category. Add one first.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" required error={errors.categoryId}>
          {(c) => (
            <Select {...c} value={values.categoryId} onChange={text('categoryId')}>
              {choices.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Amount (₹)" required error={errors.amount}>
          {(c) => (
            <Input
              {...c}
              autoFocus
              inputMode="decimal"
              value={values.amount}
              onChange={text('amount')}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid by" required error={errors.method}>
          {(c) => (
            <Select
              {...c}
              value={values.method}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  method: event.target.value as ExpensePaymentMethod
                }))
              }}
            >
              {EXPENSE_PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {EXPENSE_PAYMENT_LABELS[method]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Spent on" required error={errors.spentAt}>
          {(c) => (
            <Input {...c} type="datetime-local" value={values.spentAt} onChange={text('spentAt')} />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid to" error={errors.payee}>
          {(c) => <Input {...c} value={values.payee} onChange={text('payee')} />}
        </Field>
        <Field label="Reference (bill, UTR, cheque no.)" error={errors.reference}>
          {(c) => <Input {...c} value={values.reference} onChange={text('reference')} />}
        </Field>
      </div>
      <Field label="Notes" error={errors.notes}>
        {(c) => <Textarea {...c} rows={2} value={values.notes} onChange={text('notes')} />}
      </Field>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || choices.length === 0}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {expense ? 'Save changes' : 'Record expense'}
        </Button>
      </div>
    </form>
  )
}
