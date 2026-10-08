import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  createSupplierInputSchema,
  updateSupplierInputSchema,
  type Supplier
} from '@shared/purchasing'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { supplierService } from '@/services/purchasing.service'
import { useRefreshPurchasing } from './hooks'

interface SupplierFormDialogProps {
  open: boolean
  /** The supplier being edited; null adds a new one. */
  supplier: Supplier | null
  onClose: () => void
}

/** Add or edit a supplier. */
export function SupplierFormDialog({ open, supplier, onClose }: SupplierFormDialogProps) {
  return (
    <Dialog open={open} title={supplier ? 'Edit supplier' : 'New supplier'} onClose={onClose}>
      <SupplierForm key={supplier?.id ?? 'new'} supplier={supplier} onClose={onClose} />
    </Dialog>
  )
}

function SupplierForm({ supplier, onClose }: Omit<SupplierFormDialogProps, 'open'>) {
  const refresh = useRefreshPurchasing()
  const [values, setValues] = useState({
    name: supplier?.name ?? '',
    contactPerson: supplier?.contactPerson ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    gstin: supplier?.gstin ?? '',
    address: supplier?.address ?? '',
    notes: supplier?.notes ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const done = async (): Promise<void> => {
    await refresh()
    onClose()
  }
  const create = useMutation({ mutationFn: supplierService.create, onSuccess: done })
  const update = useMutation({ mutationFn: supplierService.update, onSuccess: done })
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  const text =
    (key: keyof typeof values) =>
    (event: { target: { value: string } }): void => {
      setValues((current) => ({ ...current, [key]: event.target.value }))
    }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const parsed = supplier
      ? updateSupplierInputSchema.safeParse({ id: supplier.id, ...values })
      : createSupplierInputSchema.safeParse(values)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    if (supplier) {
      update.mutate({ id: supplier.id, ...parsed.data })
    } else {
      create.mutate(parsed.data)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Supplier name" required error={errors.name}>
        {(c) => <Input {...c} autoFocus value={values.name} onChange={text('name')} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact person" error={errors.contactPerson}>
          {(c) => <Input {...c} value={values.contactPerson} onChange={text('contactPerson')} />}
        </Field>
        <Field label="Phone" error={errors.phone}>
          {(c) => <Input {...c} inputMode="tel" value={values.phone} onChange={text('phone')} />}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" error={errors.email}>
          {(c) => <Input {...c} type="email" value={values.email} onChange={text('email')} />}
        </Field>
        <Field label="GSTIN" error={errors.gstin}>
          {(c) => <Input {...c} value={values.gstin} onChange={text('gstin')} />}
        </Field>
      </div>
      <Field label="Address" error={errors.address}>
        {(c) => <Textarea {...c} rows={2} value={values.address} onChange={text('address')} />}
      </Field>
      <Field label="Notes" error={errors.notes}>
        {(c) => <Input {...c} value={values.notes} onChange={text('notes')} />}
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
          {supplier ? 'Save changes' : 'Add supplier'}
        </Button>
      </div>
    </form>
  )
}
