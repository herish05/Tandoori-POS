import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRightLeft,
  BellRing,
  CheckCheck,
  ChefHat,
  Loader2,
  Pencil,
  Receipt,
  RotateCcw,
  Save,
  XCircle
} from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  CANCELLABLE_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  createOrderInputSchema,
  EDITABLE_ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  ORDER_TYPES,
  updateOrderInputSchema,
  type OrderDetail,
  type OrderLine,
  type OrderStatus,
  type OrderType,
  type PosItem
} from '@shared/orders'
import type { SendOrderResult } from '@shared/kitchen'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { KotPreviewDialog } from '@/modules/kitchen/KotPreviewDialog'
import { OrderTickets } from '@/modules/kitchen/OrderTickets'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  addToCart,
  changeQuantity,
  toLineInput,
  type CartLine,
  type NewCartLine
} from '@/modules/orders/cart'
import { CatalogBrowser } from '@/modules/orders/CatalogBrowser'
import { ORDER_KEYS, ORDER_REFRESH_MS, useRefreshOrders } from '@/modules/orders/hooks'
import { ItemDialog } from '@/modules/orders/ItemDialog'
import { ORDER_STATUS_TONE } from '@/modules/orders/order-status'
import {
  detailsFromOrder,
  detailsToInput,
  EMPTY_DETAILS,
  type DetailsValues
} from '@/modules/orders/details'
import { OrderDetailsForm } from '@/modules/orders/OrderDetailsForm'
import { OrderPanel } from '@/modules/orders/OrderPanel'
import { ReasonDialog } from '@/modules/orders/ReasonDialog'
import { TABLE_KEYS } from '@/modules/tables/hooks'
import { TableTransferDialog } from '@/modules/tables/TableTransferDialog'
import { billService } from '@/services/billing.service'
import { orderService } from '@/services/orders.service'
import { tableService } from '@/services/tables.service'
import { usePermission } from '@/stores/auth.store'

/** Result of one save: the order as it is now, and a message if something only half worked. */
interface Outcome {
  order: OrderDetail
  notice?: string
  /** A ticket that could not be printed: shown on screen so it can still be printed by hand. */
  preview?: PreviewRequest
}

interface PreviewRequest {
  kotId: string
  reason: string | null
}

type Work = () => Promise<Outcome>

type Confirming = { kind: 'order' } | { kind: 'line'; line: OrderLine } | null

interface NewOrderSeed {
  type: OrderType
  tableId: string | null
  guests: string
}

const KITCHEN_STATUSES: readonly OrderStatus[] = ['CONFIRMED', 'KOT_PENDING', 'PREPARING', 'READY']

const isOrderType = (value: string | null): value is OrderType =>
  ORDER_TYPES.some((type) => type === value)

/** Turns the result of sending an order into what the screen shows; a failed print is never silent. */
function sendOutcome(result: SendOrderResult): Outcome {
  const failed = result.print.filter((outcome) => outcome.status === 'FAILED')
  const first = failed[0]
  if (!first) return { order: result.order }
  const names = failed.map((outcome) => outcome.kotNumber).join(', ')
  return {
    order: result.order,
    notice: `The order was sent to the kitchen, but ${names} could not be printed. The ticket is shown so it can be printed from this computer.`,
    preview: { kotId: first.kotId, reason: first.error }
  }
}

function previewFrom(state: unknown): PreviewRequest | null {
  if (typeof state === 'object' && state !== null && 'preview' in state) {
    const value = state.preview
    if (
      typeof value === 'object' &&
      value !== null &&
      'kotId' in value &&
      typeof value.kotId === 'string'
    ) {
      const reason = 'reason' in value && typeof value.reason === 'string' ? value.reason : null
      return { kotId: value.kotId, reason }
    }
  }
  return null
}

function noticeFrom(state: unknown): string | null {
  if (typeof state === 'object' && state !== null && 'notice' in state) {
    return typeof state.notice === 'string' ? state.notice : null
  }
  return null
}

/** Order screen: `/pos/orders/new?type=&table=&guests=` starts one, `/pos/orders/:id` opens one. */
export function OrderPage() {
  const { orderId } = useParams()
  return orderId ? <ExistingOrder id={orderId} /> : <NewOrder />
}

function NewOrder() {
  const [params] = useSearchParams()
  const requested = params.get('type')
  const type = isOrderType(requested) ? requested : 'TAKEAWAY'
  const tableId = type === 'DINE_IN' ? params.get('table') : null
  const seed: NewOrderSeed = { type, tableId, guests: params.get('guests') ?? '' }
  if (type === 'DINE_IN' && !tableId) {
    return <Missing message="Choose a table from the POS floor to start a dine-in order." />
  }
  return <OrderScreen order={null} seed={seed} />
}

function ExistingOrder({ id }: { id: string }) {
  const order = useQuery({
    queryKey: ORDER_KEYS.detail(id),
    queryFn: () => orderService.get(id),
    refetchInterval: ORDER_REFRESH_MS,
    staleTime: 0
  })
  if (order.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (order.isError) {
    return <Missing message={toUserMessage(order.error)} />
  }
  return <OrderScreen key={order.data.id} order={order.data} seed={null} />
}

function Missing({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-md space-y-4 px-6 py-20 text-center">
      <p className="text-base font-semibold">{message}</p>
      <Button asChild variant="outline">
        <Link to="/pos">Back to POS</Link>
      </Button>
    </div>
  )
}

function OrderScreen({ order, seed }: { order: OrderDetail | null; seed: NewOrderSeed | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const refresh = useRefreshOrders()
  const canOperate = usePermission('orders.operate')
  const canCancel = usePermission('orders.cancel')
  const canKitchen = usePermission('kitchen.operate')
  const canBill = usePermission('billing.operate')
  const canViewBills = usePermission('billing.view')
  const canTransfer = usePermission('tables.transfer')

  const [type, setType] = useState<OrderType>(order?.type ?? seed?.type ?? 'TAKEAWAY')
  const [details, setDetails] = useState<DetailsValues>(
    order ? detailsFromOrder(order) : { ...EMPTY_DETAILS, guests: seed?.guests ?? '' }
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [cart, setCart] = useState<CartLine[]>([])
  const [picked, setPicked] = useState<PosItem | null>(null)
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [editingDetails, setEditingDetails] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [notice, setNotice] = useState<string | null>(noticeFrom(location.state))
  const [preview, setPreview] = useState<PreviewRequest | null>(previewFrom(location.state))

  const status = order?.status ?? null
  const closed = status !== null && CLOSED_ORDER_STATUSES.includes(status)
  const editable = canOperate && (status === null || EDITABLE_ORDER_STATUSES.includes(status))
  const tableId = order?.tableId ?? seed?.tableId ?? null

  const catalog = useQuery({
    queryKey: ORDER_KEYS.catalog,
    queryFn: orderService.catalog,
    enabled: editable,
    staleTime: 15_000
  })
  const tables = useQuery({
    queryKey: TABLE_KEYS.list,
    queryFn: tableService.list,
    enabled: order === null && tableId !== null,
    retry: false
  })
  const tableLabel =
    order?.tableName ?? tables.data?.find((table) => table.id === tableId)?.displayName ?? 'Table'

  const act = useMutation({
    mutationFn: (work: Work) => work(),
    onSuccess: async ({ order: saved, notice: message, preview: toPreview }) => {
      queryClient.setQueryData(ORDER_KEYS.detail(saved.id), saved)
      await refresh()
      if (order === null) {
        void navigate(`/pos/orders/${saved.id}`, {
          replace: true,
          state: message || toPreview ? { notice: message, preview: toPreview } : null
        })
      } else {
        if (message) setNotice(message)
        if (toPreview) setPreview(toPreview)
      }
    }
  })
  const error = act.isError ? toUserMessage(act.error) : undefined

  const run = (work: Work, after?: () => void): void => {
    setNotice(null)
    act.mutate(work, {
      onSuccess: () => {
        after?.()
      }
    })
  }

  // --- Cart --------------------------------------------------------------------------------
  const addLine = (line: NewCartLine): void => {
    setCart((current) => addToCart(current, line))
  }

  const saveCart = async (target: OrderDetail): Promise<OrderDetail> => {
    const saved = await orderService.addItems({ orderId: target.id, lines: cart.map(toLineInput) })
    setCart([])
    return saved
  }

  /** Checks a brand-new order on this screen before bothering the server. */
  const validateNew = () => {
    const parsed = createOrderInputSchema.safeParse({
      type,
      tableId: type === 'DINE_IN' ? tableId : null,
      ...detailsToInput(type, details),
      lines: cart.map(toLineInput)
    })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return null
    }
    setErrors({})
    return parsed.data
  }

  const save = (): void => {
    if (order) {
      run(async () => ({ order: await saveCart(order) }))
      return
    }
    const input = validateNew()
    if (!input) return
    run(async () => ({ order: await orderService.create(input) }))
  }

  const send = (): void => {
    if (order) {
      run(async () => {
        const current = cart.length > 0 ? await saveCart(order) : order
        return sendOutcome(await orderService.send(current.id))
      })
      return
    }
    const input = validateNew()
    if (!input) return
    run(async () => {
      const created = await orderService.create(input)
      try {
        return sendOutcome(await orderService.send(created.id))
      } catch (failure) {
        return {
          order: created,
          notice: `Order ${created.orderNumber} was saved but could not be sent to the kitchen: ${toUserMessage(failure)}`
        }
      }
    })
  }

  const moveTo = (next: 'SERVED' | 'BILL_REQUESTED'): void => {
    if (!order) return
    run(async () => ({ order: await orderService.setStatus({ id: order.id, status: next }) }))
  }

  /** Makes the bill from the served order (the system works out every amount), then opens it. */
  const generateBill = (): void => {
    if (!order) return
    let billId = ''
    run(
      async () => {
        const bill = await billService.generate({ orderId: order.id })
        billId = bill.id
        return { order: await orderService.get(order.id) }
      },
      () => {
        void navigate(`/pos/bills/${billId}`)
      }
    )
  }

  const changeLine = (line: OrderLine, quantity: number): void => {
    if (!order) return
    run(async () => ({
      order: await orderService.updateLine({
        orderId: order.id,
        lineId: line.id,
        quantity,
        notes: line.notes
      })
    }))
  }

  const removeLine = (line: OrderLine): void => {
    if (!order) return
    run(async () => ({
      order: await orderService.removeLine({ orderId: order.id, lineId: line.id })
    }))
  }

  const confirmCancel = (reason: string): void => {
    if (!order || !confirming) return
    if (confirming.kind === 'line') {
      const { line } = confirming
      run(
        async () => ({
          order: await orderService.cancelLine({ orderId: order.id, lineId: line.id, reason })
        }),
        () => {
          setConfirming(null)
        }
      )
      return
    }
    run(
      async () => ({ order: await orderService.cancel({ id: order.id, reason }) }),
      () => {
        void navigate('/pos')
      }
    )
  }

  const saveDetails = (values: DetailsValues): Record<string, string> => {
    if (!order) return {}
    const parsed = updateOrderInputSchema.safeParse({
      id: order.id,
      ...detailsToInput(order.type, values)
    })
    if (!parsed.success) return fieldErrors(parsed.error)
    run(
      async () => ({ order: await orderService.update(parsed.data) }),
      () => {
        setEditingDetails(false)
      }
    )
    return {}
  }

  // --- What the buttons offer --------------------------------------------------------------
  const hasNew = cart.length > 0
  const unsent = order?.hasUnsentLines ?? false
  const busy = act.isPending
  const canSend = editable && (hasNew || unsent)
  const canServe =
    canOperate && status !== null && KITCHEN_STATUSES.includes(status) && !hasNew && !unsent
  const cancellable =
    status !== null &&
    CANCELLABLE_ORDER_STATUSES.includes(status) &&
    (status === 'DRAFT' ? canOperate : canCancel)

  const title = order ? order.orderNumber : 'New order'
  const where =
    type === 'DINE_IN'
      ? tableLabel
      : [order?.customerName, order?.customerPhone].filter(Boolean).join(' · ')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-2.5">
        <Button asChild variant="ghost" size="icon" aria-label="Back to POS">
          <Link to="/pos">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight" data-testid="order-title">
            {title}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {ORDER_TYPE_LABELS[type]}
            {where && ` · ${where}`}
            {order && ` · by ${order.createdByName}`}
          </p>
        </div>
        {status && <Badge variant={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABELS[status]}</Badge>}

        {order === null && type !== 'DINE_IN' && (
          <div className="ml-4 flex gap-1" role="group" aria-label="Order type">
            {ORDER_TYPES.filter((entry) => entry !== 'DINE_IN').map((entry) => (
              <button
                key={entry}
                type="button"
                aria-pressed={type === entry}
                onClick={() => {
                  setType(entry)
                  setErrors({})
                }}
                className={cn(
                  'h-9 rounded-full border px-4 text-sm font-semibold transition-colors touch:h-11',
                  type === entry
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-accent'
                )}
              >
                {ORDER_TYPE_LABELS[entry]}
              </button>
            ))}
          </div>
        )}

        {order && canTransfer && !closed && order.type === 'DINE_IN' && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setTransferring(true)
            }}
          >
            <ArrowRightLeft /> Shift / merge
          </Button>
        )}

        {order && canOperate && !closed && (
          <Button
            variant="outline"
            size="sm"
            className={cn(!(canTransfer && order.type === 'DINE_IN') && 'ml-auto')}
            onClick={() => {
              setEditingDetails(true)
            }}
          >
            <Pencil /> Details
          </Button>
        )}
      </div>

      {notice && (
        <p
          role="status"
          className="border-b bg-warning/10 px-4 py-2 text-sm font-medium text-warning"
        >
          {notice}
        </p>
      )}

      <div
        className={cn(
          'grid min-h-0 flex-1',
          editable ? 'grid-cols-[minmax(0,1fr)_24rem]' : 'grid-cols-[minmax(0,1fr)_28rem]'
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {editable ? (
            <>
              {catalog.isPending && (
                <div className="grid grid-cols-3 gap-3 p-4">
                  {Array.from({ length: 9 }, (_, i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
              )}
              {catalog.isError && (
                <p role="alert" className="p-4 text-sm font-medium text-destructive">
                  {toUserMessage(catalog.error)}
                </p>
              )}
              {catalog.data && <CatalogBrowser catalog={catalog.data} onPick={setPicked} />}
            </>
          ) : (
            <ReadOnlySummary order={order} canOperate={canOperate} />
          )}
        </div>

        <OrderPanel
          lines={order?.lines ?? []}
          cart={cart}
          editable={editable}
          canCancel={canCancel}
          busy={busy}
          onCartQuantity={(key, delta) => {
            setCart((current) => changeQuantity(current, key, delta))
          }}
          onCartRemove={(key) => {
            setCart((current) => current.filter((line) => line.key !== key))
          }}
          onLineQuantity={changeLine}
          onLineRemove={removeLine}
          onLineCancel={(line) => {
            act.reset()
            setConfirming({ kind: 'line', line })
          }}
        >
          {order === null && (
            <OrderDetailsForm type={type} values={details} errors={errors} onChange={setDetails} />
          )}
          {errors.lines && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errors.lines}
            </p>
          )}
          {order?.deliveryAddress && (
            <p className="text-xs text-muted-foreground">Deliver to: {order.deliveryAddress}</p>
          )}
          {order?.notes && <p className="text-xs text-muted-foreground">Note: {order.notes}</p>}
          {order && order.kots.length > 0 && (
            <OrderTickets
              kots={order.kots}
              canPrint={canOperate || canKitchen}
              canCancel={canCancel}
              onPreview={(kotId) => {
                setPreview({ kotId, reason: null })
              }}
            />
          )}
          {status === 'BILL_REQUESTED' && canOperate && (
            <p className="text-xs text-muted-foreground">
              {order?.bill
                ? 'A bill was generated. Cancel the bill to change items.'
                : 'The bill was requested. Reopen the order to change items.'}
            </p>
          )}
          {error && !confirming && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            {editable && (
              <Button variant="outline" disabled={busy || !hasNew} onClick={save}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Save />}
                Save order
              </Button>
            )}
            {editable && (
              <Button disabled={busy || !canSend} onClick={send}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ChefHat />}
                Send to kitchen
              </Button>
            )}
            {canServe && (
              <Button
                variant="secondary"
                className="col-span-2"
                disabled={busy}
                onClick={() => {
                  moveTo('SERVED')
                }}
              >
                <CheckCheck /> Mark served
              </Button>
            )}
            {order?.bill && canViewBills && (
              <Button asChild variant="outline" className="col-span-2">
                <Link to={`/pos/bills/${order.bill.id}`}>
                  <Receipt /> View bill {order.bill.billNumber} (
                  {formatMoney(order.bill.grandTotal)})
                </Link>
              </Button>
            )}
            {canBill &&
              !order?.bill &&
              !hasNew &&
              (status === 'SERVED' || status === 'BILL_REQUESTED') && (
                <Button className="col-span-2" disabled={busy} onClick={generateBill}>
                  <Receipt /> Generate bill
                </Button>
              )}
            {canOperate && !canBill && status === 'SERVED' && !hasNew && (
              <Button
                className="col-span-2"
                disabled={busy}
                onClick={() => {
                  moveTo('BILL_REQUESTED')
                }}
              >
                <Receipt /> Request bill
              </Button>
            )}
            {canOperate && status === 'BILL_REQUESTED' && !order?.bill && (
              <Button
                variant="secondary"
                className="col-span-2"
                disabled={busy}
                onClick={() => {
                  moveTo('SERVED')
                }}
              >
                <RotateCcw /> Reopen order
              </Button>
            )}
            {order === null && (
              <Button asChild variant="ghost" className="col-span-2">
                <Link to="/pos">Discard</Link>
              </Button>
            )}
            {cancellable && (
              <Button
                variant="ghost"
                className="col-span-2 text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => {
                  act.reset()
                  setConfirming({ kind: 'order' })
                }}
              >
                <XCircle /> Cancel order
              </Button>
            )}
            {order && status === 'SERVED' && hasNew && (
              <p className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
                <BellRing className="size-4" aria-hidden /> Send the new items before asking for the
                bill.
              </p>
            )}
          </div>
        </OrderPanel>
      </div>

      <KotPreviewDialog
        kotId={preview?.kotId ?? null}
        notice={preview?.reason ?? null}
        canPrint={canOperate || canKitchen}
        onClose={() => {
          setPreview(null)
        }}
      />

      <ItemDialog
        item={picked}
        onAdd={addLine}
        onClose={() => {
          setPicked(null)
        }}
      />

      <ReasonDialog
        open={confirming !== null}
        title={
          confirming?.kind === 'line' ? `Cancel ${confirming.line.name}?` : 'Cancel this order?'
        }
        message={
          confirming?.kind === 'line'
            ? 'The kitchen already has this item. It stays on the order, struck through, with your reason.'
            : status === 'DRAFT'
              ? 'The order is dropped and the table is freed.'
              : 'The whole order is cancelled and the table is freed. This cannot be undone.'
        }
        confirmLabel={confirming?.kind === 'line' ? 'Cancel item' : 'Cancel order'}
        required={confirming?.kind === 'line' || status !== 'DRAFT'}
        pending={busy}
        error={confirming ? error : undefined}
        onConfirm={confirmCancel}
        onClose={() => {
          setConfirming(null)
        }}
      />

      {order && (
        <TableTransferDialog
          open={transferring}
          order={order}
          mergeBlockedReason={
            hasNew ? 'Save or send the new items on screen before merging tables.' : undefined
          }
          onClose={() => {
            setTransferring(false)
          }}
          onDone={(result) => {
            setTransferring(false)
            queryClient.setQueryData(ORDER_KEYS.detail(result.order.id), result.order)
            if (result.order.id === order.id) setNotice(result.notice)
            else
              void navigate(`/pos/orders/${result.order.id}`, { state: { notice: result.notice } })
          }}
        />
      )}

      {order && (
        <DetailsDialog
          open={editingDetails}
          order={order}
          pending={busy}
          error={editingDetails ? error : undefined}
          onSave={saveDetails}
          onClose={() => {
            setEditingDetails(false)
          }}
        />
      )}
    </div>
  )
}

function ReadOnlySummary({
  order,
  canOperate
}: {
  order: OrderDetail | null
  canOperate: boolean
}) {
  if (!order) {
    return (
      <p className="px-6 py-16 text-center text-sm text-muted-foreground">
        Your role does not allow taking orders.
      </p>
    )
  }
  const rows: [string, string | null][] = [
    ['Status', ORDER_STATUS_LABELS[order.status]],
    ['Type', ORDER_TYPE_LABELS[order.type]],
    ['Table', order.tableName],
    ['Guests', order.guestCount === null ? null : String(order.guestCount)],
    ['Customer', order.customerName],
    ['Phone', order.customerPhone],
    ['Address', order.deliveryAddress],
    ['Notes', order.notes],
    ['Cancelled because', order.cancelReason],
    ['Subtotal', formatMoney(order.subtotal)]
  ]
  return (
    <div className="mx-auto max-w-md space-y-4 px-6 py-10">
      {!canOperate && (
        <p className="rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">
          You can view this order, but your role does not allow changing it.
        </p>
      )}
      <dl className="divide-y rounded-lg border bg-card text-sm">
        {rows
          .filter((row): row is [string, string] => row[1] !== null)
          .map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 px-4 py-2.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  )
}

interface DetailsDialogProps {
  open: boolean
  order: OrderDetail
  pending: boolean
  error: string | undefined
  onSave: (values: DetailsValues) => Record<string, string>
  onClose: () => void
}

function DetailsDialog({ open, order, pending, error, onSave, onClose }: DetailsDialogProps) {
  return (
    <Dialog open={open} title={`${order.orderNumber} details`} onClose={onClose}>
      <DetailsEditor
        order={order}
        pending={pending}
        error={error}
        onSave={onSave}
        onClose={onClose}
      />
    </Dialog>
  )
}

function DetailsEditor({
  order,
  pending,
  error,
  onSave,
  onClose
}: Omit<DetailsDialogProps, 'open'>) {
  const [values, setValues] = useState<DetailsValues>(detailsFromOrder(order))
  const [errors, setErrors] = useState<Record<string, string>>({})
  return (
    <div className="space-y-4">
      <OrderDetailsForm type={order.type} values={values} errors={errors} onChange={setValues} />
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            setErrors(onSave(values))
          }}
        >
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Save details
        </Button>
      </div>
    </div>
  )
}
