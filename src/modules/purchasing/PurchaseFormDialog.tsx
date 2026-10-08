import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  UNIT_LABELS,
  costOfQuantity,
  formatQuantity,
  parseQuantity,
  type InventoryItem
} from '@shared/inventory'
import {
  createPurchaseInputSchema,
  updatePurchaseInputSchema,
  type Purchase
} from '@shared/purchasing'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney, paiseToInput, parseOptionalRupees, parseRupees } from '@/lib/money'
import { INVENTORY_KEYS } from '@/modules/inventory/hooks'
import { inventoryService } from '@/services/inventory.service'
import { purchaseService, supplierService } from '@/services/purchasing.service'
import { PURCHASING_KEYS, todayInput, useRefreshPurchasing } from './hooks'

interface PurchaseFormDialogProps {
  open: boolean
  /** The draft being edited; null starts a new purchase. */
  purchase: Purchase | null
  onClose: () => void
  /** Called with the saved purchase, after the lists have been refreshed. */
  onSaved: (purchase: Purchase) => void
}

interface LineDraft {
  key: number
  inventoryItemId: string
  quantity: string
  unitCost: string
}

/** Start or edit a purchase draft: supplier, invoice details and what was bought at what price. */
export function PurchaseFormDialog({ open, purchase, onClose, onSaved }: PurchaseFormDialogProps) {
  return (
    <Dialog
      open={open}
      title={purchase ? `Edit ${purchase.purchaseNumber}` : 'New purchase'}
      description="A draft changes nothing in stock until you receive it."
      onClose={onClose}
      className="max-w-3xl"
    >
      <PurchaseForm
        key={purchase?.id ?? 'new'}
        purchase={purchase}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Dialog>
  )
}

function PurchaseForm({ purchase, onClose, onSaved }: Omit<PurchaseFormDialogProps, 'open'>) {
  const refresh = useRefreshPurchasing()
  const suppliers = useQuery({
    queryKey: PURCHASING_KEYS.suppliers({ includeInactive: true }),
    queryFn: () => supplierService.list({ includeInactive: true }),
    staleTime: 0
  })
  const items = useQuery({
    queryKey: INVENTORY_KEYS.list({}),
    queryFn: () => inventoryService.list({}),
    staleTime: 0
  })

  const [values, setValues] = useState({
    supplierId: purchase?.supplierId ?? '',
    purchaseDate: purchase?.purchaseDate ?? todayInput(),
    invoiceNumber: purchase?.invoiceNumber ?? '',
    notes: purchase?.notes ?? '',
    discount: purchase && purchase.discount > 0 ? paiseToInput(purchase.discount) : '',
    tax: purchase && purchase.tax > 0 ? paiseToInput(purchase.tax) : ''
  })
  const [lines, setLines] = useState<LineDraft[]>(
    purchase
      ? purchase.lines.map((line, index) => ({
          key: index,
          inventoryItemId: line.inventoryItemId,
          quantity: formatQuantity(line.quantity),
          unitCost: paiseToInput(line.unitCost)
        }))
      : [{ key: 0, inventoryItemId: '', quantity: '', unitCost: '' }]
  )
  const [nextKey, setNextKey] = useState(lines.length)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const done = async (saved: Purchase): Promise<void> => {
    await refresh()
    onSaved(saved)
  }
  const create = useMutation({ mutationFn: purchaseService.create, onSuccess: done })
  const update = useMutation({ mutationFn: purchaseService.update, onSuccess: done })
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  const itemById = new Map<string, InventoryItem>((items.data ?? []).map((item) => [item.id, item]))
  // Items on a draft that have since been retired stay selectable so the draft still shows.
  const pickable = (items.data ?? []).filter((item) => item.isActive)
  const supplierChoices = (suppliers.data ?? []).filter(
    (supplier) => supplier.isActive || supplier.id === purchase?.supplierId
  )

  const text =
    (key: keyof typeof values) =>
    (event: { target: { value: string } }): void => {
      setValues((current) => ({ ...current, [key]: event.target.value }))
    }
  const setLine = (key: number, patch: Partial<LineDraft>): void => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }
  const chooseItem = (key: number, inventoryItemId: string): void => {
    const item = itemById.get(inventoryItemId)
    setLine(key, {
      inventoryItemId,
      ...(item && item.unitCost > 0 ? { unitCost: paiseToInput(item.unitCost) } : {})
    })
  }
  const addLine = (): void => {
    setLines((current) => [
      ...current,
      { key: nextKey, inventoryItemId: '', quantity: '', unitCost: '' }
    ])
    setNextKey(nextKey + 1)
  }
  const removeLine = (key: number): void => {
    setLines((current) =>
      current.length > 1 ? current.filter((line) => line.key !== key) : current
    )
  }

  const lineTotal = (line: LineDraft): number | null => {
    const quantity = parseQuantity(line.quantity)
    const unitCost = parseRupees(line.unitCost)
    if (quantity === null || Number.isNaN(unitCost)) return null
    return costOfQuantity(quantity, unitCost)
  }
  const subtotal = lines.reduce((sum, line) => sum + (lineTotal(line) ?? 0), 0)
  const discount = parseOptionalRupees(values.discount)
  const tax = parseOptionalRupees(values.tax)
  const total = subtotal - (Number.isNaN(discount) ? 0 : discount) + (Number.isNaN(tax) ? 0 : tax)

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const problems: Record<string, string> = {}
    if (Number.isNaN(discount)) problems.discount = 'Enter an amount in rupees.'
    if (Number.isNaN(tax)) problems.tax = 'Enter an amount in rupees.'
    const payloadLines: { inventoryItemId: string; quantity: number; unitCost: number }[] = []
    lines.forEach((line, index) => {
      const quantity = parseQuantity(line.quantity)
      const unitCost = parseRupees(line.unitCost)
      if (!line.inventoryItemId) problems[`lines.${String(index)}.item`] = 'Choose an item.'
      if (quantity === null || quantity <= 0) {
        problems[`lines.${String(index)}.quantity`] = 'Enter a quantity.'
      }
      if (Number.isNaN(unitCost)) problems[`lines.${String(index)}.unitCost`] = 'Enter a price.'
      if (line.inventoryItemId && quantity !== null && !Number.isNaN(unitCost)) {
        payloadLines.push({ inventoryItemId: line.inventoryItemId, quantity, unitCost })
      }
    })
    if (Object.keys(problems).length > 0) {
      setErrors(problems)
      return
    }
    const base = {
      supplierId: values.supplierId,
      purchaseDate: values.purchaseDate,
      invoiceNumber: values.invoiceNumber,
      notes: values.notes,
      discount,
      tax,
      lines: payloadLines
    }
    const parsed = purchase
      ? updatePurchaseInputSchema.safeParse({ id: purchase.id, ...base })
      : createPurchaseInputSchema.safeParse(base)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    if (purchase) {
      update.mutate({ ...parsed.data, id: purchase.id })
    } else {
      create.mutate(parsed.data)
    }
  }

  if (suppliers.isPending || items.isPending) return <Skeleton className="h-64 w-full" />

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Supplier" required error={errors.supplierId}>
          {(c) => (
            <Select {...c} value={values.supplierId} onChange={text('supplierId')}>
              <option value="">Choose a supplier</option>
              {supplierChoices.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Purchase date" required error={errors.purchaseDate}>
          {(c) => (
            <Input {...c} type="date" value={values.purchaseDate} onChange={text('purchaseDate')} />
          )}
        </Field>
        <Field label="Supplier's invoice no." error={errors.invoiceNumber}>
          {(c) => <Input {...c} value={values.invoiceNumber} onChange={text('invoiceNumber')} />}
        </Field>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Items bought</div>
        {errors.lines && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errors.lines}
          </p>
        )}
        <div className="space-y-2">
          {lines.map((line, index) => {
            const item = itemById.get(line.inventoryItemId)
            const unit = item ? UNIT_LABELS[item.unit] : ''
            const amount = lineTotal(line)
            const prefix = `lines.${String(index)}`
            const itemError = errors[`${prefix}.item`] ?? errors[`${prefix}.inventoryItemId`]
            return (
              <div
                key={line.key}
                className="grid grid-cols-[1fr_7rem_8rem_6rem_auto] items-start gap-2"
              >
                <Field label={index === 0 ? 'Item' : ''} error={itemError} className="min-w-0">
                  {(c) => (
                    <Select
                      {...c}
                      aria-label={`Item ${String(index + 1)}`}
                      value={line.inventoryItemId}
                      onChange={(event) => {
                        chooseItem(line.key, event.target.value)
                      }}
                    >
                      <option value="">Choose an item</option>
                      {pickable.map((entry) => (
                        <option
                          key={entry.id}
                          value={entry.id}
                          disabled={lines.some(
                            (other) => other.key !== line.key && other.inventoryItemId === entry.id
                          )}
                        >
                          {entry.name} ({UNIT_LABELS[entry.unit]})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  label={index === 0 ? `Quantity${unit ? ` (${unit})` : ''}` : ''}
                  error={errors[`${prefix}.quantity`]}
                >
                  {(c) => (
                    <Input
                      {...c}
                      aria-label={`Quantity ${String(index + 1)}`}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => {
                        setLine(line.key, { quantity: event.target.value })
                      }}
                    />
                  )}
                </Field>
                <Field
                  label={index === 0 ? `Price${unit ? ` per ${unit}` : ''} (₹)` : ''}
                  error={errors[`${prefix}.unitCost`]}
                >
                  {(c) => (
                    <Input
                      {...c}
                      aria-label={`Price ${String(index + 1)}`}
                      inputMode="decimal"
                      value={line.unitCost}
                      onChange={(event) => {
                        setLine(line.key, { unitCost: event.target.value })
                      }}
                    />
                  )}
                </Field>
                <div className="space-y-1.5">
                  {index === 0 && <div className="text-sm font-medium">Amount</div>}
                  <div className="flex h-10 items-center justify-end text-sm font-medium touch:h-12">
                    {amount === null ? '—' : formatMoney(amount)}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {index === 0 && <div className="text-sm">&nbsp;</div>}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove item ${String(index + 1)}`}
                    disabled={lines.length === 1}
                    onClick={() => {
                      removeLine(line.key)
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          <Plus /> Add item
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
        <div className="space-y-3">
          <Field label="Notes" error={errors.notes}>
            {(c) => <Input {...c} value={values.notes} onChange={text('notes')} />}
          </Field>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Items total</span>
            <span>{formatMoney(subtotal)}</span>
          </div>
          <Field label="Discount (₹)" error={errors.discount}>
            {(c) => (
              <Input
                {...c}
                inputMode="decimal"
                value={values.discount}
                onChange={text('discount')}
              />
            )}
          </Field>
          <Field label="Tax / freight (₹)" error={errors.tax}>
            {(c) => <Input {...c} inputMode="decimal" value={values.tax} onChange={text('tax')} />}
          </Field>
          <div className="flex justify-between border-t pt-2 text-base font-bold">
            <span>Total</span>
            <span data-testid="purchase-form-total">{formatMoney(Math.max(total, 0))}</span>
          </div>
        </div>
      </div>

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
          {purchase ? 'Save draft' : 'Create draft'}
        </Button>
      </div>
    </form>
  )
}
