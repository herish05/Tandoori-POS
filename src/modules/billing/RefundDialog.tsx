import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import {
  PAYMENT_METHOD_LABELS,
  refundBillInputSchema,
  type BillDetail,
  type PaymentMethod
} from '@shared/billing'
import { NumPad } from '@/components/NumPad'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fieldErrors } from '@/lib/form'
import { formatMoney, paiseToInput, parseOptionalRupees } from '@/lib/money'
import { applyPadKey, type PadKey } from '@/lib/numpad'
import { cn } from '@/lib/utils'

interface RefundDialogProps {
  open: boolean
  bill: BillDetail
  pending: boolean
  error: string | undefined
  onRefund: (input: {
    reason: string
    lines: { method: PaymentMethod; amount: number; reference?: string }[]
  }) => void
  onClose: () => void
}

interface RefundRow {
  method: PaymentMethod
  /** The most that can still go back through this method, in paise. */
  max: number
  amount: string
  reference: string
}

/** Gives money back, method by method, never more than each method took. */
export function RefundDialog({ open, bill, ...rest }: RefundDialogProps) {
  return (
    <Dialog
      open={open}
      title={`Refund: ${bill.billNumber}`}
      description={`Paid ${formatMoney(bill.paidTotal)}${bill.refundedTotal > 0 ? `, already returned ${formatMoney(bill.refundedTotal)}` : ''}`}
      onClose={rest.onClose}
      className="max-w-3xl"
    >
      <RefundForm bill={bill} {...rest} />
    </Dialog>
  )
}

function RefundForm({ bill, pending, error, onRefund, onClose }: Omit<RefundDialogProps, 'open'>) {
  // A bill that was only part paid must go back in full; it is withdrawn when it does.
  const partPaid = bill.status === 'PARTIAL'
  const [rows, setRows] = useState<RefundRow[]>(
    bill.refundable.map((entry) => ({
      method: entry.method,
      max: entry.amount,
      amount: partPaid ? paiseToInput(entry.amount) : '',
      reference: ''
    }))
  )
  const [reason, setReason] = useState('')
  const [active, setActive] = useState<PaymentMethod | null>(rows[0]?.method ?? null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const amounts = rows.map((row) => parseOptionalRupees(row.amount))
  const total = amounts.reduce((sum, value) => sum + (Number.isNaN(value) ? 0 : value), 0)
  const activeRow = rows.find((row) => row.method === active)

  const update = (method: PaymentMethod, patch: Partial<RefundRow>): void => {
    setRows((current) => current.map((row) => (row.method === method ? { ...row, ...patch } : row)))
  }
  const pressKey = (key: PadKey): void => {
    if (activeRow) update(activeRow.method, { amount: applyPadKey(activeRow.amount, key) })
  }

  const submit = (): void => {
    const filled = rows
      .map((row, index) => ({ row, amount: amounts[index] ?? 0 }))
      .filter(({ row, amount }) => row.amount.trim() !== '' && amount !== 0)
    const found: Record<string, string> = {}
    for (const [index, { row, amount }] of filled.entries()) {
      if (!Number.isNaN(amount) && amount > row.max) {
        found[`lines.${String(index)}.amount`] =
          `Only ${formatMoney(row.max)} can be returned by ${PAYMENT_METHOD_LABELS[row.method]}.`
      }
    }
    const parsed = refundBillInputSchema.safeParse({
      billId: bill.id,
      reason,
      lines: filled.map(({ row, amount }) => ({
        method: row.method,
        amount: Number.isNaN(amount) ? undefined : amount,
        reference: row.reference
      }))
    })
    if (!parsed.success) Object.assign(found, fieldErrors(parsed.error), { ...found })
    if (!parsed.success || Object.keys(found).length > 0) {
      setErrors(found)
      return
    }
    setErrors({})
    onRefund({
      reason: parsed.data.reason,
      lines: parsed.data.lines.map((line) => ({
        method: line.method,
        amount: line.amount,
        ...(line.reference ? { reference: line.reference } : {})
      }))
    })
  }

  // Row errors are keyed by the position among the rows that have an amount.
  const filledIndex = (method: PaymentMethod): number =>
    rows
      .filter((row, index) => row.amount.trim() !== '' && (amounts[index] ?? 0) !== 0)
      .findIndex((row) => row.method === method)

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_17rem]">
      <div className="space-y-4">
        {partPaid ? (
          <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
            This bill is only part paid. Everything paid has to be returned, and the bill is then
            withdrawn so the order can be billed again.
          </p>
        ) : (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRows((current) =>
                  current.map((row) => ({ ...row, amount: paiseToInput(row.max) }))
                )
              }}
            >
              Refund everything ({formatMoney(rows.reduce((sum, row) => sum + row.max, 0))})
            </Button>
          </div>
        )}

        {rows.map((row) => {
          const prefix = `lines.${String(filledIndex(row.method))}`
          return (
            <div
              key={row.method}
              className="space-y-3 rounded-md border p-3"
              data-testid="refund-row"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{PAYMENT_METHOD_LABELS[row.method]}</span>
                <span className="text-muted-foreground">
                  Can return up to {formatMoney(row.max)}
                </span>
              </div>
              <Field label="Amount to return (₹)" error={errors[`${prefix}.amount`]}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="none"
                    disabled={partPaid}
                    className={cn(active === row.method && 'ring-2 ring-ring')}
                    value={row.amount}
                    onFocus={() => {
                      setActive(row.method)
                    }}
                    onChange={(event) => {
                      update(row.method, { amount: event.target.value })
                    }}
                  />
                )}
              </Field>
              {row.method !== 'CASH' && (
                <Field
                  label={
                    row.method === 'OTHER' ? 'Returned how (required)' : 'Reference (optional)'
                  }
                  error={errors[`${prefix}.reference`]}
                >
                  {(control) => (
                    <Input
                      {...control}
                      maxLength={60}
                      value={row.reference}
                      onChange={(event) => {
                        update(row.method, { reference: event.target.value })
                      }}
                    />
                  )}
                </Field>
              )}
            </div>
          )
        })}

        <Field label="Why is the money being returned?" error={errors.reason}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={200}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
              }}
            />
          )}
        </Field>

        <dl className="flex justify-between rounded-md bg-secondary/50 p-3 text-sm">
          <dt className="font-semibold">Total to give back</dt>
          <dd className="font-bold" data-testid="refund-total">
            {formatMoney(total)}
          </dd>
        </dl>

        {errors.lines && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errors.lines}
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
          <Button variant="destructive" disabled={pending || total === 0} onClick={submit}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Give money back
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">
          {activeRow ? `Amount: ${PAYMENT_METHOD_LABELS[activeRow.method]}` : 'Amount'}
        </p>
        <NumPad onKey={pressKey} />
      </div>
    </div>
  )
}
