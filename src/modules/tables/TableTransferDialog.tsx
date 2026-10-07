import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, Combine, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { EDITABLE_ORDER_STATUSES, type OrderDetail, type OrderSummary } from '@shared/orders'
import type { DiningTable } from '@shared/tables'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ORDER_KEYS, useRefreshOrders } from '@/modules/orders/hooks'
import { orderService } from '@/services/orders.service'
import { tableService } from '@/services/tables.service'
import { TABLE_KEYS } from './hooks'

type Mode = 'SHIFT' | 'MERGE'
/** Merge: which table's order is kept. */
type Keep = 'OTHER' | 'THIS'

export interface TransferResult {
  /** The order the screen should show afterwards. */
  order: OrderDetail
  notice: string
}

interface TableTransferDialogProps {
  open: boolean
  /** The running dine-in order the staff member is looking at. */
  order: OrderDetail
  /** Why merging is not possible right now (for example unsent items on screen), if so. */
  mergeBlockedReason?: string | undefined
  onClose: () => void
  onDone: (result: TransferResult) => void
}

/**
 * Shift the party to a free table, or merge this table with another running table. The server
 * decides everything; this dialog only offers the tables that can work and says what will happen.
 */
export function TableTransferDialog(props: TableTransferDialogProps) {
  return (
    <Dialog open={props.open} title="Shift or merge table" onClose={props.onClose}>
      {props.open && <TransferBody {...props} />}
    </Dialog>
  )
}

const canMerge = (order: OrderSummary): boolean =>
  order.type === 'DINE_IN' &&
  order.tableId !== null &&
  EDITABLE_ORDER_STATUSES.includes(order.status)

function TransferBody({ order, mergeBlockedReason, onClose, onDone }: TableTransferDialogProps) {
  const refresh = useRefreshOrders()
  const [mode, setMode] = useState<Mode>('SHIFT')
  const [keep, setKeep] = useState<Keep>('OTHER')
  const [pickedId, setPickedId] = useState<string | null>(null)

  const floor = useQuery({
    queryKey: TABLE_KEYS.floor,
    queryFn: tableService.floor,
    staleTime: 0
  })
  const running = useQuery({
    queryKey: ORDER_KEYS.active,
    queryFn: () => orderService.list({ activeOnly: true, limit: 200 }),
    staleTime: 0
  })

  const orderByTable = new Map<string, OrderSummary>()
  for (const entry of running.data ?? []) {
    if (entry.tableId && entry.id !== order.id) orderByTable.set(entry.tableId, entry)
  }

  const thisTable = order.tableNumber ?? 'this table'
  const mergeAllowed = order.status !== 'BILL_REQUESTED' && !mergeBlockedReason
  const mergeNote =
    order.status === 'BILL_REQUESTED'
      ? 'The bill was requested. Cancel the bill before merging tables.'
      : mergeBlockedReason

  const candidates = (area: { tables: DiningTable[] }): DiningTable[] =>
    area.tables.filter((table) => {
      if (table.id === order.tableId) return false
      if (mode === 'SHIFT') return table.status === 'AVAILABLE' || table.status === 'RESERVED'
      const other = orderByTable.get(table.id)
      return other !== undefined && canMerge(other)
    })
  const areas = (floor.data ?? [])
    .map((area) => ({ area, tables: candidates(area) }))
    .filter((entry) => entry.tables.length > 0)

  const pickedTable = (floor.data ?? [])
    .flatMap((area) => area.tables)
    .find((table) => table.id === pickedId)
  const pickedOrder = pickedId ? orderByTable.get(pickedId) : undefined

  const submit = useMutation({
    mutationFn: async (): Promise<TransferResult> => {
      if (!pickedTable) throw new Error('Choose a table.')
      if (mode === 'SHIFT') {
        const shifted = await tableService.shift({ orderId: order.id, toTableId: pickedTable.id })
        return {
          order: shifted,
          notice: `Moved to ${pickedTable.displayName}. ${thisTable} is free again.`
        }
      }
      if (!pickedOrder) throw new Error('Choose a table with a running order.')
      const [sourceOrderId, targetOrderId] =
        keep === 'OTHER' ? [order.id, pickedOrder.id] : [pickedOrder.id, order.id]
      const merged = await tableService.merge({ sourceOrderId, targetOrderId })
      return {
        order: merged,
        notice:
          keep === 'OTHER'
            ? `Merged into ${pickedTable.displayName}. ${thisTable} is free again.`
            : `${pickedTable.displayName} was merged into this table and is free again.`
      }
    },
    onSuccess: async (result) => {
      await refresh()
      onDone(result)
    },
    onError: () => {
      // Another terminal may have changed the floor; show the latest behind the message.
      void refresh()
      setPickedId(null)
    }
  })

  const modeButton = (value: Mode, label: string, Icon: typeof Combine, disabled = false) => (
    <button
      type="button"
      aria-pressed={mode === value}
      disabled={disabled}
      onClick={() => {
        setMode(value)
        setPickedId(null)
        submit.reset()
      }}
      className={cn(
        'flex h-11 flex-1 items-center justify-center gap-2 rounded-md border text-sm font-semibold transition-colors',
        mode === value
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-card hover:bg-accent',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-card'
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  )

  const loading = floor.isPending || running.isPending
  const loadError = floor.isError ? floor.error : running.isError ? running.error : null

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="group" aria-label="What to do">
        {modeButton('SHIFT', 'Shift to another table', ArrowRightLeft)}
        {modeButton('MERGE', 'Merge with a table', Combine, !mergeAllowed)}
      </div>
      {!mergeAllowed && mergeNote && (
        <p className="rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">
          {mergeNote}
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        {mode === 'SHIFT'
          ? `Choose a free table for ${thisTable}'s guests. Items, kitchen tickets and the bill timing stay as they are.`
          : 'Choose a table with a running order. All items and kitchen tickets come together on one bill.'}
      </p>

      {mode === 'MERGE' && pickedOrder && (
        <div className="flex gap-2" role="group" aria-label="Which table to keep">
          {(
            [
              ['OTHER', `Move ${thisTable} into ${pickedTable?.tableNumber ?? 'it'}`],
              ['THIS', `Bring ${pickedTable?.tableNumber ?? 'it'} into ${thisTable}`]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={keep === value}
              onClick={() => {
                setKeep(value)
              }}
              className={cn(
                'h-11 flex-1 rounded-md border px-2 text-sm font-semibold transition-colors',
                keep === value ? 'border-foreground bg-secondary' : 'bg-card hover:bg-accent'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[45vh] space-y-4 overflow-y-auto">
        {loading && (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        )}
        {loadError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {toUserMessage(loadError)}
          </p>
        )}
        {!loading && !loadError && areas.length === 0 && (
          <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {mode === 'SHIFT'
              ? 'No table is free right now.'
              : 'No other table has a running order that can be merged.'}
          </p>
        )}
        {areas.map(({ area, tables }) => (
          <section key={area.id} aria-label={area.name}>
            <h3 className="mb-1.5 text-sm font-bold">{area.name}</h3>
            <div className="grid grid-cols-3 gap-2">
              {tables.map((table) => {
                const other = orderByTable.get(table.id)
                return (
                  <button
                    key={table.id}
                    type="button"
                    aria-pressed={pickedId === table.id}
                    data-table-id={table.id}
                    onClick={() => {
                      setPickedId(table.id)
                      submit.reset()
                    }}
                    className={cn(
                      'flex min-h-16 flex-col items-start justify-center rounded-md border-2 px-3 py-2 text-left transition-colors',
                      pickedId === table.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card hover:bg-accent'
                    )}
                  >
                    <span className="font-bold">{table.displayName}</span>
                    <span className="text-xs text-muted-foreground">
                      {mode === 'MERGE' && other
                        ? `${other.orderNumber} · ${formatMoney(other.subtotal)}`
                        : `Seats ${String(table.capacity)}`}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {submit.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(submit.error)}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!pickedTable || submit.isPending}
          onClick={() => {
            submit.mutate()
          }}
        >
          {submit.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {mode === 'SHIFT' ? 'Shift table' : 'Merge tables'}
        </Button>
      </div>
    </div>
  )
}
