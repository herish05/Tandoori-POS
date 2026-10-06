import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { MAX_LINE_ADDONS, MAX_LINE_NOTES, MAX_LINE_QUANTITY, type PosItem } from '@shared/orders'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { FoodTypeMark } from '@/modules/menu/FoodTypeMark'
import type { NewCartLine } from './cart'

interface ItemDialogProps {
  item: PosItem | null
  onAdd: (line: NewCartLine) => void
  onClose: () => void
}

/** Size, extras, quantity and special instructions for one item, then "Add to order". */
export function ItemDialog({ item, onAdd, onClose }: ItemDialogProps) {
  return (
    <Dialog open={item !== null} title={item?.name ?? 'Item'} onClose={onClose}>
      {item && <ItemChoices key={item.id} item={item} onAdd={onAdd} onClose={onClose} />}
    </Dialog>
  )
}

function ItemChoices({
  item,
  onAdd,
  onClose
}: {
  item: PosItem
  onAdd: (line: NewCartLine) => void
  onClose: () => void
}) {
  const defaultVariant =
    item.variants.find((v) => v.isDefault && v.isAvailable) ??
    item.variants.find((v) => v.isAvailable) ??
    null
  const [variantId, setVariantId] = useState<string | null>(defaultVariant?.id ?? null)
  const [addonIds, setAddonIds] = useState<string[]>([])
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')

  const variant = item.variants.find((v) => v.id === variantId) ?? null
  const addons = item.addons.filter((addon) => addonIds.includes(addon.id))
  const extras = item.addons.filter((a) => a.kind === 'ADDON')
  const modifiers = item.addons.filter((a) => a.kind === 'MODIFIER')
  const unit =
    (variant?.price ?? item.price) +
    addons.reduce((sum, a) => sum + (a.kind === 'ADDON' ? a.price : 0), 0)

  const toggle = (id: string): void => {
    setAddonIds((current) =>
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : current.length >= MAX_LINE_ADDONS
          ? current
          : [...current, id]
    )
  }

  const add = (): void => {
    onAdd({ item, variant, addons, quantity, notes: notes.trim() })
    onClose()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <FoodTypeMark type={item.foodType} className="mt-0.5" />
        <p>{item.description ?? 'No description.'}</p>
      </div>

      {item.variants.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Size</legend>
          <div className="grid grid-cols-2 gap-2">
            {item.variants.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={!option.isAvailable}
                aria-pressed={variantId === option.id}
                onClick={() => {
                  setVariantId(option.id)
                }}
                className={cn(
                  'flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50',
                  variantId === option.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'bg-card hover:bg-accent'
                )}
              >
                <span>{option.name}</span>
                <span>{option.isAvailable ? formatMoney(option.price) : 'Sold out'}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {extras.length > 0 && (
        <AddonGroup title="Extras" addons={extras} selected={addonIds} onToggle={toggle} />
      )}
      {modifiers.length > 0 && (
        <AddonGroup title="Preferences" addons={modifiers} selected={addonIds} onToggle={toggle} />
      )}

      <div className="space-y-1.5">
        <label htmlFor="line-notes" className="text-sm font-semibold">
          Special instructions
        </label>
        <Textarea
          id="line-notes"
          rows={2}
          maxLength={MAX_LINE_NOTES}
          placeholder="For example: less spicy, no onion"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value)
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <div className="flex items-center gap-1" role="group" aria-label="Quantity">
          <Button
            variant="outline"
            size="icon"
            aria-label="Decrease quantity"
            disabled={quantity <= 1}
            onClick={() => {
              setQuantity((q) => Math.max(1, q - 1))
            }}
          >
            <Minus />
          </Button>
          <span className="w-10 text-center text-lg font-bold" aria-live="polite">
            {quantity}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Increase quantity"
            disabled={quantity >= MAX_LINE_QUANTITY}
            onClick={() => {
              setQuantity((q) => Math.min(MAX_LINE_QUANTITY, q + 1))
            }}
          >
            <Plus />
          </Button>
        </div>
        <Button
          size="lg"
          className="flex-1"
          disabled={variantId === null && item.variants.length > 0}
          onClick={add}
        >
          Add to order · {formatMoney(unit * quantity)}
        </Button>
      </div>
    </div>
  )
}

function AddonGroup({
  title,
  addons,
  selected,
  onToggle
}: {
  title: string
  addons: PosItem['addons']
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      {addons.map((addon) => (
        <label
          key={addon.id}
          className="flex cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent"
        >
          <input
            type="checkbox"
            className="size-4 accent-[hsl(var(--primary))]"
            checked={selected.includes(addon.id)}
            onChange={() => {
              onToggle(addon.id)
            }}
          />
          <span className="flex-1 font-medium">{addon.name}</span>
          {addon.kind === 'ADDON' && addon.price > 0 && (
            <span className="text-muted-foreground">+ {formatMoney(addon.price)}</span>
          )}
        </label>
      ))}
    </fieldset>
  )
}
