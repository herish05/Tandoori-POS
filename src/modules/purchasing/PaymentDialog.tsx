import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  SUPPLIER_PAYMENT_LABELS,
  SUPPLIER_PAYMENT_METHODS,
  recordPaymentInputSchema,
  type Purchase,
  type SupplierPaymentMethod
} from '@shared/purchasing'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney, paiseToInput, parseRupees } from '@/lib/money'
import { purchaseService } from '@/services/purchasing.service'
import { useRefreshPurchasing } from './hooks'

interface PaymentDialogProps {
  open: boolean
  purchase: Purchase
  onClose: () => void
}

/** Record a payment to the supplier against one received purchase. */
export function PaymentDialog({ open, purchase, onClose }: PaymentDialogProps) {
  const due = purchase.total - purchase.amountPaid
  return (
    <Dialog
      open={open}
      title="Record payment"
      description={`${purchase.purchaseNumber} · ${formatMoney(due)} still due`}
      onClose={onClose}
    >
      <PaymentForm
        key={`${purchase.id}:${String(purchase.amountPaid)}`}
        purchase={purchase}
        onClose={onClose}
      />
    </Dialog>
  )
}

function PaymentForm({ purchase, onClose }: Omit<PaymentDialogProps, 'open'>) {
  const refresh = useRefreshPurchasing()
  const due = purchase.total - purchase.amountPaid
  const [amount, setAmount] = useState(paiseToInput(due))
  const [method, setMethod] = useState<SupplierPaymentMethod>('CASH')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const record = useMutation({
    mutationFn: purchaseService.recordPayment,
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const paise = parseRupees(amount)
    if (Number.isNaN(paise)) {
      setErrors({ amount: 'Enter an amount in rupees.' })
      return
    }
    const parsed = recordPaymentInputSchema.safeParse({
      purchaseId: purchase.id,
      amount: paise,
      method,
      reference,
      notes
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
        <Field label="Amount (₹)" required error={errors.amount}>
          {(c) => (
            <Input
              {...c}
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Paid by" required error={errors.method}>
          {(c) => (
            <Select
              {...c}
              value={method}
              onChange={(event) => {
                setMethod(event.target.value as SupplierPaymentMethod)
              }}
            >
              {SUPPLIER_PAYMENT_METHODS.map((entry) => (
                <option key={entry} value={entry}>
                  {SUPPLIER_PAYMENT_LABELS[entry]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Reference (UTR, cheque no.)" error={errors.reference}>
        {(c) => (
          <Input
            {...c}
            value={reference}
            onChange={(event) => {
              setReference(event.target.value)
            }}
          />
        )}
      </Field>
      <Field label="Notes" error={errors.notes}>
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
          Record payment
        </Button>
      </div>
    </form>
  )
}
