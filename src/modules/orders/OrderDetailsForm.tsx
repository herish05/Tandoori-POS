import { useState } from 'react'
import type { CustomerLookupResult } from '@shared/customers'
import { CustomerSuggestions } from '@/modules/customers/CustomerSuggestions'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { OrderType } from '@shared/orders'
import type { DetailsValues } from './details'

const PROMISE_CHOICES = [15, 30, 45, 60] as const

/** An ISO time as the "YYYY-MM-DDTHH:mm" a datetime-local field wants, in local time. */
function toLocalInput(iso: string): string {
  if (iso === '') return ''
  const date = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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
  /** The known customer chosen from the suggestions, whose saved addresses can be picked. */
  const [known, setKnown] = useState<CustomerLookupResult | null>(null)
  const set =
    (field: keyof DetailsValues) =>
    (event: { target: { value: string } }): void => {
      if (field === 'customerName' || field === 'customerPhone') setKnown(null)
      onChange({ ...values, [field]: event.target.value })
    }
  const delivery = type === 'DELIVERY'
  const pick = (customer: CustomerLookupResult): void => {
    setKnown(customer)
    const fallback = customer.addresses.find((entry) => entry.isDefault) ?? customer.addresses[0]
    onChange({
      ...values,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress:
        delivery && values.deliveryAddress.trim() === '' && fallback
          ? fallback.address
          : values.deliveryAddress
    })
  }
  const chip = (active: boolean): string =>
    cn(
      'h-8 rounded-full border px-3 text-xs font-semibold transition-colors touch:h-10',
      active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'
    )

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
        <div className="space-y-2">
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
          <CustomerSuggestions
            query={values.customerPhone.trim() === '' ? values.customerName : values.customerPhone}
            disabled={disabled}
            onPick={pick}
          />
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
      {delivery && known && known.addresses.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Saved addresses">
          {known.addresses.map((saved) => (
            <button
              key={saved.id}
              type="button"
              disabled={disabled}
              aria-pressed={values.deliveryAddress === saved.address}
              className={chip(values.deliveryAddress === saved.address)}
              title={saved.address}
              onClick={() => {
                onChange({ ...values, deliveryAddress: saved.address })
              }}
            >
              {saved.label}
            </button>
          ))}
        </div>
      )}
      {type !== 'DINE_IN' && (
        <Field
          label={delivery ? 'Deliver by' : 'Ready by'}
          hint="Optional. The kitchen sees it on the ticket."
          error={errors.promisedAt}
        >
          {(c) => (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={values.promisedAt === ''}
                  className={chip(values.promisedAt === '')}
                  onClick={() => {
                    onChange({ ...values, promisedAt: '' })
                  }}
                >
                  ASAP
                </button>
                {PROMISE_CHOICES.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    disabled={disabled}
                    className={chip(false)}
                    onClick={() => {
                      const at = new Date(Date.now() + minutes * 60_000)
                      onChange({ ...values, promisedAt: at.toISOString() })
                    }}
                  >
                    +{minutes} min
                  </button>
                ))}
              </div>
              <Input
                {...c}
                type="datetime-local"
                disabled={disabled}
                value={toLocalInput(values.promisedAt)}
                onChange={(event) => {
                  const typed = event.target.value
                  const at = new Date(typed)
                  onChange({
                    ...values,
                    promisedAt: typed === '' || Number.isNaN(at.getTime()) ? '' : at.toISOString()
                  })
                }}
              />
            </div>
          )}
        </Field>
      )}
      <Field label="Order notes" error={errors.notes}>
        {(c) => <Input {...c} disabled={disabled} value={values.notes} onChange={set('notes')} />}
      </Field>
    </div>
  )
}
