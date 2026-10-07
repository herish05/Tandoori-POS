import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  createCustomerInputSchema,
  updateCustomerInputSchema,
  type CustomerDetail
} from '@shared/customers'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { customerService } from '@/services/customers.service'
import { useRefreshCustomers } from './hooks'

interface CustomerFormDialogProps {
  open: boolean
  /** The customer being edited; null creates a new one. */
  customer: Pick<CustomerDetail, 'id' | 'name' | 'phone' | 'email' | 'notes'> | null
  onClose: () => void
  onSaved: (customer: CustomerDetail) => void
}

/** Create or edit a customer's name, phone, email and notes. */
export function CustomerFormDialog({ open, customer, onClose, onSaved }: CustomerFormDialogProps) {
  return (
    <Dialog open={open} title={customer ? 'Edit customer' : 'New customer'} onClose={onClose}>
      <CustomerForm
        key={customer?.id ?? 'new'}
        customer={customer}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Dialog>
  )
}

function CustomerForm({ customer, onClose, onSaved }: Omit<CustomerFormDialogProps, 'open'>) {
  const refresh = useRefreshCustomers()
  const [values, setValues] = useState({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    notes: customer?.notes ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: customerService.create,
    onSuccess: async (saved) => {
      await refresh()
      onSaved(saved)
    }
  })
  const update = useMutation({
    mutationFn: customerService.update,
    onSuccess: async (saved) => {
      await refresh()
      onSaved(saved)
    }
  })
  const pending = save.isPending || update.isPending
  const error = save.error ?? update.error

  const text =
    (key: keyof typeof values) =>
    (event: { target: { value: string } }): void => {
      setValues((current) => ({ ...current, [key]: event.target.value }))
    }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    if (customer) {
      const parsed = updateCustomerInputSchema.safeParse({ id: customer.id, ...values })
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error))
        return
      }
      setErrors({})
      update.mutate(parsed.data)
      return
    }
    const parsed = createCustomerInputSchema.safeParse(values)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    save.mutate(parsed.data)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Name" required error={errors.name}>
        {(c) => <Input {...c} autoFocus value={values.name} onChange={text('name')} />}
      </Field>
      <Field
        label="Phone"
        required
        error={errors.phone}
        hint="Used to recognise the customer on orders and bookings."
      >
        {(c) => <Input {...c} type="tel" value={values.phone} onChange={text('phone')} />}
      </Field>
      <Field label="Email" error={errors.email}>
        {(c) => <Input {...c} type="email" value={values.email} onChange={text('email')} />}
      </Field>
      <Field
        label="Notes"
        error={errors.notes}
        hint="Allergies, preferences, anything staff should know."
      >
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
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {customer ? 'Save changes' : 'Add customer'}
        </Button>
      </div>
    </form>
  )
}
