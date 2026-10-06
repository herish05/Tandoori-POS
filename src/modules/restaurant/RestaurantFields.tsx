import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { LogoField } from './LogoField'
import type { RestaurantFormValues } from './restaurant-form'

interface RestaurantFieldsProps {
  values: RestaurantFormValues
  errors: Record<string, string>
  onChange: (patch: Partial<RestaurantFormValues>) => void
  disabled?: boolean
}

/** Shared by the first-run wizard and the restaurant settings screen. */
export function RestaurantFields({ values, errors, onChange, disabled }: RestaurantFieldsProps) {
  const text =
    (key: keyof Omit<RestaurantFormValues, 'logo'>) =>
    (event: { target: { value: string } }): void => {
      onChange({ [key]: event.target.value })
    }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Restaurant name" required error={errors.name}>
        {(c) => <Input {...c} value={values.name} onChange={text('name')} disabled={disabled} />}
      </Field>
      <Field label="Legal name" error={errors.legalName} hint="As on your GST registration.">
        {(c) => (
          <Input {...c} value={values.legalName} onChange={text('legalName')} disabled={disabled} />
        )}
      </Field>
      <Field label="Address" required error={errors.address} className="sm:col-span-2">
        {(c) => (
          <Input {...c} value={values.address} onChange={text('address')} disabled={disabled} />
        )}
      </Field>
      <Field label="City" required error={errors.city}>
        {(c) => <Input {...c} value={values.city} onChange={text('city')} disabled={disabled} />}
      </Field>
      <Field label="State" required error={errors.state}>
        {(c) => <Input {...c} value={values.state} onChange={text('state')} disabled={disabled} />}
      </Field>
      <Field label="Country" required error={errors.country}>
        {(c) => (
          <Input {...c} value={values.country} onChange={text('country')} disabled={disabled} />
        )}
      </Field>
      <Field label="Phone" required error={errors.phone}>
        {(c) => (
          <Input
            {...c}
            type="tel"
            value={values.phone}
            onChange={text('phone')}
            disabled={disabled}
          />
        )}
      </Field>
      <Field label="Email" error={errors.email}>
        {(c) => (
          <Input
            {...c}
            type="email"
            value={values.email}
            onChange={text('email')}
            disabled={disabled}
          />
        )}
      </Field>
      <Field label="GSTIN" error={errors.gstin} hint="15 characters, for example 03ABCDE1234F1Z5.">
        {(c) => (
          <Input
            {...c}
            value={values.gstin}
            onChange={text('gstin')}
            disabled={disabled}
            className="uppercase"
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Currency" hint="Fixed to Indian Rupee.">
          {(c) => <Input {...c} value="INR (₹)" readOnly disabled />}
        </Field>
        <Field label="Time zone" hint="Fixed to India.">
          {(c) => <Input {...c} value="Asia/Kolkata" readOnly disabled />}
        </Field>
      </div>
      <Field
        label="Receipt footer"
        error={errors.receiptFooter}
        hint="Printed at the bottom of every bill."
        className="sm:col-span-2"
      >
        {(c) => (
          <Textarea
            {...c}
            rows={2}
            value={values.receiptFooter}
            onChange={text('receiptFooter')}
            disabled={disabled}
          />
        )}
      </Field>
      <div className="sm:col-span-2">
        <LogoField
          value={values.logo}
          onChange={(logo) => {
            onChange({ logo })
          }}
          error={errors.logo}
        />
      </div>
    </div>
  )
}
