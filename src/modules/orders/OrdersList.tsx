import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  ORDER_TYPES,
  type OrderSummary,
  type OrderType
} from '@shared/orders'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney } from '@/lib/money'
import { toUserMessage } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useDebouncedValue } from '@/modules/menu/hooks'
import { useNow } from '@/modules/tables/hooks'
import { formatElapsed } from '@/modules/tables/table-time'
import { orderService } from '@/services/orders.service'
import { ORDER_KEYS, ORDER_REFRESH_MS } from './hooks'
import { ORDER_STATUS_TONE } from './order-status'

type Scope = 'ACTIVE' | 'CLOSED'

function where(order: OrderSummary): string {
  if (order.type === 'DINE_IN') {
    return order.tableName ?? order.tableNumber ?? 'Table'
  }
  return order.customerName ?? order.customerPhone ?? ORDER_TYPE_LABELS[order.type]
}

/** The Orders tab of the POS home: every open order (or the finished ones) at a glance. */
export function OrdersList() {
  const navigate = useNavigate()
  const now = useNow()
  const [scope, setScope] = useState<Scope>('ACTIVE')
  const [type, setType] = useState<'ALL' | OrderType>('ALL')
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())

  const filter = {
    ...(scope === 'ACTIVE'
      ? { activeOnly: true }
      : { statuses: ['COMPLETED', 'CANCELLED'] as ('COMPLETED' | 'CANCELLED')[] }),
    ...(type === 'ALL' ? {} : { type }),
    ...(term === '' ? {} : { search: term }),
    limit: 100
  }
  const orders = useQuery({
    queryKey: ORDER_KEYS.list(filter),
    queryFn: () => orderService.list(filter),
    refetchInterval: ORDER_REFRESH_MS,
    staleTime: 0
  })

  const chip = (active: boolean) =>
    cn(
      'h-9 rounded-full border px-4 text-sm font-semibold transition-colors touch:h-11',
      active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'
    )

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2" role="group" aria-label="Order scope">
          <button
            type="button"
            aria-pressed={scope === 'ACTIVE'}
            className={chip(scope === 'ACTIVE')}
            onClick={() => {
              setScope('ACTIVE')
            }}
          >
            Open
          </button>
          <button
            type="button"
            aria-pressed={scope === 'CLOSED'}
            className={chip(scope === 'CLOSED')}
            onClick={() => {
              setScope('CLOSED')
            }}
          >
            Finished
          </button>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Order type">
          <button
            type="button"
            aria-pressed={type === 'ALL'}
            className={chip(type === 'ALL')}
            onClick={() => {
              setType('ALL')
            }}
          >
            All types
          </button>
          {ORDER_TYPES.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={type === entry}
              className={chip(type === entry)}
              onClick={() => {
                setType(entry)
              }}
            >
              {ORDER_TYPE_LABELS[entry]}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-60">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-8"
            placeholder="Order no, name or phone"
            aria-label="Search orders"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>
      </div>

      {orders.isPending && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      {orders.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(orders.error)}
        </p>
      )}
      {orders.data?.length === 0 && (
        <p className="rounded-lg border border-dashed bg-card/50 px-6 py-14 text-center text-sm text-muted-foreground">
          {scope === 'ACTIVE' ? 'No open orders right now.' : 'No finished orders match.'}
        </p>
      )}

      {orders.data && orders.data.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Orders">
          {orders.data.map((order) => (
            <li key={order.id}>
              <button
                type="button"
                data-order-number={order.orderNumber}
                onClick={() => {
                  void navigate(`/pos/orders/${order.id}`)
                }}
                className="flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-sm transition hover:border-primary hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-bold">{order.orderNumber}</span>
                  <Badge variant={ORDER_STATUS_TONE[order.status]}>
                    {ORDER_STATUS_LABELS[order.status]}
                  </Badge>
                </span>
                <span className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{ORDER_TYPE_LABELS[order.type]}</span>
                    <span className="text-muted-foreground"> · {where(order)}</span>
                  </span>
                  <span className="shrink-0 font-bold">{formatMoney(order.subtotal)}</span>
                </span>
                <span className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'} ·{' '}
                    {order.createdByName}
                  </span>
                  <span>
                    {scope === 'ACTIVE'
                      ? formatElapsed(order.createdAt, now)
                      : new Date(order.updatedAt).toLocaleString()}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
