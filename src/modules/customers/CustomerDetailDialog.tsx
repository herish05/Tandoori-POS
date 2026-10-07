import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ADDRESS_LABELS,
  addAddressInputSchema,
  updateAddressInputSchema,
  type CustomerAddress,
  type CustomerDetail
} from '@shared/customers'
import { ORDER_STATUS_LABELS, ORDER_TYPE_LABELS } from '@shared/orders'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/lib/format'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { ORDER_STATUS_TONE } from '@/modules/orders/order-status'
import { customerService } from '@/services/customers.service'
import { usePermission } from '@/stores/auth.store'
import { CUSTOMER_KEYS, useRefreshCustomers } from './hooks'

interface CustomerDetailDialogProps {
  /** The customer to show; null keeps the dialog closed. */
  customerId: string | null
  onClose: () => void
  onEdit: (customer: CustomerDetail) => void
}

/** One customer: contact details, saved addresses and the latest orders. */
export function CustomerDetailDialog({ customerId, onClose, onEdit }: CustomerDetailDialogProps) {
  return (
    <Dialog open={customerId !== null} title="Customer" onClose={onClose} className="max-w-2xl">
      {customerId && (
        <DetailBody key={customerId} customerId={customerId} onClose={onClose} onEdit={onEdit} />
      )}
    </Dialog>
  )
}

function DetailBody({
  customerId,
  onClose,
  onEdit
}: {
  customerId: string
  onClose: () => void
  onEdit: (customer: CustomerDetail) => void
}) {
  const canManage = usePermission('customers.manage')
  const canViewOrders = usePermission('orders.view')
  const refresh = useRefreshCustomers()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState<CustomerAddress | 'new' | null>(null)

  const detail = useQuery({
    queryKey: CUSTOMER_KEYS.detail(customerId),
    queryFn: () => customerService.get(customerId),
    staleTime: 0
  })
  const remove = useMutation({
    mutationFn: () => customerService.remove(customerId),
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })
  const removeAddress = useMutation({
    mutationFn: customerService.removeAddress,
    onSuccess: refresh
  })

  if (detail.isPending) return <Skeleton className="h-48 w-full" />
  if (detail.isError) {
    return (
      <p role="alert" className="text-sm font-medium text-destructive">
        {toUserMessage(detail.error)}
      </p>
    )
  }
  const customer = detail.data

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">{customer.name}</h3>
          <p className="text-sm text-muted-foreground">
            {customer.phone}
            {customer.email ? ` · ${customer.email}` : ''}
          </p>
          {customer.notes && <p className="mt-1 text-sm">{customer.notes}</p>}
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onEdit(customer)
              }}
            >
              <Pencil /> Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConfirmDelete(true)
              }}
            >
              <Trash2 /> Delete
            </Button>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-md border p-3">
          <dt className="text-xs text-muted-foreground">Orders</dt>
          <dd className="text-lg font-bold">{customer.orderCount}</dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="text-xs text-muted-foreground">Total spent</dt>
          <dd className="text-lg font-bold">{formatMoney(customer.totalSpent)}</dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="text-xs text-muted-foreground">Last order</dt>
          <dd className="text-sm font-semibold">
            {customer.lastOrderAt ? formatDateTime(customer.lastOrderAt) : 'Never'}
          </dd>
        </div>
      </dl>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold">Addresses</h4>
          {canManage && editing === null && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing('new')
              }}
            >
              <Plus /> Add address
            </Button>
          )}
        </div>
        {customer.addresses.length === 0 && editing === null && (
          <p className="text-sm text-muted-foreground">
            No saved address. Delivery addresses are remembered automatically from orders.
          </p>
        )}
        {customer.addresses.map((address) =>
          editing !== null && editing !== 'new' && editing.id === address.id ? (
            <AddressForm
              key={address.id}
              customerId={customer.id}
              address={address}
              onDone={() => {
                setEditing(null)
              }}
            />
          ) : (
            <div key={address.id} className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold">
                  {address.label}
                  {address.isDefault && (
                    <Badge variant="secondary">
                      <Star className="size-3" aria-hidden /> Default
                    </Badge>
                  )}
                </p>
                <p className="whitespace-pre-line">{address.address}</p>
                {address.landmark && (
                  <p className="text-xs text-muted-foreground">Near {address.landmark}</p>
                )}
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${address.label} address`}
                    onClick={() => {
                      setEditing(address)
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${address.label} address`}
                    disabled={removeAddress.isPending}
                    onClick={() => {
                      removeAddress.mutate(address.id)
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </div>
          )
        )}
        {editing === 'new' && (
          <AddressForm
            customerId={customer.id}
            address={null}
            onDone={() => {
              setEditing(null)
            }}
          />
        )}
        {removeAddress.isError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {toUserMessage(removeAddress.error)}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="font-semibold">Recent orders</h4>
        {customer.recentOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {customer.recentOrders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div>
                  {canViewOrders ? (
                    <Link
                      to={`/pos/orders/${order.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  ) : (
                    <span className="font-medium">{order.orderNumber}</span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {ORDER_TYPE_LABELS[order.type]} · {formatDateTime(order.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">{formatMoney(order.subtotal)}</span>
                  <Badge variant={ORDER_STATUS_TONE[order.status]}>
                    {ORDER_STATUS_LABELS[order.status]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete customer?"
        message={`${customer.name} will be removed from the customer list. Past orders and bills keep their details.`}
        confirmLabel="Delete customer"
        destructive
        pending={remove.isPending}
        error={remove.isError ? toUserMessage(remove.error) : undefined}
        onConfirm={() => {
          remove.mutate()
        }}
        onClose={() => {
          setConfirmDelete(false)
        }}
      />
    </div>
  )
}

function AddressForm({
  customerId,
  address,
  onDone
}: {
  customerId: string
  address: CustomerAddress | null
  onDone: () => void
}) {
  const refresh = useRefreshCustomers()
  const [values, setValues] = useState({
    label: address?.label ?? 'Home',
    address: address?.address ?? '',
    landmark: address?.landmark ?? '',
    isDefault: address?.isDefault ?? false
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: (): Promise<CustomerDetail> => {
      if (address) {
        return customerService.updateAddress(
          updateAddressInputSchema.parse({ id: address.id, ...values })
        )
      }
      return customerService.addAddress(addAddressInputSchema.parse({ customerId, ...values }))
    },
    onSuccess: async () => {
      await refresh()
      onDone()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const parsed = address
      ? updateAddressInputSchema.safeParse({ id: address.id, ...values })
      : addAddressInputSchema.safeParse({ customerId, ...values })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    save.mutate()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border bg-secondary/30 p-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Label" error={errors.label}>
          {(c) => (
            <Select
              {...c}
              value={values.label}
              onChange={(event) => {
                setValues((current) => ({ ...current, label: event.target.value }))
              }}
            >
              {ADDRESS_LABELS.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Landmark" error={errors.landmark} className="col-span-2">
          {(c) => (
            <Input
              {...c}
              value={values.landmark}
              onChange={(event) => {
                setValues((current) => ({ ...current, landmark: event.target.value }))
              }}
            />
          )}
        </Field>
      </div>
      <Field label="Address" required error={errors.address}>
        {(c) => (
          <Textarea
            {...c}
            rows={2}
            autoFocus
            value={values.address}
            onChange={(event) => {
              setValues((current) => ({ ...current, address: event.target.value }))
            }}
          />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[hsl(var(--primary))]"
          checked={values.isDefault}
          onChange={(event) => {
            setValues((current) => ({ ...current, isDefault: event.target.checked }))
          }}
        />
        Use as the default address
      </label>
      {save.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(save.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Save address
        </Button>
      </div>
    </form>
  )
}
