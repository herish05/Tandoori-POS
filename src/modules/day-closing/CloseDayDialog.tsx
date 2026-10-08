import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  CASH_DENOMINATIONS,
  closeDayInputSchema,
  type CashCount,
  type DayStatus
} from '@shared/day-closing'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney, parseRupees } from '@/lib/money'
import { formatDay } from '@/modules/expenses/hooks'
import { dayClosingService } from '@/services/day-closing.service'
import { useRefreshDay } from './hooks'

interface CloseDayDialogProps {
  open: boolean
  status: DayStatus
  onClose: () => void
}

/** Count the drawer, compare with the book, and close the day. */
export function CloseDayDialog({ open, status, onClose }: CloseDayDialogProps) {
  return (
    <Dialog
      open={open}
      title={`Close ${formatDay(status.date)}`}
      description="Count the cash in the drawer. Once closed, nothing can be recorded for this day until a manager reopens it."
      onClose={onClose}
      className="max-w-2xl"
    >
      <CloseDayForm status={status} onClose={onClose} />
    </Dialog>
  )
}

function CloseDayForm({ status, onClose }: Omit<CloseDayDialogProps, 'open'>) {
  const refresh = useRefreshDay()
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [typedTotal, setTypedTotal] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const close = useMutation({
    mutationFn: dayClosingService.close,
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const denominations: CashCount[] = []
  let countsValid = true
  for (const value of CASH_DENOMINATIONS) {
    const text = (counts[value] ?? '').trim()
    if (text === '') continue
    const count = Number(text)
    if (!Number.isInteger(count) || count < 0) {
      countsValid = false
    } else if (count > 0) {
      denominations.push({ value, count })
    }
  }
  const countedFromGrid = denominations.reduce((sum, row) => sum + row.value * row.count, 0)
  const typing = typedTotal.trim() !== ''
  const counted = typing ? parseRupees(typedTotal) : countedFromGrid
  const countedKnown = countsValid && !Number.isNaN(counted)
  const expected = status.summary.cash.expected
  const variance = countedKnown ? counted - expected : 0

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    if (!countsValid) {
      setErrors({ counts: 'Counts must be whole numbers.' })
      return
    }
    if (Number.isNaN(counted)) {
      setErrors({ countedCash: 'Enter the cash counted in rupees.' })
      return
    }
    const parsed = closeDayInputSchema.safeParse({
      date: status.date,
      countedCash: counted,
      ...(typing || denominations.length === 0 ? {} : { denominations }),
      notes
    })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    if (parsed.data.countedCash !== expected && (parsed.data.notes ?? '') === '') {
      setErrors({ notes: 'Explain the difference between the count and the book.' })
      return
    }
    setErrors({})
    close.mutate(parsed.data)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {CASH_DENOMINATIONS.map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <span className="w-14 shrink-0 text-right font-medium">{formatMoney(value)}</span>
            <span aria-hidden>×</span>
            <Input
              inputMode="numeric"
              aria-label={`Number of ${formatMoney(value)} notes or coins`}
              value={counts[value] ?? ''}
              disabled={typing}
              onChange={(event) => {
                setCounts((current) => ({ ...current, [value]: event.target.value }))
              }}
            />
          </label>
        ))}
      </div>
      {errors.counts && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errors.counts}
        </p>
      )}
      <Field
        label="Or type the total counted (₹)"
        error={errors.countedCash}
        hint="Use this instead of counting by note."
      >
        {(c) => (
          <Input
            {...c}
            inputMode="decimal"
            value={typedTotal}
            onChange={(event) => {
              setTypedTotal(event.target.value)
            }}
          />
        )}
      </Field>

      <dl className="grid grid-cols-3 gap-3 rounded-lg border bg-secondary/30 p-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Book says</dt>
          <dd className="text-lg font-bold">{formatMoney(expected)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Counted</dt>
          <dd className="text-lg font-bold" data-testid="counted-cash">
            {countedKnown ? formatMoney(counted) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Difference</dt>
          <dd
            className={`text-lg font-bold ${variance === 0 ? '' : 'text-destructive'}`}
            data-testid="variance"
          >
            {countedKnown ? (variance > 0 ? '+' : '') + formatMoney(variance) : '—'}
          </dd>
        </div>
      </dl>

      <Field
        label="Notes"
        required={variance !== 0}
        error={errors.notes}
        hint={variance === 0 ? undefined : 'The difference is recorded as a drawer entry.'}
      >
        {(c) => (
          <Input
            {...c}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value)
            }}
          />
        )}
      </Field>
      {close.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(close.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={close.isPending}>
          {close.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Close day
        </Button>
      </div>
    </form>
  )
}
