import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import {
  KOT_ACTION_LABELS,
  KOT_PRINT_STATUS_LABELS,
  KOT_STATUS_LABELS,
  type KotDetail,
  type KotStatus,
  type SETTABLE_KOT_STATUSES
} from '@shared/kitchen'
import { ORDER_TYPE_LABELS } from '@shared/orders'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { KITCHEN_REFRESH_MS, KOT_KEYS, useRefreshKots } from '@/modules/kitchen/hooks'
import { ageLabel } from '@/modules/kitchen/kot-status'
import { FoodTypeMark } from '@/modules/menu/FoodTypeMark'
import { useNow } from '@/modules/tables/hooks'
import { kotService } from '@/services/kitchen.service'
import { usePermission } from '@/stores/auth.store'

const COLUMNS = ['NEW', 'ACCEPTED', 'PREPARING', 'READY'] as const satisfies readonly KotStatus[]

type Column = (typeof COLUMNS)[number]
type Settable = (typeof SETTABLE_KOT_STATUSES)[number]

/** The action that moves a ticket on from each column. */
const NEXT: Record<Column, Settable> = {
  NEW: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'SERVED'
}

/** A ticket waiting this long (minutes) is flagged so the cooks see it first. */
const LATE_AFTER_MINUTES = 15

const isColumn = (status: KotStatus): status is Column =>
  COLUMNS.some((column) => column === status)

function whereOf(kot: KotDetail): string {
  if (kot.orderType === 'DINE_IN') {
    return kot.tableName ?? kot.tableNumber ?? 'Table'
  }
  return [ORDER_TYPE_LABELS[kot.orderType], kot.customerName].filter(Boolean).join(' · ')
}

/** Kitchen display: every open ticket in four columns, refreshed every few seconds. */
export function KitchenPage() {
  const now = useNow(15_000)
  const canOperate = usePermission('kitchen.operate')
  const refresh = useRefreshKots()
  const [stationId, setStationId] = useState('')

  const board = useQuery({
    queryKey: KOT_KEYS.board(null),
    queryFn: () => kotService.board(),
    refetchInterval: KITCHEN_REFRESH_MS,
    staleTime: 0
  })
  const move = useMutation({
    mutationFn: (input: { id: string; status: Settable }) => kotService.setStatus(input),
    onSettled: async () => {
      await refresh()
    }
  })

  if (board.isPending) {
    return (
      <div className="grid h-full grid-cols-4 gap-4">
        {COLUMNS.map((column) => (
          <Skeleton key={column} className="h-full bg-white/10" />
        ))}
      </div>
    )
  }
  if (board.isError) {
    return (
      <p role="alert" className="p-6 text-center text-sm font-medium text-red-300">
        {toUserMessage(board.error)}
      </p>
    )
  }

  const all = board.data
  const stations = new Map<string, string>()
  for (const kot of all) {
    if (kot.stationId) stations.set(kot.stationId, kot.stationName)
  }
  const shown = stationId ? all.filter((kot) => kot.stationId === stationId) : all
  const cancelled = shown.filter((kot) => kot.status === 'CANCELLED')

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Station
          <Select
            className="h-9 w-48 bg-white/10 text-navy-foreground"
            value={stationId}
            onChange={(event) => {
              setStationId(event.target.value)
            }}
          >
            <option value="">All stations</option>
            {[...stations].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        {!canOperate && (
          <span className="text-xs text-navy-foreground/60">
            View only: your role cannot change ticket status.
          </span>
        )}
        {move.isError && (
          <span role="alert" className="text-sm font-medium text-red-300">
            {toUserMessage(move.error)}
          </span>
        )}
      </div>

      {cancelled.length > 0 && (
        <ul aria-label="Cancelled tickets" className="flex flex-wrap gap-2">
          {cancelled.map((kot) => (
            <li
              key={kot.id}
              data-testid="kot-cancelled"
              className="rounded-md border border-red-400/60 bg-red-500/15 px-3 py-2 text-sm"
            >
              <strong>{kot.kotNumber} cancelled</strong> · {whereOf(kot)} · {kot.stationName}
              {kot.cancelReason && <> · {kot.cancelReason}</>}
            </li>
          ))}
        </ul>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-4 gap-4">
        {COLUMNS.map((column) => {
          const tickets = shown.filter((kot) => kot.status === column)
          return (
            <section
              key={column}
              aria-label={`${KOT_STATUS_LABELS[column]} tickets`}
              className="flex min-h-0 flex-col rounded-lg bg-white/5"
            >
              <h2 className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm font-bold uppercase tracking-wider">
                {KOT_STATUS_LABELS[column]}
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
                  {tickets.length}
                </span>
              </h2>
              {tickets.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-4 text-sm text-navy-foreground/50">
                  No tickets
                </div>
              ) : (
                <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  {tickets.map((kot) => (
                    <li key={kot.id}>
                      <Ticket
                        kot={kot}
                        now={now}
                        canOperate={canOperate}
                        busy={move.isPending && move.variables.id === kot.id}
                        onMove={() => {
                          move.mutate({ id: kot.id, status: NEXT[column] })
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Ticket({
  kot,
  now,
  canOperate,
  busy,
  onMove
}: {
  kot: KotDetail
  now: number
  canOperate: boolean
  busy: boolean
  onMove: () => void
}) {
  const waitingMinutes = Math.floor((now - new Date(kot.createdAt).getTime()) / 60_000)
  const open = isColumn(kot.status)
  const late = open && kot.status !== 'READY' && waitingMinutes >= LATE_AFTER_MINUTES
  const next = isColumn(kot.status) ? NEXT[kot.status] : null

  return (
    <article
      data-testid="kot-card"
      aria-label={`${kot.kotNumber} ${KOT_STATUS_LABELS[kot.status]}`}
      className={cn(
        'rounded-lg border bg-white/10 p-3',
        late ? 'border-amber-400' : 'border-white/15'
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold leading-tight">{whereOf(kot)}</p>
          <p className="text-xs text-navy-foreground/70">
            {kot.kotNumber} · {kot.orderNumber} · {kot.stationName}
          </p>
        </div>
        <span className={cn('text-sm font-bold', late && 'text-amber-300')}>
          {ageLabel(kot.createdAt, now)}
        </span>
      </header>

      {(kot.isAdditional || kot.revision > 0 || kot.printStatus === 'FAILED') && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-bold uppercase">
          {kot.isAdditional && (
            <span className="rounded bg-sky-400/25 px-1.5 py-0.5">Additional</span>
          )}
          {kot.revision > 0 && (
            <span className="rounded bg-amber-400/25 px-1.5 py-0.5">Revised</span>
          )}
          {kot.printStatus === 'FAILED' && (
            <span className="rounded bg-red-400/25 px-1.5 py-0.5">
              {KOT_PRINT_STATUS_LABELS.FAILED}
            </span>
          )}
        </div>
      )}

      <ul className="mt-2 space-y-1.5">
        {kot.items.map((item) => (
          <li key={item.id} className={cn('text-sm', item.status === 'CANCELLED' && 'opacity-60')}>
            <div
              className={cn(
                'flex items-start gap-2 font-semibold',
                item.status === 'CANCELLED' && 'line-through'
              )}
            >
              <span className="min-w-6 text-base font-bold">{item.quantity}×</span>
              <FoodTypeMark type={item.foodType} className="mt-0.5" />
              <span>
                {item.name}
                {item.variantName && ` (${item.variantName})`}
              </span>
            </div>
            {item.addons.length > 0 && (
              <p className="ml-8 text-xs text-navy-foreground/80">
                {item.addons.map((addon) => addon.name).join(', ')}
              </p>
            )}
            {item.notes && <p className="ml-8 text-xs font-medium text-amber-200">{item.notes}</p>}
            {item.status === 'CANCELLED' && (
              <p className="ml-8 text-xs font-bold uppercase text-red-300">
                Cancelled{item.cancelReason ? `: ${item.cancelReason}` : ''}
              </p>
            )}
          </li>
        ))}
      </ul>

      {kot.orderNotes && (
        <p className="mt-2 rounded bg-white/10 px-2 py-1 text-xs">Order note: {kot.orderNotes}</p>
      )}

      {canOperate && next && (
        <Button className="mt-3 w-full" size="lg" disabled={busy} onClick={onMove}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {KOT_ACTION_LABELS[next]}
        </Button>
      )}
    </article>
  )
}
