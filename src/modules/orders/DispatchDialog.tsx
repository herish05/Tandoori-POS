import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { dispatchOrderInputSchema } from '@shared/orders'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { orderService } from '@/services/orders.service'
import { useRefreshOrders } from './hooks'

interface DispatchTarget {
  id: string
  orderNumber: string
  riderName: string | null
  riderPhone: string | null
}

interface DispatchDialogProps {
  /** The delivery to send out; null keeps the dialog closed. */
  order: DispatchTarget | null
  onClose: () => void
}

/** Asks for the rider, then sends a ready delivery out (or changes the rider of one already out). */
export function DispatchDialog({ order, onClose }: DispatchDialogProps) {
  return (
    <Dialog
      open={order !== null}
      title={order?.riderName ? 'Change rider' : 'Send out for delivery'}
      onClose={onClose}
    >
      {order && <DispatchForm key={order.id} order={order} onClose={onClose} />}
    </Dialog>
  )
}

function DispatchForm({ order, onClose }: { order: DispatchTarget; onClose: () => void }) {
  const refresh = useRefreshOrders()
  const [name, setName] = useState(order.riderName ?? '')
  const [phone, setPhone] = useState(order.riderPhone ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const send = useMutation({
    mutationFn: orderService.dispatch,
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const submit = (): void => {
    const parsed = dispatchOrderInputSchema.safeParse({
      orderId: order.id,
      riderName: name,
      riderPhone: phone
    })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    send.mutate(parsed.data)
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <p className="text-sm text-muted-foreground">
        Order {order.orderNumber}. Once it is out, the items can no longer change.
      </p>
      <Field label="Rider name" required error={errors.riderName}>
        {(c) => (
          <Input
            {...c}
            autoFocus
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        )}
      </Field>
      <Field label="Rider phone" error={errors.riderPhone}>
        {(c) => (
          <Input
            {...c}
            type="tel"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value)
            }}
          />
        )}
      </Field>
      {send.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(send.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={send.isPending}>
          {send.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {order.riderName ? 'Change rider' : 'Send out'}
        </Button>
      </div>
    </form>
  )
}
