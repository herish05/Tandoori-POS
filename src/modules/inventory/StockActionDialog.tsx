import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  UNIT_LABELS,
  WASTAGE_REASONS,
  formatQuantity,
  parseQuantity,
  stockCountInputSchema,
  stockInInputSchema,
  wastageInputSchema,
  type InventoryItem
} from '@shared/inventory'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney, parseRupees } from '@/lib/money'
import { inventoryService } from '@/services/inventory.service'
import { useRefreshInventory } from './hooks'

export type StockAction = 'STOCK_IN' | 'WASTAGE' | 'COUNT'

interface StockActionDialogProps {
  open: boolean
  action: StockAction
  item: InventoryItem | null
  onClose: () => void
}

const TITLES: Record<StockAction, string> = {
  STOCK_IN: 'Stock in',
  WASTAGE: 'Record wastage',
  COUNT: 'Stock count'
}

const SUBMIT_LABELS: Record<StockAction, string> = {
  STOCK_IN: 'Add stock',
  WASTAGE: 'Record wastage',
  COUNT: 'Save count'
}

/** One small form for the three stock actions: receive stock, write off wastage, count the shelf. */
export function StockActionDialog({ open, action, item, onClose }: StockActionDialogProps) {
  return (
    <Dialog
      open={open && item !== null}
      title={item ? `${TITLES[action]}: ${item.name}` : TITLES[action]}
      onClose={onClose}
    >
      {item && (
        <StockActionForm
          key={`${item.id}:${action}`}
          action={action}
          item={item}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}

function StockActionForm({
  action,
  item,
  onClose
}: {
  action: StockAction
  item: InventoryItem
  onClose: () => void
}) {
  const refresh = useRefreshInventory()
  const unit = UNIT_LABELS[item.unit]
  const [quantity, setQuantity] = useState(action === 'COUNT' ? formatQuantity(item.onHand) : '')
  const [cost, setCost] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const done = async (): Promise<void> => {
    await refresh()
    onClose()
  }
  const stockIn = useMutation({ mutationFn: inventoryService.stockIn, onSuccess: done })
  const wastage = useMutation({ mutationFn: inventoryService.wastage, onSuccess: done })
  const count = useMutation({ mutationFn: inventoryService.count, onSuccess: done })
  const pending = stockIn.isPending || wastage.isPending || count.isPending
  const error = stockIn.error ?? wastage.error ?? count.error

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const milli = parseQuantity(quantity)
    if (milli === null) {
      setErrors({ quantity: 'Enter a number, up to 3 decimals.' })
      return
    }
    const failed = (parsed: { success: false; error: Parameters<typeof fieldErrors>[0] }): void => {
      setErrors(fieldErrors(parsed.error))
    }
    if (action === 'STOCK_IN') {
      const unitCost = cost.trim() === '' ? null : parseRupees(cost)
      if (unitCost !== null && Number.isNaN(unitCost)) {
        setErrors({ cost: 'Enter an amount in rupees.' })
        return
      }
      const parsed = stockInInputSchema.safeParse({
        itemId: item.id,
        quantity: milli,
        unitCost,
        reason
      })
      if (!parsed.success) {
        failed(parsed)
        return
      }
      setErrors({})
      stockIn.mutate(parsed.data)
      return
    }
    if (action === 'WASTAGE') {
      const parsed = wastageInputSchema.safeParse({ itemId: item.id, quantity: milli, reason })
      if (!parsed.success) {
        failed(parsed)
        return
      }
      setErrors({})
      wastage.mutate(parsed.data)
      return
    }
    const parsed = stockCountInputSchema.safeParse({ itemId: item.id, counted: milli, reason })
    if (!parsed.success) {
      failed(parsed)
      return
    }
    setErrors({})
    count.mutate(parsed.data)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">
        On hand now:{' '}
        <span className="font-semibold text-foreground">
          {formatQuantity(item.onHand)} {unit}
        </span>
        {item.unitCost > 0 && (
          <>
            {' '}
            at {formatMoney(item.unitCost)} per {unit}
          </>
        )}
      </p>
      <Field
        label={action === 'COUNT' ? `Counted on the shelf (${unit})` : `Quantity (${unit})`}
        required
        error={errors.quantity ?? errors.counted}
        hint={action === 'COUNT' ? 'The difference is booked as an adjustment.' : undefined}
      >
        {(c) => (
          <Input
            {...c}
            autoFocus
            inputMode="decimal"
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value)
            }}
          />
        )}
      </Field>
      {action === 'STOCK_IN' && (
        <Field
          label={`Price per ${unit} (₹)`}
          error={errors.cost}
          hint="Optional. When given, it becomes the cost of this item."
        >
          {(c) => (
            <Input
              {...c}
              inputMode="decimal"
              value={cost}
              onChange={(event) => {
                setCost(event.target.value)
              }}
            />
          )}
        </Field>
      )}
      <Field
        label={action === 'WASTAGE' ? 'Reason' : 'Note'}
        required={action === 'WASTAGE'}
        error={errors.reason}
      >
        {(c) => (
          <>
            <Input
              {...c}
              list={action === 'WASTAGE' ? 'wastage-reasons' : undefined}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
              }}
            />
            {action === 'WASTAGE' && (
              <datalist id="wastage-reasons">
                {WASTAGE_REASONS.map((entry) => (
                  <option key={entry} value={entry} />
                ))}
              </datalist>
            )}
          </>
        )}
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
          {SUBMIT_LABELS[action]}
        </Button>
      </div>
    </form>
  )
}
