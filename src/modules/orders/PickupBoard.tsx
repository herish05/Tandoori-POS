import { useMutation, useQuery } from '@tanstack/react-query'
import { Truck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  orderStatusLabelFor,
  ORDER_TYPE_LABELS,
  type OrderStatus,
  type OrderSummary
} from '@shared/orders'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useNow } from '@/modules/tables/hooks'
import { orderService } from '@/services/orders.service'
import { usePermission } from '@/stores/auth.store'
import { DispatchDialog } from './DispatchDialog'
import { ORDER_KEYS, ORDER_REFRESH_MS, useRefreshOrders } from './hooks'
import { ORDER_STATUS_TONE } from './order-status'

type Column = 'KITCHEN' | 'READY' | 'OUT' | 'DONE'

const COLUMNS: { id: Column; title: string }[] = [
  { id: 'KITCHEN', title: 'In the kitchen' },
  { id: 'READY', title: 'Ready' },
  { id: 'OUT', title: 'Out for delivery' },
  { id: 'DONE', title: 'Delivered / handed over' }
]

const KITCHEN: readonly OrderStatus[] = ['DRAFT', 'CONFIRMED', 'KOT_PENDING', 'PREPARING']

function columnOf(order: OrderSummary): Column {
  if (KITCHEN.includes(order.status)) return 'KITCHEN'
  if (order.status === 'READY') return order.dispatchedAt ? 'OUT' : 'READY'
  return 'DONE'
}

/** Orders with a promised time come first, soonest first; the rest follow in order of arrival. */
function byPromise(a: OrderSummary, b: OrderSummary): number {
  if (a.promisedAt && b.promisedAt) return a.promisedAt.localeCompare(b.promisedAt)
  if (a.promisedAt) return -1
  if (b.promisedAt) return 1
  return a.createdAt.localeCompare(b.createdAt)
}

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The Pickup & delivery tab: every open takeaway, pickup and delivery order by stage. */
export function PickupBoard() {
  const navigate = useNavigate()
  const now = useNow()
  const canOperate = usePermission('orders.operate')
  const refresh = useRefreshOrders()
  const [dispatching, setDispatching] = useState<OrderSummary | null>(null)

  const orders = useQuery({
    queryKey: ORDER_KEYS.list({ board: true }),
    queryFn: () => orderService.list({ activeOnly: true, limit: 200 }),
    refetchInterval: ORDER_REFRESH_MS,
    staleTime: 0
  })

  const handOver = useMutation({
    mutationFn: (id: string) => orderService.setStatus({ id, status: 'SERVED' }),
    onSuccess: refresh
  })

  const open = (orders.data ?? []).filter((order) => order.type !== 'DINE_IN').sort(byPromise)

  const action = (order: OrderSummary) => {
    if (!canOperate) return null
    if (order.type === 'DELIVERY' && order.status === 'READY' && !order.dispatchedAt) {
      return (
        <Button
          size="sm"
          onClick={() => {
            setDispatching(order)
          }}
        >
          <Truck /> Send out
        </Button>
      )
    }
    if (order.status === 'READY' && (order.type !== 'DELIVERY' || order.dispatchedAt)) {
      return (
        <Button
          size="sm"
          variant="secondary"
          disabled={handOver.isPending}
          onClick={() => {
            handOver.mutate(order.id)
          }}
        >
          {order.type === 'DELIVERY' ? 'Delivered' : 'Handed over'}
        </Button>
      )
    }
    return null
  }

  return (
    <div className="space-y-3 px-5 py-4">
      {orders.isPending && <Skeleton className="h-48" />}
      {orders.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(orders.error)}
        </p>
      )}
      {handOver.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(handOver.error)}
        </p>
      )}
      {orders.data?.length !== undefined && open.length === 0 && (
        <p className="rounded-lg border border-dashed bg-card/50 px-6 py-14 text-center text-sm text-muted-foreground">
          No takeaway or delivery orders right now.
        </p>
      )}
      {open.length > 0 && (
        <div className="grid items-start gap-4 lg:grid-cols-4">
          {COLUMNS.map((column) => {
            const list = open.filter((order) => columnOf(order) === column.id)
            return (
              <section key={column.id} aria-label={column.title} className="space-y-2">
                <h2 className="flex items-center justify-between text-sm font-bold">
                  {column.title}
                  <span className="rounded-full bg-secondary px-2 text-xs text-muted-foreground">
                    {list.length}
                  </span>
                </h2>
                {list.map((order) => {
                  const late =
                    order.promisedAt !== null &&
                    column.id !== 'DONE' &&
                    new Date(order.promisedAt).getTime() < now
                  return (
                    <div
                      key={order.id}
                      data-order-number={order.orderNumber}
                      className={cn(
                        'space-y-2 rounded-lg border bg-card p-3 shadow-sm',
                        late && 'border-destructive'
                      )}
                    >
                      <button
                        type="button"
                        className="flex w-full flex-col gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          void navigate(`/pos/orders/${order.id}`)
                        }}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-bold">{order.orderNumber}</span>
                          <Badge variant={ORDER_STATUS_TONE[order.status]}>
                            {orderStatusLabelFor(order)}
                          </Badge>
                        </span>
                        <span className="truncate text-sm">
                          <span className="font-semibold">{ORDER_TYPE_LABELS[order.type]}</span>
                          <span className="text-muted-foreground">
                            {' '}
                            · {order.customerName ?? order.customerPhone ?? 'Customer'}
                          </span>
                        </span>
                        <span className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className={cn(late && 'font-semibold text-destructive')}>
                            {order.promisedAt
                              ? `${late ? 'Late \u00b7 ' : ''}by ${clock(order.promisedAt)}`
                              : 'ASAP'}
                          </span>
                          <span className="font-bold text-foreground">
                            {formatMoney(order.subtotal)}
                          </span>
                        </span>
                        {order.riderName && (
                          <span className="text-xs text-muted-foreground">
                            Rider: {order.riderName}
                          </span>
                        )}
                      </button>
                      {action(order)}
                    </div>
                  )
                })}
              </section>
            )
          })}
        </div>
      )}
      <DispatchDialog
        order={dispatching}
        onClose={() => {
          setDispatching(null)
        }}
      />
    </div>
  )
}
