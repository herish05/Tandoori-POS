import { z } from 'zod'

/**
 * Inventory: the raw materials the kitchen cooks with, the ledger of every change to their stock,
 * and the recipes that say how much of each a menu item uses. Shared by the renderer (instant
 * feedback) and the main process (the checks).
 *
 * Quantities are whole thousandths of the item's unit (2.5 kg is 2500), so stock never suffers
 * from floating point drift. Money is whole paise, and an item's cost is paise per whole unit.
 */

export const QUANTITY_SCALE = 1000
/** Largest quantity accepted in one entry: a million units. */
export const MAX_QUANTITY = 1_000_000 * QUANTITY_SCALE

export const INVENTORY_UNITS = ['KG', 'G', 'L', 'ML', 'PCS'] as const
export type InventoryUnit = (typeof INVENTORY_UNITS)[number]

export const UNIT_LABELS: Record<InventoryUnit, string> = {
  KG: 'kg',
  G: 'g',
  L: 'L',
  ML: 'ml',
  PCS: 'pcs'
}

export const MOVEMENT_TYPES = [
  'OPENING',
  'STOCK_IN',
  'ADJUSTMENT',
  'WASTAGE',
  'CONSUMPTION',
  'CONSUMPTION_REVERSAL'
] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  OPENING: 'Opening stock',
  STOCK_IN: 'Stock in',
  ADJUSTMENT: 'Stock count',
  WASTAGE: 'Wastage',
  CONSUMPTION: 'Used in orders',
  CONSUMPTION_REVERSAL: 'Order cancelled'
}

/** Suggestions for the wastage reason; any text is accepted. */
export const WASTAGE_REASONS = [
  'Spoiled',
  'Expired',
  'Spilled or dropped',
  'Over-prepared',
  'Staff meal',
  'Other'
] as const

/**
 * Stock is taken out when the kitchen ticket is issued. If the ticket is cancelled before the
 * cook has started it, the stock goes back. These are the ticket states where that still holds.
 */
export const RESTOCKABLE_KOT_STATUSES = ['NEW', 'ACCEPTED'] as const

// --- Helpers -------------------------------------------------------------------------------

/**
 * Reads what staff typed ("2", "2.5", "0.125") as thousandths, or null when it is not a number
 * with at most three decimals.
 */
export function parseQuantity(text: string): number | null {
  const clean = text.trim()
  if (!/^\d+(\.\d{1,3})?$/.test(clean)) return null
  const [whole = '0', fraction = ''] = clean.split('.')
  return Number(whole) * QUANTITY_SCALE + Number(fraction.padEnd(3, '0'))
}

/** Thousandths as plain text without trailing zeros: 2500 -> "2.5", -125 -> "-0.125". */
export function formatQuantity(milli: number): string {
  const sign = milli < 0 ? '-' : ''
  const abs = Math.abs(milli)
  const whole = Math.trunc(abs / QUANTITY_SCALE)
  const fraction = String(abs % QUANTITY_SCALE)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${sign}${String(whole)}${fraction ? `.${fraction}` : ''}`
}

/** The cost in paise of a quantity (in thousandths) of an item that costs `unitCost` per unit. */
export function costOfQuantity(milli: number, unitCost: number): number {
  return Math.round((milli * unitCost) / QUANTITY_SCALE)
}

// --- Response shapes -----------------------------------------------------------------------

export interface InventoryItem {
  id: string
  name: string
  unit: InventoryUnit
  category: string | null
  /** Thousandths of the unit. Can go below zero when more was used than was recorded. */
  onHand: number
  /** Thousandths. Stock at or under this is flagged low; 0 turns the warning off. */
  reorderLevel: number
  /** Paise per whole unit. */
  unitCost: number
  /** Paise: what the stock on hand is worth (never negative). */
  stockValue: number
  isActive: boolean
  isLow: boolean
  usedInRecipes: number
  lastMovementAt: string | null
  createdAt: string
}

export interface InventorySummary {
  activeItems: number
  lowItems: number
  outOfStockItems: number
  /** Paise. */
  stockValue: number
}

export interface StockMovement {
  id: string
  itemId: string
  itemName: string
  unit: InventoryUnit
  type: MovementType
  /** Thousandths; negative when stock went out. */
  quantity: number
  balanceAfter: number
  unitCost: number | null
  reason: string | null
  orderId: string | null
  orderNumber: string | null
  createdBy: string | null
  createdAt: string
}

export interface RecipeLine {
  id: string
  inventoryItemId: string
  itemName: string
  unit: InventoryUnit
  /** Thousandths of the ingredient used for one portion. */
  quantity: number
  /** Paise. */
  cost: number
}

/** The recipe of one size: `variantId` null is the recipe used by every size without its own. */
export interface RecipeScope {
  variantId: string | null
  variantName: string | null
  /** The menu price of one portion in paise. */
  price: number
  lines: RecipeLine[]
  /** Paise: the ingredients of one portion. */
  cost: number
}

export interface Recipe {
  menuItemId: string
  itemName: string
  scopes: RecipeScope[]
}

/** One row of the recipe list: which menu items have a recipe yet. */
export interface RecipeCoverage {
  menuItemId: string
  itemName: string
  categoryName: string
  isActive: boolean
  /** Ingredient lines over the item and all of its sizes. */
  lineCount: number
}

// --- Validation ----------------------------------------------------------------------------

const idSchema = z.uuid()

const requiredText = (label: string, max: number) =>
  z
    .string(`${label} is required.`)
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${String(max)} characters.`)

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${String(max)} characters.`)
    .nullish()
    .transform((value) => (value === null || value === undefined || value === '' ? null : value))

const quantity = (label: string) =>
  z
    .number(`${label} is required.`)
    .int(`${label} must be a whole number of thousandths.`)
    .min(1, `${label} must be more than zero.`)
    .max(MAX_QUANTITY, `${label} is too large.`)

const nonNegativeQuantity = (label: string) =>
  z
    .number(`${label} is required.`)
    .int(`${label} must be a whole number of thousandths.`)
    .min(0, `${label} cannot be negative.`)
    .max(MAX_QUANTITY, `${label} is too large.`)

const paise = (label: string) =>
  z
    .number(`${label} is required.`)
    .int(`${label} must be a whole number of paise.`)
    .min(0, `${label} cannot be negative.`)
    .max(100_000_000, `${label} is too large.`)

const itemFields = {
  name: requiredText('Name', 80),
  unit: z.enum(INVENTORY_UNITS, 'Choose a unit.'),
  category: optionalText('Category', 40),
  reorderLevel: nonNegativeQuantity('Reorder level').default(0),
  unitCost: paise('Cost').default(0)
}

export const createInventoryItemInputSchema = z.object({
  ...itemFields,
  /** Stock already on the shelf when the item is added. */
  openingStock: nonNegativeQuantity('Opening stock').default(0)
})
export const updateInventoryItemInputSchema = z.object({ id: idSchema, ...itemFields })
export const setInventoryItemActiveInputSchema = z.object({
  id: idSchema,
  isActive: z.boolean()
})

export const inventoryFilterSchema = z.object({
  search: z.string().trim().max(60).optional(),
  lowOnly: z.boolean().optional(),
  includeInactive: z.boolean().optional()
})

export const stockInInputSchema = z.object({
  itemId: idSchema,
  quantity: quantity('Quantity'),
  /** What this delivery cost per unit; it becomes the item's cost when given. */
  unitCost: paise('Cost').nullish(),
  reason: optionalText('Note', 200)
})

export const wastageInputSchema = z.object({
  itemId: idSchema,
  quantity: quantity('Quantity'),
  reason: requiredText('Reason', 200)
})

/** A stock count: what is really on the shelf. The difference is booked as an adjustment. */
export const stockCountInputSchema = z.object({
  itemId: idSchema,
  counted: nonNegativeQuantity('Counted stock'),
  reason: optionalText('Note', 200)
})

export const movementFilterSchema = z.object({
  itemId: idSchema.optional(),
  types: z.array(z.enum(MOVEMENT_TYPES)).max(MOVEMENT_TYPES.length).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(1000).optional()
})

export const recipeGetInputSchema = z.object({ menuItemId: idSchema })

export const setRecipeInputSchema = z
  .object({
    menuItemId: idSchema,
    /** Null sets the recipe shared by every size that has none of its own. */
    variantId: idSchema.nullable(),
    lines: z
      .array(
        z.object({
          inventoryItemId: idSchema,
          quantity: quantity('Quantity')
        })
      )
      .max(40, 'A recipe can have at most 40 ingredients.')
  })
  .refine(
    (input) => new Set(input.lines.map((line) => line.inventoryItemId)).size === input.lines.length,
    { message: 'Each ingredient can appear only once in a recipe.', path: ['lines'] }
  )

export type CreateInventoryItemInput = z.input<typeof createInventoryItemInputSchema>
export type UpdateInventoryItemInput = z.input<typeof updateInventoryItemInputSchema>
export type SetInventoryItemActiveInput = z.input<typeof setInventoryItemActiveInputSchema>
export type InventoryFilterInput = z.input<typeof inventoryFilterSchema>
export type StockInInput = z.input<typeof stockInInputSchema>
export type WastageInput = z.input<typeof wastageInputSchema>
export type StockCountInput = z.input<typeof stockCountInputSchema>
export type MovementFilterInput = z.input<typeof movementFilterSchema>
export type SetRecipeInput = z.input<typeof setRecipeInputSchema>

export type CreateInventoryItemData = z.output<typeof createInventoryItemInputSchema>
export type UpdateInventoryItemData = z.output<typeof updateInventoryItemInputSchema>
export type SetInventoryItemActiveData = z.output<typeof setInventoryItemActiveInputSchema>
export type InventoryFilterData = z.output<typeof inventoryFilterSchema>
export type StockInData = z.output<typeof stockInInputSchema>
export type WastageData = z.output<typeof wastageInputSchema>
export type StockCountData = z.output<typeof stockCountInputSchema>
export type MovementFilterData = z.output<typeof movementFilterSchema>
export type SetRecipeData = z.output<typeof setRecipeInputSchema>
