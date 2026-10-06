import { z } from 'zod'

/**
 * Menu: kitchen stations, categories, tax categories, add-ons and items (with variants).
 * Shared by the renderer (instant feedback, labels) and the main process (the real checks).
 *
 * Money is always a whole number of paise (1 rupee = 100 paise), so prices never suffer
 * floating-point drift. Convert at the screen edge only.
 */

export const FOOD_TYPES = ['VEG', 'NON_VEG', 'EGG'] as const
export type FoodType = (typeof FOOD_TYPES)[number]

export const FOOD_TYPE_LABELS: Record<FoodType, string> = {
  VEG: 'Veg',
  NON_VEG: 'Non-veg',
  EGG: 'Egg'
}

/**
 * An ADDON is a priced extra ("Extra cheese"); a MODIFIER is a free preference
 * ("Less spicy", "No onion") and always costs nothing.
 */
export const ADDON_KINDS = ['ADDON', 'MODIFIER'] as const
export type AddonKind = (typeof ADDON_KINDS)[number]

export const ADDON_KIND_LABELS: Record<AddonKind, string> = {
  ADDON: 'Add-on',
  MODIFIER: 'Modifier'
}

/** Highest price accepted, in paise (Rs 1,00,000). */
export const MAX_PRICE_PAISE = 10_000_000
/** Highest tax rate accepted, in basis points (100% = 10000). */
export const MAX_TAX_RATE_BPS = 10_000
export const MAX_VARIANTS = 12
export const MAX_ITEM_ADDONS = 40

const IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+=*$/
/** Largest accepted item image, as a data URL (the screen shrinks pictures before sending). */
export const MAX_ITEM_IMAGE_LENGTH = 90_000

// --- Response shapes ---------------------------------------------------------------------

export interface KitchenStation {
  id: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  isDemo: boolean
  /** Active categories and items sending their tickets here. */
  usageCount: number
}

export interface MenuCategory {
  id: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  isDemo: boolean
  stationId: string | null
  stationName: string | null
  itemCount: number
}

export interface TaxCategory {
  id: string
  name: string
  /** Basis points: 500 = 5%. */
  rateBps: number
  isActive: boolean
  isDemo: boolean
  itemCount: number
}

export interface MenuAddon {
  id: string
  name: string
  kind: AddonKind
  /** Paise; always 0 for a modifier. */
  price: number
  isActive: boolean
  isDemo: boolean
  itemCount: number
}

export interface MenuVariant {
  id: string
  name: string
  price: number
  costPrice: number
  isDefault: boolean
  isAvailable: boolean
  sortOrder: number
}

export interface MenuItemAddon {
  id: string
  name: string
  kind: AddonKind
  price: number
  isActive: boolean
}

export interface MenuItem {
  id: string
  name: string
  description: string | null
  categoryId: string
  categoryName: string
  /** Paise. Used as is when the item has no variants; otherwise the variants carry the prices. */
  price: number
  costPrice: number
  foodType: FoodType
  image: string | null
  /** Quick "sold out" switch used during service. */
  isAvailable: boolean
  /** `false` once the item is retired from the menu. */
  isActive: boolean
  isBestSeller: boolean
  isDemo: boolean
  /** The station chosen for this item itself; null = follow the category. */
  stationId: string | null
  /** Where tickets really go: the item's own station, else its category's. */
  effectiveStationId: string | null
  effectiveStationName: string | null
  taxCategoryId: string | null
  taxCategoryName: string | null
  taxRateBps: number | null
  variants: MenuVariant[]
  addons: MenuItemAddon[]
}

export interface DemoMenuStatus {
  /** `false` in production builds: sample data can never be loaded there. */
  available: boolean
  loaded: boolean
  /** Number of sample items currently in the menu. */
  itemCount: number
}

export interface DemoRemoveResult {
  removedItems: number
  /** Sample categories/stations/taxes now used by your own items; they were kept as real data. */
  keptAsReal: number
}

// --- Validation --------------------------------------------------------------------------

const idSchema = z.uuid()

const requiredText = (label: string, max: number) =>
  z
    .string()
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

const optionalId = idSchema.nullish().transform((value) => value ?? null)

const sortOrder = z.number().int().min(0).max(999).default(0)

const money = (what: string) =>
  z
    .number(`Enter ${what}.`)
    .int('Use whole paise only.')
    .min(0, `${what.charAt(0).toUpperCase()}${what.slice(1)} cannot be negative.`)
    .max(MAX_PRICE_PAISE, `${what.charAt(0).toUpperCase()}${what.slice(1)} is too high.`)

export const setActiveMenuInputSchema = z.object({ id: idSchema, isActive: z.boolean() })
export const setAvailabilityInputSchema = z.object({ id: idSchema, isAvailable: z.boolean() })

// Kitchen stations
const stationFields = {
  name: requiredText('Station name', 60),
  description: optionalText('Description', 200),
  sortOrder
}
export const createStationInputSchema = z.object(stationFields)
export const updateStationInputSchema = z.object({ id: idSchema, ...stationFields })

// Categories
const categoryFields = {
  name: requiredText('Category name', 60),
  description: optionalText('Description', 200),
  sortOrder,
  stationId: optionalId
}
export const createCategoryInputSchema = z.object(categoryFields)
export const updateCategoryInputSchema = z.object({ id: idSchema, ...categoryFields })

// Tax categories
const taxFields = {
  name: requiredText('Tax name', 40),
  rateBps: z
    .number('Enter the tax rate.')
    .int('The rate can have at most two decimals.')
    .min(0, 'The rate cannot be negative.')
    .max(MAX_TAX_RATE_BPS, 'The rate cannot be more than 100%.')
}
export const createTaxCategoryInputSchema = z.object(taxFields)
export const updateTaxCategoryInputSchema = z.object({ id: idSchema, ...taxFields })

// Add-ons and modifiers
const addonFields = {
  name: requiredText('Name', 60),
  kind: z.enum(ADDON_KINDS),
  price: money('a price').default(0)
}
const modifiersAreFree = (value: { kind: AddonKind; price: number }, ctx: z.RefinementCtx) => {
  if (value.kind === 'MODIFIER' && value.price !== 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['price'],
      message: 'A modifier is free. Make it an add-on to charge for it.'
    })
  }
}
export const createAddonInputSchema = z.object(addonFields).superRefine(modifiersAreFree)
export const updateAddonInputSchema = z
  .object({ id: idSchema, ...addonFields })
  .superRefine(modifiersAreFree)

// Items and variants
const variantSchema = z.object({
  /** Present for a variant that already exists; absent for a new one. */
  id: idSchema.optional(),
  name: requiredText('Variant name', 40),
  price: money('the variant price'),
  costPrice: money('the variant cost price').default(0),
  isDefault: z.boolean().default(false),
  isAvailable: z.boolean().default(true)
})

const itemFields = {
  name: requiredText('Item name', 80),
  description: optionalText('Description', 300),
  categoryId: z.uuid('Choose a category.'),
  price: money('a price'),
  costPrice: money('a cost price').default(0),
  foodType: z.enum(FOOD_TYPES),
  image: z
    .string()
    .max(MAX_ITEM_IMAGE_LENGTH, 'The picture is too large.')
    .regex(IMAGE_PATTERN, 'The picture must be a PNG, JPEG or WebP image.')
    .nullish()
    .transform((value) => value ?? null),
  isAvailable: z.boolean().default(true),
  isBestSeller: z.boolean().default(false),
  stationId: optionalId,
  taxCategoryId: optionalId,
  variants: z.array(variantSchema).max(MAX_VARIANTS).default([]),
  addonIds: z.array(idSchema).max(MAX_ITEM_ADDONS).default([])
}

const checkItem = (
  value: { variants: { name: string; isDefault: boolean }[]; addonIds: string[] },
  ctx: z.RefinementCtx
) => {
  const names = new Set<string>()
  for (const [index, variant] of value.variants.entries()) {
    const key = variant.name.toLowerCase()
    if (names.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['variants', index, 'name'],
        message: 'Two variants cannot have the same name.'
      })
    }
    names.add(key)
  }
  if (value.variants.filter((variant) => variant.isDefault).length > 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['variants'],
      message: 'Only one variant can be the default.'
    })
  }
  if (new Set(value.addonIds).size !== value.addonIds.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['addonIds'],
      message: 'An add-on was chosen twice.'
    })
  }
}

export const createItemInputSchema = z.object(itemFields).superRefine(checkItem)
export const updateItemInputSchema = z
  .object({ id: idSchema, ...itemFields })
  .superRefine(checkItem)

export const itemFilterSchema = z.object({
  search: z.string().trim().max(80).optional(),
  categoryId: idSchema.optional(),
  foodType: z.enum(FOOD_TYPES).optional(),
  availability: z.enum(['AVAILABLE', 'UNAVAILABLE']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  bestSellerOnly: z.boolean().optional()
})

export type SetActiveMenuInput = z.input<typeof setActiveMenuInputSchema>
export type SetAvailabilityInput = z.input<typeof setAvailabilityInputSchema>
export type CreateStationInput = z.input<typeof createStationInputSchema>
export type UpdateStationInput = z.input<typeof updateStationInputSchema>
export type CreateCategoryInput = z.input<typeof createCategoryInputSchema>
export type UpdateCategoryInput = z.input<typeof updateCategoryInputSchema>
export type CreateTaxCategoryInput = z.input<typeof createTaxCategoryInputSchema>
export type UpdateTaxCategoryInput = z.input<typeof updateTaxCategoryInputSchema>
export type CreateAddonInput = z.input<typeof createAddonInputSchema>
export type UpdateAddonInput = z.input<typeof updateAddonInputSchema>
export type CreateItemInput = z.input<typeof createItemInputSchema>
export type UpdateItemInput = z.input<typeof updateItemInputSchema>
export type ItemFilterInput = z.input<typeof itemFilterSchema>

export type SetActiveMenuData = z.output<typeof setActiveMenuInputSchema>
export type SetAvailabilityData = z.output<typeof setAvailabilityInputSchema>
export type StationData = z.output<typeof createStationInputSchema>
export type UpdateStationData = z.output<typeof updateStationInputSchema>
export type CategoryData = z.output<typeof createCategoryInputSchema>
export type UpdateCategoryData = z.output<typeof updateCategoryInputSchema>
export type TaxCategoryData = z.output<typeof createTaxCategoryInputSchema>
export type UpdateTaxCategoryData = z.output<typeof updateTaxCategoryInputSchema>
export type AddonData = z.output<typeof createAddonInputSchema>
export type UpdateAddonData = z.output<typeof updateAddonInputSchema>
export type ItemData = z.output<typeof createItemInputSchema>
export type UpdateItemData = z.output<typeof updateItemInputSchema>
export type ItemFilterData = z.output<typeof itemFilterSchema>
