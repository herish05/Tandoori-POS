import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import {
  applyDiscountInputSchema,
  DISCOUNT_TYPE_LABELS,
  DISCOUNT_TYPES,
  type BillItem,
  type DiscountScope,
  type DiscountType
} from '@shared/billing'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { NumPad } from '@/components/NumPad'
import { Textarea } from '@/components/ui/textarea'
import { fieldErrors } from '@/lib/form'
import { parsePercentToBps, parseRupees } from '@/lib/money'
import { applyPadKey } from '@/lib/numpad'

export interface DiscountTarget {
  billId: string
  scope: DiscountScope
  /** The bill line, for an item discount. */
  item: BillItem | null
}

interface DiscountDialogProps {
  target: DiscountTarget | null
  pending: boolean
  error: string | undefined
  onApply: (input: {
    billId: string
    scope: DiscountScope
    billItemId: string | null
    type: DiscountType
    value: number
    reason: string
  }) => void
  onClose: () => void
}

/** Gives a percentage or fixed-amount discount on the whole bill or on one item, with a reason. */
export function DiscountDialog({ target, ...rest }: DiscountDialogProps) {
  return (
    <Dialog
      open={target !== null}
      title={
        target?.scope === 'ITEM'
          ? `Discount on ${target.item?.name ?? 'item'}`
          : 'Discount on the bill'
      }
      description="The discount comes off before tax and the service charge. Every discount is recorded with its reason."
      onClose={rest.onClose}
    >
      {target && <DiscountForm target={target} {...rest} />}
    </Dialog>
  )
}

function DiscountForm({
  target,
  pending,
  error,
  onApply,
  onClose
}: Omit<DiscountDialogProps, 'target'> & { target: DiscountTarget }) {
  const [type, setType] = useState<DiscountType>('PERCENTAGE')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (): void => {
    const value = type === 'PERCENTAGE' ? parsePercentToBps(amount) : parseRupees(amount)
    const parsed = applyDiscountInputSchema.safeParse({
      billId: target.billId,
      scope: target.scope,
      billItemId: target.item?.id ?? null,
      type,
      value: Number.isNaN(value) ? undefined : value,
      reason
    })
    if (!parsed.success) {
      const found = fieldErrors(parsed.error)
      if (found.value) found.amount = found.value
      setErrors(found)
      return
    }
    setErrors({})
    onApply({
      billId: parsed.data.billId,
      scope: parsed.data.scope,
      billItemId: parsed.data.billItemId,
      type: parsed.data.type,
      value: parsed.data.value,
      reason: parsed.data.reason
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          {(control) => (
            <Select
              {...control}
              value={type}
              onChange={(event) => {
                const next = DISCOUNT_TYPES.find((entry) => entry === event.target.value)
                setType(next ?? 'PERCENTAGE')
                setAmount('')
              }}
            >
              {DISCOUNT_TYPES.map((entry) => (
                <option key={entry} value={entry}>
                  {DISCOUNT_TYPE_LABELS[entry]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={type === 'PERCENTAGE' ? 'Percent off' : 'Amount off (₹)'}
          error={errors.amount}
          required
        >
          {(control) => (
            <Input
              {...control}
              inputMode="none"
              value={amount}
              placeholder={type === 'PERCENTAGE' ? '10' : '50'}
              onChange={(event) => {
                setAmount(event.target.value)
              }}
            />
          )}
        </Field>
      </div>
      <NumPad
        onKey={(key) => {
          setAmount((current) => applyPadKey(current, key))
        }}
      />
      <Field label="Reason" error={errors.reason} required>
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
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={pending} onClick={submit}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Apply discount
        </Button>
      </div>
    </div>
  )
}
