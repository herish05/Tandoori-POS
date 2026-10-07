import { Minus, Plus, Trash2, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { MAX_LINE_QUANTITY, type OrderLine } from '@shared/orders'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { FoodTypeMark } from '@/modules/menu/FoodTypeMark'
import { cartLineTotal, cartTotal, type CartLine } from './cart'

interface OrderPanelProps {
  lines: OrderLine[]
  cart: CartLine[]
  /** Items can be added, changed or removed. */
  editable: boolean
  /** The signed-in user may cancel items the kitchen already has. */
  canCancel: boolean
  busy: boolean
  onCartQuantity: (key: string, delta: number) => void
  onCartRemove: (key: string) => void
  onLineQuantity: (line: OrderLine, quantity: number) => void
  onLineRemove: (line: OrderLine) => void
  onLineCancel: (line: OrderLine) => void
  /** Details, messages and the action buttons shown under the totals. */
  children: ReactNode
}

function Stepper({
  quantity,
  label,
  disabled,
  onChange
}: {
  quantity: number
  label: string
  disabled: boolean
  onChange: (delta: number) => void
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`${label} quantity`}>
      <Button
        variant="outline"
        size="icon"
        className="size-8 touch:size-11"
        aria-label={`Decrease ${label}`}
        disabled={disabled || quantity <= 1}
        onClick={() => {
          onChange(-1)
        }}
      >
        <Minus />
      </Button>
      <span className="w-7 text-center text-sm font-bold touch:w-9 touch:text-lg">{quantity}</span>
      <Button
        variant="outline"
        size="icon"
        className="size-8 touch:size-11"
        aria-label={`Increase ${label}`}
        disabled={disabled || quantity >= MAX_LINE_QUANTITY}
        onClick={() => {
          onChange(1)
        }}
      >
        <Plus />
      </Button>
    </div>
  )
}

function Extras({ names, notes }: { names: string[]; notes: string | null }) {
  if (names.length === 0 && !notes) return null
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      {names.join(', ')}
      {names.length > 0 && notes ? ' · ' : ''}
      {notes && <span className="italic">“{notes}”</span>}
    </p>
  )
}

/** The order as one ticket: lines already saved, then the ones still being picked, and the total. */
export function OrderPanel({
  lines,
  cart,
  editable,
  canCancel,
  busy,
  onCartQuantity,
  onCartRemove,
  onLineQuantity,
  onLineRemove,
  onLineCancel,
  children
}: OrderPanelProps) {
  const live = lines.filter((line) => line.status !== 'CANCELLED')
  const savedTotal = live.reduce((sum, line) => sum + line.lineTotal, 0)
  const total = savedTotal + cartTotal(cart)
  const empty = lines.length === 0 && cart.length === 0

  return (
    <aside className="flex h-full min-h-0 flex-col border-l bg-card" aria-label="Order">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty && (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">
            No items yet. Pick something from the menu.
          </p>
        )}

        {lines.length > 0 && (
          <ul className="divide-y" aria-label="Items on the order">
            {lines.map((line) => {
              const cancelled = line.status === 'CANCELLED'
              return (
                <li
                  key={line.id}
                  data-line-status={line.status}
                  className={cn('px-4 py-3', cancelled && 'bg-secondary/40')}
                >
                  <div className="flex items-start gap-2">
                    <FoodTypeMark type={line.foodType} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-sm font-semibold',
                          cancelled && 'line-through opacity-60'
                        )}
                      >
                        {line.name}
                        {line.variantName && (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            ({line.variantName})
                          </span>
                        )}
                      </p>
                      <Extras names={line.addons.map((a) => a.name)} notes={line.notes} />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {cancelled
                          ? `Cancelled: ${line.cancelReason ?? 'no reason given'}`
                          : line.status === 'SENT'
                            ? 'Sent to kitchen'
                            : 'Saved, not sent yet'}
                      </p>
                    </div>
                    <span
                      className={cn('text-sm font-bold', cancelled && 'line-through opacity-60')}
                    >
                      {formatMoney(line.lineTotal)}
                    </span>
                  </div>
                  {!cancelled && (
                    <div className="mt-2 flex items-center justify-between gap-2 pl-6">
                      {line.status === 'NEW' && editable ? (
                        <>
                          <Stepper
                            quantity={line.quantity}
                            label={line.name}
                            disabled={busy}
                            onChange={(delta) => {
                              onLineQuantity(line, line.quantity + delta)
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label={`Remove ${line.name}`}
                            onClick={() => {
                              onLineRemove(line)
                            }}
                          >
                            <Trash2 /> Remove
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-medium">× {line.quantity}</span>
                          {line.status === 'SENT' && editable && canCancel && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              aria-label={`Cancel ${line.name}`}
                              onClick={() => {
                                onLineCancel(line)
                              }}
                            >
                              <XCircle /> Cancel item
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {cart.length > 0 && (
          <div>
            <p className="border-y bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-primary">
              New items, not saved yet
            </p>
            <ul className="divide-y" aria-label="New items">
              {cart.map((line) => (
                <li key={line.key} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <FoodTypeMark type={line.item.foodType} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {line.item.name}
                        {line.variant && (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            ({line.variant.name})
                          </span>
                        )}
                      </p>
                      <Extras
                        names={line.addons.map((a) => a.name)}
                        notes={line.notes === '' ? null : line.notes}
                      />
                    </div>
                    <span className="text-sm font-bold">{formatMoney(cartLineTotal(line))}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 pl-6">
                    <Stepper
                      quantity={line.quantity}
                      label={line.item.name}
                      disabled={false}
                      onChange={(delta) => {
                        onCartQuantity(line.key, delta)
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${line.item.name} from new items`}
                      onClick={() => {
                        onCartRemove(line.key)
                      }}
                    >
                      <Trash2 /> Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t bg-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">Subtotal</span>
          <span className="text-xl font-bold" data-testid="order-subtotal">
            {formatMoney(total)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Tax and discounts are added when the bill is made.
        </p>
        {children}
      </div>
    </aside>
  )
}
