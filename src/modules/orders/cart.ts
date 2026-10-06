import {
  computeLineTotal,
  MAX_LINE_QUANTITY,
  type OrderLineInput,
  type PosAddon,
  type PosItem,
  type PosVariant
} from '@shared/orders'

/** A line the waiter has picked but not saved yet. Prices here are only for display. */
export interface CartLine {
  key: string
  item: PosItem
  variant: PosVariant | null
  addons: PosAddon[]
  quantity: number
  notes: string
}

export type NewCartLine = Omit<CartLine, 'key'>

/** Paise per unit: item (or chosen size) price plus priced add-ons. */
export function cartUnitPrice(line: Pick<CartLine, 'item' | 'variant' | 'addons'>): number {
  const base = line.variant?.price ?? line.item.price
  const extras = line.addons.reduce(
    (sum, addon) => sum + (addon.kind === 'ADDON' ? addon.price : 0),
    0
  )
  return base + extras
}

export function cartLineTotal(line: CartLine): number {
  const base = line.variant?.price ?? line.item.price
  const extras = cartUnitPrice(line) - base
  return computeLineTotal(base, extras, line.quantity)
}

export function cartTotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + cartLineTotal(line), 0)
}

export function cartCount(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0)
}

const sameAddons = (a: readonly PosAddon[], b: readonly PosAddon[]): boolean =>
  a.length === b.length && a.every((addon) => b.some((other) => other.id === addon.id))

/**
 * Adds a line to the cart. The same item with the same size, extras and instructions joins the
 * existing line instead of repeating.
 */
export function addToCart(lines: readonly CartLine[], line: NewCartLine): CartLine[] {
  const match = lines.find(
    (existing) =>
      existing.item.id === line.item.id &&
      existing.variant?.id === line.variant?.id &&
      existing.notes === line.notes &&
      sameAddons(existing.addons, line.addons)
  )
  if (!match) return [...lines, { ...line, key: crypto.randomUUID() }]
  return lines.map((existing) =>
    existing.key === match.key
      ? { ...existing, quantity: Math.min(MAX_LINE_QUANTITY, existing.quantity + line.quantity) }
      : existing
  )
}

/** Changes a line's quantity; a result below 1 removes the line. */
export function changeQuantity(lines: readonly CartLine[], key: string, delta: number): CartLine[] {
  return lines.flatMap((line) => {
    if (line.key !== key) return [line]
    const quantity = Math.min(MAX_LINE_QUANTITY, line.quantity + delta)
    return quantity < 1 ? [] : [{ ...line, quantity }]
  })
}

/** What the server is told: only what and how many; it works out the prices itself. */
export function toLineInput(line: CartLine): OrderLineInput {
  return {
    menuItemId: line.item.id,
    variantId: line.variant?.id ?? null,
    quantity: line.quantity,
    addonIds: line.addons.map((addon) => addon.id),
    notes: line.notes.trim() === '' ? null : line.notes
  }
}
