import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  payBillInputSchema,
  type PaymentMethod
} from '@shared/billing'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { NumPad } from '@/components/NumPad'
import { fieldErrors } from '@/lib/form'
import { formatMoney, paiseToInput, parseOptionalRupees, parseRupees } from '@/lib/money'
import { applyPadKey, type PadKey } from '@/lib/numpad'
import { cn } from '@/lib/utils'

interface PaymentRow {
  key: number
  method: PaymentMethod
  amount: string
  /** Cash handed over, when it is more than the amount. */
  received: string
  reference: string
}

interface PaymentDialogProps {
  open: boolean
  billNumber: string
  /** What is still to collect, in paise. */
  balance: number
  pending: boolean
  error: string | undefined
  onPay: (
    payments: { method: PaymentMethod; amount: number; tendered?: number; reference?: string }[]
  ) => void
  onClose: () => void
}

const MAX_ROWS = 4

/** Notes the guest is likely to hand over, in rupees. */
const CASH_NOTES = [100, 200, 500, 2000] as const

interface ActiveField {
  key: number
  field: 'amount' | 'received'
}

/** Takes payment against a bill: one method, or a split across several. */
export function PaymentDialog({ open, billNumber, balance, ...rest }: PaymentDialogProps) {
  return (
    <Dialog
      open={open}
      title={`Take payment: ${billNumber}`}
      description={`Balance to collect: ${formatMoney(balance)}`}
      onClose={rest.onClose}
      className="max-w-3xl"
    >
      <PaymentForm balance={balance} {...rest} />
    </Dialog>
  )
}

function PaymentForm({
  balance,
  pending,
  error,
  onPay,
  onClose
}: Omit<PaymentDialogProps, 'open' | 'billNumber'>) {
  const [rows, setRows] = useState<PaymentRow[]>([
    { key: 1, method: 'CASH', amount: paiseToInput(balance), received: '', reference: '' }
  ])
  const [nextKey, setNextKey] = useState(2)
  const [active, setActive] = useState<ActiveField>({ key: 1, field: 'received' })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const amounts = rows.map((row) => parseOptionalRupees(row.amount))
  const entered = amounts.reduce((sum, value) => sum + (Number.isNaN(value) ? 0 : value), 0)
  const remaining = balance - entered
  const change = rows.reduce((sum, row, index) => {
    const received = row.method === 'CASH' ? parseOptionalRupees(row.received) : 0
    const amount = amounts[index] ?? 0
    return received > amount && !Number.isNaN(amount) ? sum + (received - amount) : sum
  }, 0)

  // The number pad types into the field last touched; a removed or non-cash row falls back safely.
  const activeRow = rows.find((row) => row.key === active.key) ?? rows[0]
  const activeField: ActiveField['field'] = activeRow?.method === 'CASH' ? active.field : 'amount'
  const activeAmount = activeRow ? parseOptionalRupees(activeRow.amount) : 0

  const pressKey = (key: PadKey): void => {
    if (!activeRow) return
    update(activeRow.key, {
      [activeField]: applyPadKey(activeRow[activeField], key)
    })
  }

  const update = (key: number, patch: Partial<PaymentRow>): void => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const addRow = (): void => {
    const used = new Set(rows.map((row) => row.method))
    const method = PAYMENT_METHODS.find((entry) => !used.has(entry)) ?? 'UPI'
    setRows((current) => [
      ...current,
      {
        key: nextKey,
        method,
        amount: remaining > 0 ? paiseToInput(remaining) : '',
        received: '',
        reference: ''
      }
    ])
    setNextKey(nextKey + 1)
  }

  const submit = (): void => {
    const lines = rows.map((row, index) => {
      const received = row.received.trim() === '' ? null : parseRupees(row.received)
      const amount = amounts[index] ?? Number.NaN
      return {
        method: row.method,
        amount: Number.isNaN(amount) ? undefined : amount,
        tendered:
          row.method === 'CASH' &&
          received !== null &&
          !Number.isNaN(received) &&
          received !== amount
            ? received
            : null,
        reference: row.reference
      }
    })
    const parsed = payBillInputSchema.safeParse({ billId: crypto.randomUUID(), payments: lines })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    if (entered > balance) {
      setErrors({ total: `That is ${formatMoney(entered - balance)} more than the balance.` })
      return
    }
    setErrors({})
    onPay(
      parsed.data.payments.map((line) => ({
        method: line.method,
        amount: line.amount,
        ...(line.tendered != null ? { tendered: line.tendered } : {}),
        ...(line.reference ? { reference: line.reference } : {})
      }))
    )
  }

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_17rem]">
      <div className="space-y-4">
        {rows.map((row, index) => {
          const prefix = `payments.${String(index)}`
          return (
            <div
              key={row.key}
              className="space-y-3 rounded-md border p-3"
              data-testid="payment-row"
            >
              <div className="grid grid-cols-[9rem_1fr_auto] items-end gap-3">
                <Field label="Method">
                  {(control) => (
                    <Select
                      {...control}
                      value={row.method}
                      onChange={(event) => {
                        const next = PAYMENT_METHODS.find((entry) => entry === event.target.value)
                        update(row.key, { method: next ?? 'CASH', received: '' })
                        setActive({ key: row.key, field: next === 'CASH' ? 'received' : 'amount' })
                      }}
                    >
                      {PAYMENT_METHODS.map((entry) => (
                        <option key={entry} value={entry}>
                          {PAYMENT_METHOD_LABELS[entry]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Amount (₹)" error={errors[`${prefix}.amount`]}>
                  {(control) => (
                    <Input
                      {...control}
                      inputMode="none"
                      className={cn(
                        activeRow?.key === row.key && activeField === 'amount' && 'ring-2 ring-ring'
                      )}
                      value={row.amount}
                      onFocus={() => {
                        setActive({ key: row.key, field: 'amount' })
                      }}
                      onChange={(event) => {
                        update(row.key, { amount: event.target.value })
                      }}
                    />
                  )}
                </Field>
                {rows.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove this payment"
                    onClick={() => {
                      setRows((current) => current.filter((entry) => entry.key !== row.key))
                    }}
                  >
                    <Trash2 />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
              {row.method === 'CASH' && (
                <Field
                  label="Cash received (₹)"
                  hint="Only if the guest handed over more than the amount."
                  error={errors[`${prefix}.tendered`]}
                >
                  {(control) => (
                    <Input
                      {...control}
                      inputMode="none"
                      className={cn(
                        activeRow?.key === row.key &&
                          activeField === 'received' &&
                          'ring-2 ring-ring'
                      )}
                      value={row.received}
                      onFocus={() => {
                        setActive({ key: row.key, field: 'received' })
                      }}
                      onChange={(event) => {
                        update(row.key, { received: event.target.value })
                      }}
                    />
                  )}
                </Field>
              )}
              {row.method !== 'CASH' && (
                <Field
                  label={row.method === 'OTHER' ? 'Paid how (required)' : 'Reference (optional)'}
                  error={errors[`${prefix}.reference`]}
                >
                  {(control) => (
                    <Input
                      {...control}
                      maxLength={60}
                      value={row.reference}
                      placeholder={
                        row.method === 'UPI'
                          ? 'UPI transaction id'
                          : row.method === 'CARD'
                            ? 'Last 4 digits'
                            : 'Voucher, wallet…'
                      }
                      onChange={(event) => {
                        update(row.key, { reference: event.target.value })
                      }}
                    />
                  )}
                </Field>
              )}
            </div>
          )
        })}

        {rows.length < MAX_ROWS && (
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus /> Split with another method
          </Button>
        )}

        <dl className="space-y-1 rounded-md bg-secondary/50 p-3 text-sm">
          <div className="flex justify-between">
            <dt>Entered</dt>
            <dd className="font-semibold">{formatMoney(entered)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Still to collect</dt>
            <dd className="font-semibold" data-testid="payment-remaining">
              {formatMoney(Math.max(remaining, 0))}
            </dd>
          </div>
          {change > 0 && (
            <div className="flex justify-between text-base">
              <dt className="font-semibold">Give back to the guest</dt>
              <dd className="font-bold" data-testid="payment-change">
                {formatMoney(change)}
              </dd>
            </div>
          )}
        </dl>

        {(errors.total ?? errors.payments) && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errors.total ?? errors.payments}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || entered === 0} onClick={submit}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {remaining > 0 ? 'Record part payment' : 'Take payment'}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">
          {activeField === 'received' ? 'Cash received' : 'Amount'}
          {rows.length > 1
            ? ` (payment ${String(rows.findIndex((row) => row.key === activeRow?.key) + 1)})`
            : ''}
        </p>
        <NumPad onKey={pressKey} />
        {activeRow?.method === 'CASH' && (
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Cash received">
            <Button
              variant="secondary"
              className="col-span-2"
              onClick={() => {
                update(activeRow.key, { received: '' })
                setActive({ key: activeRow.key, field: 'received' })
              }}
            >
              Exact amount
            </Button>
            {CASH_NOTES.map((note) => (
              <Button
                key={note}
                variant="outline"
                disabled={Number.isNaN(activeAmount) || note * 100 < activeAmount}
                onClick={() => {
                  update(activeRow.key, { received: String(note) })
                  setActive({ key: activeRow.key, field: 'received' })
                }}
              >
                ₹{note}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
