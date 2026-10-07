import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  INVENTORY_UNITS,
  UNIT_LABELS,
  createInventoryItemInputSchema,
  formatQuantity,
  parseQuantity,
  updateInventoryItemInputSchema,
  type InventoryItem
} from '@shared/inventory'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { paiseToInput, parseOptionalRupees } from '@/lib/money'
import { inventoryService } from '@/services/inventory.service'
import { useRefreshInventory } from './hooks'

interface ItemFormDialogProps {
  open: boolean
  /** The item being edited; null adds a new one. */
  item: InventoryItem | null
  onClose: () => void
}

/** Add or edit a stock item: name, unit, reorder level and cost. */
export function ItemFormDialog({ open, item, onClose }: ItemFormDialogProps) {
  return (
    <Dialog open={open} title={item ? 'Edit stock item' : 'New stock item'} onClose={onClose}>
      <ItemForm key={item?.id ?? 'new'} item={item} onClose={onClose} />
    </Dialog>
  )
}

function ItemForm({ item, onClose }: Omit<ItemFormDialogProps, 'open'>) {
  const refresh = useRefreshInventory()
  const [values, setValues] = useState({
    name: item?.name ?? '',
    unit: item?.unit ?? 'KG',
    category: item?.category ?? '',
    reorderLevel: item && item.reorderLevel > 0 ? formatQuantity(item.reorderLevel) : '',
    unitCost: item && item.unitCost > 0 ? paiseToInput(item.unitCost) : '',
    openingStock: ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const done = async (): Promise<void> => {
    await refresh()
    onClose()
  }
  const create = useMutation({ mutationFn: inventoryService.create, onSuccess: done })
  const update = useMutation({ mutationFn: inventoryService.update, onSuccess: done })
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error
  // The unit cannot change once stock has been recorded.
  const unitLocked = item !== null && item.lastMovementAt !== null

  const text =
    (key: keyof typeof values) =>
    (event: { target: { value: string } }): void => {
      setValues((current) => ({ ...current, [key]: event.target.value }))
    }

  const quantityOf = (value: string): number | null =>
    value.trim() === '' ? 0 : parseQuantity(value)

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const reorderLevel = quantityOf(values.reorderLevel)
    const openingStock = quantityOf(values.openingStock)
    const unitCost = parseOptionalRupees(values.unitCost)
    const problems: Record<string, string> = {}
    if (reorderLevel === null) problems.reorderLevel = 'Enter a number, up to 3 decimals.'
    if (!item && openingStock === null) problems.openingStock = 'Enter a number, up to 3 decimals.'
    if (Number.isNaN(unitCost)) problems.unitCost = 'Enter an amount in rupees.'
    if (reorderLevel === null || openingStock === null || Number.isNaN(unitCost)) {
      setErrors(problems)
      return
    }
    const base = {
      name: values.name,
      unit: values.unit,
      category: values.category,
      reorderLevel,
      unitCost
    }
    const parsed = item
      ? updateInventoryItemInputSchema.safeParse({ id: item.id, ...base })
      : createInventoryItemInputSchema.safeParse({ ...base, openingStock })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    if (item) {
      update.mutate(updateInventoryItemInputSchema.parse(parsed.data))
    } else {
      create.mutate(createInventoryItemInputSchema.parse(parsed.data))
    }
  }

  const unitLabel = UNIT_LABELS[values.unit]

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Name" required error={errors.name}>
        {(c) => <Input {...c} autoFocus value={values.name} onChange={text('name')} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Unit"
          required
          error={errors.unit}
          hint={unitLocked ? 'Fixed once stock has been recorded.' : undefined}
        >
          {(c) => (
            <Select {...c} disabled={unitLocked} value={values.unit} onChange={text('unit')}>
              {INVENTORY_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {UNIT_LABELS[unit]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Category" error={errors.category} hint="Dairy, Spices, Grains...">
          {(c) => <Input {...c} value={values.category} onChange={text('category')} />}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={`Reorder level (${unitLabel})`}
          error={errors.reorderLevel}
          hint="Flag as low at or below this. Leave empty for no warning."
        >
          {(c) => (
            <Input
              {...c}
              inputMode="decimal"
              value={values.reorderLevel}
              onChange={text('reorderLevel')}
            />
          )}
        </Field>
        <Field
          label={`Cost per ${unitLabel} (₹)`}
          error={errors.unitCost}
          hint="Updated by each stock in that has a price."
        >
          {(c) => (
            <Input {...c} inputMode="decimal" value={values.unitCost} onChange={text('unitCost')} />
          )}
        </Field>
      </div>
      {!item && (
        <Field
          label={`Opening stock (${unitLabel})`}
          error={errors.openingStock}
          hint="What is on the shelf today."
        >
          {(c) => (
            <Input
              {...c}
              inputMode="decimal"
              value={values.openingStock}
              onChange={text('openingStock')}
            />
          )}
        </Field>
      )}
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
          {item ? 'Save changes' : 'Add item'}
        </Button>
      </div>
    </form>
  )
}
