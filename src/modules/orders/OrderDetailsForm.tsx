import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { OrderType } from '@shared/orders'
import type { DetailsValues } from './details'

interface OrderDetailsFormProps {
  type: OrderType
  values: DetailsValues
  errors: Record<string, string>
  onChange: (values: DetailsValues) => void
  disabled?: boolean
}

/** Guests, customer, address and notes: which of them show depends on the order type. */
export function OrderDetailsForm({
  type,
  values,
  errors,
  onChange,
  disabled
}: OrderDetailsFormProps) {
  const set =
    (field: keyof DetailsValues) =>
    (event: { target: { value: string } }): void => {
      onChange({ ...values, [field]: event.target.value })
    }
  const delivery = type === 'DELIVERY'

  return (
    <div className="space-y-3">
      {type === 'DINE_IN' && (
        <Field label="Guests" error={errors.guestCount}>
          {(c) => (
            <Input
              {...c}
              inputMode="numeric"
              disabled={disabled}
              value={values.guests}
              onChange={set('guests')}
            />
          )}
        </Field>
      )}
      {type !== 'DINE_IN' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer name" required={delivery} error={errors.customerName}>
            {(c) => (
              <Input
                {...c}
                disabled={disabled}
                value={values.customerName}
                onChange={set('customerName')}
              />
            )}
          </Field>
          <Field label="Phone" required={delivery} error={errors.customerPhone}>
            {(c) => (
              <Input
                {...c}
                type="tel"
                disabled={disabled}
                value={values.customerPhone}
                onChange={set('customerPhone')}
              />
            )}
          </Field>
        </div>
      )}
      {delivery && (
        <Field label="Delivery address" required error={errors.deliveryAddress}>
          {(c) => (
            <Textarea
              {...c}
              rows={2}
              disabled={disabled}
              value={values.deliveryAddress}
              onChange={set('deliveryAddress')}
            />
          )}
        </Field>
      )}
      <Field label="Order notes" error={errors.notes}>
        {(c) => <Input {...c} disabled={disabled} value={values.notes} onChange={set('notes')} />}
      </Field>
    </div>
  )
}
