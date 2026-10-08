import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  CASH_ENTRY_DIRECTION,
  MANUAL_CASH_ENTRY_KINDS,
  CASH_ENTRY_LABELS,
  recordCashEntryInputSchema,
  type CashEntryKind
} from '@shared/cash'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { parseRupees } from '@/lib/money'
import { cashService } from '@/services/expenses.service'
import { toDateTimeInput, useRefreshExpenses } from './hooks'

interface CashEntryDialogProps {
  open: boolean
  onClose: () => void
}

/** Record cash put into or taken out of the drawer by hand. */
export function CashEntryDialog({ open, onClose }: CashEntryDialogProps) {
  return (
    <Dialog
      open={open}
      title="Record drawer entry"
      description="Opening float, cash added, bank deposits and withdrawals. Sales, refunds and cash expenses are counted automatically."
      onClose={onClose}
    >
      <CashEntryForm onClose={onClose} />
    </Dialog>
  )
}

function CashEntryForm({ onClose }: Pick<CashEntryDialogProps, 'onClose'>) {
  const refresh = useRefreshExpenses()
  const [values, setValues] = useState({
    kind: 'OPENING_FLOAT' as CashEntryKind,
    amount: '',
    notes: '',
    occurredAt: toDateTimeInput(new Date())
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const record = useMutation({
    mutationFn: cashService.recordEntry,
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const paise = parseRupees(values.amount)
    if (Number.isNaN(paise)) {
      setErrors({ amount: 'Enter an amount in rupees.' })
      return
    }
    const when = new Date(values.occurredAt)
    if (Number.isNaN(when.getTime())) {
      setErrors({ occurredAt: 'Choose when it happened.' })
      return
    }
    const parsed = recordCashEntryInputSchema.safeParse({
      kind: values.kind,
      amount: paise,
      notes: values.notes,
      occurredAt: when.toISOString()
    })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    record.mutate(parsed.data)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="What happened" required error={errors.kind}>
          {(c) => (
            <Select
              {...c}
              value={values.kind}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  kind: event.target.value as CashEntryKind
                }))
              }}
            >
              {MANUAL_CASH_ENTRY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {CASH_ENTRY_LABELS[kind]} ({CASH_ENTRY_DIRECTION[kind] === 'IN' ? 'in' : 'out'})
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
              onChange={(event) => {
                setValues((current) => ({ ...current, amount: event.target.value }))
              }}
            />
          )}
        </Field>
      </div>
      <Field label="When" required error={errors.occurredAt}>
        {(c) => (
          <Input
            {...c}
            type="datetime-local"
            value={values.occurredAt}
            onChange={(event) => {
              setValues((current) => ({ ...current, occurredAt: event.target.value }))
            }}
          />
        )}
      </Field>
      <Field label="Notes" error={errors.notes}>
        {(c) => (
          <Input
            {...c}
            value={values.notes}
            onChange={(event) => {
              setValues((current) => ({ ...current, notes: event.target.value }))
            }}
          />
        )}
      </Field>
      {record.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(record.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={record.isPending}>
          {record.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Record entry
        </Button>
      </div>
    </form>
  )
}
