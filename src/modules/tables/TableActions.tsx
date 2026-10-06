import { useMutation } from '@tanstack/react-query'
import { Ban, ClipboardList, DoorClosed, DoorOpen, Loader2, LockOpen } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { openTableInputSchema, TABLE_TYPE_LABELS, type DiningTable } from '@shared/tables'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { tableService } from '@/services/tables.service'
import { useRefreshTables } from './hooks'
import { TABLE_STATUS_META } from './table-status'

interface TableActionsProps {
  table: DiningTable
  canOperate: boolean
  /** Present when the user may take orders: starts a dine-in order for this table. */
  onTakeOrder?: (guestCount: number | null) => void
  onDone: () => void
  onCancel: () => void
}

/**
 * What can be done with a table from the POS floor: take an order, open it for guests, close it,
 * or block it from use. A table with an order in progress goes straight to that order instead.
 */
export function TableActions({
  table,
  canOperate,
  onTakeOrder,
  onDone,
  onCancel
}: TableActionsProps) {
  const refresh = useRefreshTables()
  const [guests, setGuests] = useState('')
  const [guestError, setGuestError] = useState<string | undefined>()

  const run = useMutation({
    mutationFn: (action: 'open' | 'close' | 'block' | 'unblock'): Promise<DiningTable> => {
      switch (action) {
        case 'open':
          return tableService.open({
            id: table.id,
            ...(guests.trim() === '' ? {} : { guestCount: Number(guests) })
          })
        case 'close':
          return tableService.close(table.id)
        case 'block':
          return tableService.block(table.id)
        case 'unblock':
          return tableService.unblock(table.id)
      }
    },
    onSuccess: async () => {
      await refresh()
      onDone()
    },
    onError: () => {
      // The floor may have changed under us; show the latest state behind the message.
      void refresh()
    }
  })

  const canOpen = table.status === 'AVAILABLE' || table.status === 'RESERVED'
  const canClose = table.status === 'OCCUPIED' || table.status === 'PAID'
  const inProgress = !canOpen && !canClose && table.status !== 'BLOCKED'

  /** The guest count typed in, or `undefined` (after showing why) when it is not valid. */
  const checkedGuests = (): number | null | undefined => {
    const parsed = openTableInputSchema.safeParse({
      id: table.id,
      ...(guests.trim() === '' ? {} : { guestCount: Number(guests) })
    })
    if (!parsed.success) {
      setGuestError(fieldErrors(parsed.error).guestCount ?? 'Enter a valid number of guests.')
      return undefined
    }
    setGuestError(undefined)
    return parsed.data.guestCount ?? null
  }

  const open = (event: SyntheticEvent): void => {
    event.preventDefault()
    if (checkedGuests() !== undefined) run.mutate('open')
  }

  const takeOrder = (): void => {
    const count = canOpen ? checkedGuests() : null
    if (count !== undefined) onTakeOrder?.(count)
  }
  const showTakeOrder = onTakeOrder !== undefined && (canOpen || table.status === 'OCCUPIED')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{TABLE_TYPE_LABELS[table.type]}</Badge>
        <Badge variant="outline">{TABLE_STATUS_META[table.status].label}</Badge>
        <span className="text-muted-foreground">
          {table.areaName} · seats {table.capacity}
          {table.guestCount !== null && ` · ${String(table.guestCount)} guests`}
        </span>
      </div>

      {!canOperate && (
        <p className="rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">
          You can view tables but your role does not allow opening or closing them.
        </p>
      )}

      {showTakeOrder && !canOpen && (
        <Button className="w-full" onClick={takeOrder}>
          <ClipboardList /> Take order
        </Button>
      )}

      {(canOperate || showTakeOrder) && canOpen && (
        <form onSubmit={open} noValidate className="space-y-3">
          <Field
            label="Number of guests"
            error={guestError}
            hint={`Optional. This table seats ${String(table.capacity)}.`}
          >
            {(c) => (
              <Input
                {...c}
                inputMode="numeric"
                value={guests}
                onChange={(event) => {
                  setGuests(event.target.value)
                }}
              />
            )}
          </Field>
          {showTakeOrder && (
            <Button type="button" className="w-full" onClick={takeOrder}>
              <ClipboardList /> Take order
            </Button>
          )}
          {canOperate && (
            <Button
              type="submit"
              variant={showTakeOrder ? 'outline' : 'default'}
              disabled={run.isPending}
              className="w-full"
            >
              {run.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <DoorOpen />}
              Open table
            </Button>
          )}
        </form>
      )}

      {canOperate && canClose && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {table.status === 'PAID'
              ? 'This table has been paid. Close it to make it available again.'
              : 'Closing frees the table for the next guests.'}
          </p>
          <Button
            variant="outline"
            disabled={run.isPending}
            className="w-full"
            onClick={() => {
              run.mutate('close')
            }}
          >
            {run.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <DoorClosed />}
            Close table
          </Button>
        </div>
      )}

      {inProgress && (
        <p className="rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">
          An order is in progress on this table. Settle or cancel the order before closing the
          table.
        </p>
      )}

      {canOperate && table.status === 'AVAILABLE' && (
        <Button
          variant="ghost"
          disabled={run.isPending}
          className="w-full text-muted-foreground"
          onClick={() => {
            run.mutate('block')
          }}
        >
          <Ban /> Block table (out of service)
        </Button>
      )}
      {canOperate && table.status === 'BLOCKED' && (
        <Button
          variant="outline"
          disabled={run.isPending}
          className="w-full"
          onClick={() => {
            run.mutate('unblock')
          }}
        >
          <LockOpen /> Unblock table
        </Button>
      )}

      {run.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(run.error)}
        </p>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
