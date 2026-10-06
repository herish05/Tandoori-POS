import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import {
  categories,
  kitchenStations,
  markModified,
  menuAddons,
  menuItemAddons,
  menuItems,
  menuVariants,
  taxCategories
} from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import type {
  ItemData,
  ItemFilterData,
  MenuItem,
  MenuItemAddon,
  MenuVariant,
  SetActiveMenuData,
  SetAvailabilityData,
  UpdateItemData
} from '@shared/menu'
import { requireAddon } from './addon-service'
import { requireCategory } from './category-service'
import { recordMenuAudit } from './common'
import { assertStationUsable } from './station-service'
import { assertTaxUsable } from './tax-service'

type ItemRow = typeof menuItems.$inferSelect
type VariantRow = typeof menuVariants.$inferSelect
type VariantInput = ItemData['variants'][number]

/** A variant as it will be stored: the default flag is settled and the order is its position. */
interface WantedVariant {
  id: string | undefined
  name: string
  price: number
  costPrice: number
  isDefault: boolean
  isAvailable: boolean
  sortOrder: number
}

const ITEM_FIELDS = [
  'name',
  'description',
  'categoryId',
  'price',
  'costPrice',
  'foodType',
  'image',
  'isAvailable',
  'isBestSeller',
  'stationId',
  'taxCategoryId'
] as const

/** Loads a live item or fails with NOT_FOUND. */
export function requireItem(db: DbExecutor, id: string): ItemRow {
  const row = db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.id, id), isNull(menuItems.deletedAt)))
    .get()
  if (!row) throw new AppError('NOT_FOUND', 'That menu item no longer exists.')
  return row
}

/** Exactly one variant is the default whenever there are variants; the order is the list order. */
function normaliseVariants(variants: readonly VariantInput[]): WantedVariant[] {
  const hasDefault = variants.some((variant) => variant.isDefault)
  return variants.map((variant, index) => ({
    id: variant.id,
    name: variant.name,
    price: variant.price,
    costPrice: variant.costPrice,
    isDefault: hasDefault ? variant.isDefault : index === 0,
    isAvailable: variant.isAvailable,
    sortOrder: index
  }))
}

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (match) => `\\${match}`)

export class ItemService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  list(filter: ItemFilterData = {}): MenuItem[] {
    const conditions: SQL[] = []
    if (filter.search) {
      const like = `%${escapeLike(filter.search)}%`
      conditions.push(
        sql`(${menuItems.name} like ${like} escape '\\'
          or ${menuItems.description} like ${like} escape '\\'
          or ${menuItems.categoryId} in (
            select ${categories.id} from ${categories} where ${categories.name} like ${like} escape '\\'
          ))`
      )
    }
    if (filter.categoryId) conditions.push(eq(menuItems.categoryId, filter.categoryId))
    if (filter.foodType) conditions.push(eq(menuItems.foodType, filter.foodType))
    if (filter.availability) {
      conditions.push(eq(menuItems.isAvailable, filter.availability === 'AVAILABLE'))
    }
    if (filter.status) conditions.push(eq(menuItems.isActive, filter.status === 'ACTIVE'))
    if (filter.bestSellerOnly) conditions.push(eq(menuItems.isBestSeller, true))
    return this.load(conditions)
  }

  create(auth: AuthContext, input: ItemData): MenuItem {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      this.assertReferences(tx, input, null)
      this.assertNameFree(tx, input.categoryId, input.name)

      const variants = normaliseVariants(input.variants)
      const base = this.basePrice(input, variants)
      const row = tx
        .insert(menuItems)
        .values({
          restaurantId,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
          price: base.price,
          costPrice: base.costPrice,
          foodType: input.foodType,
          image: input.image,
          isAvailable: input.isAvailable,
          isBestSeller: input.isBestSeller,
          stationId: input.stationId,
          taxCategoryId: input.taxCategoryId
        })
        .returning()
        .get()
      this.writeVariants(tx, row.id, variants, [])
      this.writeAddonLinks(tx, row.id, input.addonIds)
      recordMenuAudit(this.audit, tx, auth, 'menu.item.created', 'menu_item', row.id, {
        name: row.name,
        variants: variants.length,
        addons: input.addonIds.length
      })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateItemData): MenuItem {
    this.db.transaction((tx) => {
      const current = requireItem(tx, input.id)
      this.assertReferences(tx, input, current)
      this.assertNameFree(tx, input.categoryId, input.name, current.id)

      const existing = tx
        .select()
        .from(menuVariants)
        .where(and(eq(menuVariants.menuItemId, current.id), isNull(menuVariants.deletedAt)))
        .all()
      const known = new Set(existing.map((variant) => variant.id))
      const seen = new Set<string>()
      for (const variant of input.variants) {
        if (!variant.id) continue
        if (!known.has(variant.id)) {
          throw new AppError(
            'NOT_FOUND',
            'A variant of this item was changed elsewhere. Reload the item and try again.'
          )
        }
        if (seen.has(variant.id))
          throw new AppError('VALIDATION_ERROR', 'A variant was listed twice.')
        seen.add(variant.id)
      }

      const variants = normaliseVariants(input.variants)
      const base = this.basePrice(input, variants)
      const next = { ...input, price: base.price, costPrice: base.costPrice }

      const changed: string[] = ITEM_FIELDS.filter((field) => current[field] !== next[field])
      const variantsChanged = this.writeVariants(tx, current.id, variants, existing)
      const addonsChanged = this.writeAddonLinks(tx, current.id, input.addonIds)
      if (variantsChanged) changed.push('variants')
      if (addonsChanged) changed.push('addons')
      if (changed.length === 0) return

      tx.update(menuItems)
        .set({
          categoryId: next.categoryId,
          name: next.name,
          description: next.description,
          price: next.price,
          costPrice: next.costPrice,
          foodType: next.foodType,
          image: next.image,
          isAvailable: next.isAvailable,
          isBestSeller: next.isBestSeller,
          stationId: next.stationId,
          taxCategoryId: next.taxCategoryId,
          ...markModified(menuItems)
        })
        .where(eq(menuItems.id, current.id))
        .run()
      // Field names only: values (such as the picture) do not belong in the audit trail.
      recordMenuAudit(this.audit, tx, auth, 'menu.item.updated', 'menu_item', current.id, {
        name: next.name,
        changedFields: changed,
        ...(changed.includes('price') ? { priceFrom: current.price, priceTo: next.price } : {})
      })
    })
    return this.get(input.id)
  }

  /** Retiring an item keeps it in the database so past orders still make sense. */
  setActive(auth: AuthContext, input: SetActiveMenuData): MenuItem {
    this.db.transaction((tx) => {
      const current = requireItem(tx, input.id)
      if (current.isActive === input.isActive) return
      tx.update(menuItems)
        .set({ isActive: input.isActive, ...markModified(menuItems) })
        .where(eq(menuItems.id, current.id))
        .run()
      recordMenuAudit(
        this.audit,
        tx,
        auth,
        input.isActive ? 'menu.item.activated' : 'menu.item.deactivated',
        'menu_item',
        current.id,
        { name: current.name }
      )
    })
    return this.get(input.id)
  }

  /** The quick "sold out" switch used during service. */
  setAvailability(auth: AuthContext, input: SetAvailabilityData): MenuItem {
    this.db.transaction((tx) => {
      const current = requireItem(tx, input.id)
      if (current.isAvailable === input.isAvailable) return
      tx.update(menuItems)
        .set({ isAvailable: input.isAvailable, ...markModified(menuItems) })
        .where(eq(menuItems.id, current.id))
        .run()
      recordMenuAudit(
        this.audit,
        tx,
        auth,
        input.isAvailable ? 'menu.item.available' : 'menu.item.sold_out',
        'menu_item',
        current.id,
        { name: current.name }
      )
    })
    return this.get(input.id)
  }

  delete(auth: AuthContext, id: string): void {
    this.db.transaction((tx) => {
      const current = requireItem(tx, id)
      const now = new Date()
      tx.update(menuVariants)
        .set({ deletedAt: now, isDefault: false, ...markModified(menuVariants) })
        .where(and(eq(menuVariants.menuItemId, id), isNull(menuVariants.deletedAt)))
        .run()
      tx.delete(menuItemAddons).where(eq(menuItemAddons.menuItemId, id)).run()
      tx.update(menuItems)
        .set({ deletedAt: now, ...markModified(menuItems) })
        .where(eq(menuItems.id, id))
        .run()
      recordMenuAudit(this.audit, tx, auth, 'menu.item.deleted', 'menu_item', id, {
        name: current.name
      })
    })
  }

  // --- internals -------------------------------------------------------------------------

  private get(id: string): MenuItem {
    const found = this.load([eq(menuItems.id, id)])[0]
    if (!found) throw new AppError('NOT_FOUND', 'That menu item no longer exists.')
    return found
  }

  /** With variants, the item's own price is the default variant's, so lists and reports agree. */
  private basePrice(
    input: { price: number; costPrice: number },
    variants: WantedVariant[]
  ): { price: number; costPrice: number } {
    const fallback = variants.find((variant) => variant.isDefault)
    return fallback
      ? { price: fallback.price, costPrice: fallback.costPrice }
      : { price: input.price, costPrice: input.costPrice }
  }

  /** Category, station, tax and add-ons must exist and be usable (inactive ones only if already in use). */
  private assertReferences(tx: DbExecutor, input: ItemData, current: ItemRow | null): void {
    const category = requireCategory(tx, input.categoryId)
    if (!category.isActive && category.id !== current?.categoryId) {
      throw new AppError('CONFLICT', `The category "${category.name}" is inactive.`)
    }
    assertStationUsable(tx, input.stationId, current?.stationId ?? null)
    assertTaxUsable(tx, input.taxCategoryId, current?.taxCategoryId ?? null)

    const linked = new Set(
      current
        ? tx
            .select({ id: menuItemAddons.addonId })
            .from(menuItemAddons)
            .where(eq(menuItemAddons.menuItemId, current.id))
            .all()
            .map((row) => row.id)
        : []
    )
    for (const addonId of input.addonIds) {
      const addon = requireAddon(tx, addonId)
      if (!addon.isActive && !linked.has(addonId)) {
        throw new AppError('CONFLICT', `The add-on "${addon.name}" is inactive.`)
      }
    }
  }

  private assertNameFree(
    tx: DbExecutor,
    categoryId: string,
    name: string,
    exceptId?: string
  ): void {
    const clash = tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(
        and(
          eq(menuItems.categoryId, categoryId),
          isNull(menuItems.deletedAt),
          sql`lower(${menuItems.name}) = ${name.toLowerCase()}`,
          exceptId ? ne(menuItems.id, exceptId) : undefined
        )
      )
      .get()
    if (clash) {
      throw new AppError('CONFLICT', `This category already has an item named "${name}".`)
    }
  }

  /**
   * Brings the item's variants in line with `wanted`: removed ones are soft-deleted, kept ones
   * are updated in place (so their identity survives), new ones are inserted. Returns whether
   * anything changed.
   */
  private writeVariants(
    tx: DbExecutor,
    itemId: string,
    wanted: WantedVariant[],
    existing: VariantRow[]
  ): boolean {
    const byId = new Map(existing.map((variant) => [variant.id, variant]))
    const keptIds = new Set(wanted.flatMap((variant) => (variant.id ? [variant.id] : [])))
    let changed = false

    for (const variant of existing) {
      if (keptIds.has(variant.id)) continue
      tx.update(menuVariants)
        .set({ deletedAt: new Date(), isDefault: false, ...markModified(menuVariants) })
        .where(eq(menuVariants.id, variant.id))
        .run()
      changed = true
    }

    const differs = (variant: WantedVariant, row: VariantRow): boolean =>
      variant.name !== row.name ||
      variant.price !== row.price ||
      variant.costPrice !== row.costPrice ||
      variant.isDefault !== row.isDefault ||
      variant.isAvailable !== row.isAvailable ||
      variant.sortOrder !== row.sortOrder

    // Names and the default flag are unique per item, so variants that swap them need a
    // neutral value in between.
    for (const variant of wanted) {
      const row = variant.id ? byId.get(variant.id) : undefined
      if (row && (variant.name !== row.name || variant.isDefault !== row.isDefault)) {
        tx.update(menuVariants)
          .set({ name: `~${row.id}`, isDefault: false })
          .where(eq(menuVariants.id, row.id))
          .run()
      }
    }

    for (const variant of wanted) {
      const row = variant.id ? byId.get(variant.id) : undefined
      if (row) {
        if (!differs(variant, row)) continue
        tx.update(menuVariants)
          .set({
            name: variant.name,
            price: variant.price,
            costPrice: variant.costPrice,
            isDefault: variant.isDefault,
            isAvailable: variant.isAvailable,
            sortOrder: variant.sortOrder,
            ...markModified(menuVariants)
          })
          .where(eq(menuVariants.id, row.id))
          .run()
      } else {
        tx.insert(menuVariants)
          .values({
            menuItemId: itemId,
            name: variant.name,
            price: variant.price,
            costPrice: variant.costPrice,
            isDefault: variant.isDefault,
            isAvailable: variant.isAvailable,
            sortOrder: variant.sortOrder
          })
          .run()
      }
      changed = true
    }
    return changed
  }

  /** Replaces the item's add-on list when it differs. Returns whether it changed. */
  private writeAddonLinks(tx: DbExecutor, itemId: string, addonIds: string[]): boolean {
    const current = tx
      .select({ id: menuItemAddons.addonId })
      .from(menuItemAddons)
      .where(eq(menuItemAddons.menuItemId, itemId))
      .orderBy(asc(menuItemAddons.sortOrder))
      .all()
      .map((row) => row.id)
    if (
      current.length === addonIds.length &&
      current.every((id, index) => id === addonIds[index])
    ) {
      return false
    }
    tx.delete(menuItemAddons).where(eq(menuItemAddons.menuItemId, itemId)).run()
    for (const [index, addonId] of addonIds.entries()) {
      tx.insert(menuItemAddons).values({ menuItemId: itemId, addonId, sortOrder: index }).run()
    }
    return current.length > 0 || addonIds.length > 0
  }

  private load(conditions: SQL[]): MenuItem[] {
    const rows = this.db
      .select()
      .from(menuItems)
      .where(and(isNull(menuItems.deletedAt), ...conditions))
      .all()
    if (rows.length === 0) return []

    const categoryById = new Map(
      this.db
        .select()
        .from(categories)
        .where(isNull(categories.deletedAt))
        .all()
        .map((category) => [category.id, category])
    )
    const stationName = new Map(
      this.db
        .select({ id: kitchenStations.id, name: kitchenStations.name })
        .from(kitchenStations)
        .where(isNull(kitchenStations.deletedAt))
        .all()
        .map((station) => [station.id, station.name])
    )
    const taxById = new Map(
      this.db
        .select()
        .from(taxCategories)
        .where(isNull(taxCategories.deletedAt))
        .all()
        .map((tax) => [tax.id, tax])
    )

    const variantsByItem = new Map<string, MenuVariant[]>()
    const variantRows = this.db
      .select()
      .from(menuVariants)
      .where(isNull(menuVariants.deletedAt))
      .orderBy(asc(menuVariants.sortOrder), asc(menuVariants.name))
      .all()
    for (const row of variantRows) {
      const list = variantsByItem.get(row.menuItemId) ?? []
      list.push({
        id: row.id,
        name: row.name,
        price: row.price,
        costPrice: row.costPrice,
        isDefault: row.isDefault,
        isAvailable: row.isAvailable,
        sortOrder: row.sortOrder
      })
      variantsByItem.set(row.menuItemId, list)
    }

    const addonsByItem = new Map<string, MenuItemAddon[]>()
    const linkRows = this.db
      .select({ itemId: menuItemAddons.menuItemId, addon: menuAddons })
      .from(menuItemAddons)
      .innerJoin(menuAddons, eq(menuAddons.id, menuItemAddons.addonId))
      .where(isNull(menuAddons.deletedAt))
      .orderBy(asc(menuItemAddons.sortOrder))
      .all()
    for (const { itemId, addon } of linkRows) {
      const list = addonsByItem.get(itemId) ?? []
      list.push({
        id: addon.id,
        name: addon.name,
        kind: addon.kind,
        price: addon.price,
        isActive: addon.isActive
      })
      addonsByItem.set(itemId, list)
    }

    const items = rows.map((row): MenuItem => {
      const category = categoryById.get(row.categoryId)
      const tax = row.taxCategoryId ? taxById.get(row.taxCategoryId) : undefined
      const effectiveStationId = row.stationId ?? category?.stationId ?? null
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        categoryId: row.categoryId,
        categoryName: category?.name ?? 'Unknown category',
        price: row.price,
        costPrice: row.costPrice,
        foodType: row.foodType,
        image: row.image,
        isAvailable: row.isAvailable,
        isActive: row.isActive,
        isBestSeller: row.isBestSeller,
        isDemo: row.isDemo,
        stationId: row.stationId,
        effectiveStationId,
        effectiveStationName: effectiveStationId
          ? (stationName.get(effectiveStationId) ?? null)
          : null,
        taxCategoryId: row.taxCategoryId,
        taxCategoryName: tax?.name ?? null,
        taxRateBps: tax?.rateBps ?? null,
        variants: variantsByItem.get(row.id) ?? [],
        addons: addonsByItem.get(row.id) ?? []
      }
    })

    // Menu order: category order, then name.
    const order = (item: MenuItem): [number, string] => [
      categoryById.get(item.categoryId)?.sortOrder ?? 0,
      item.categoryName
    ]
    return items.sort((a, b) => {
      const [aOrder, aName] = order(a)
      const [bOrder, bName] = order(b)
      return (
        aOrder - bOrder || aName.localeCompare(bName, 'en') || a.name.localeCompare(b.name, 'en')
      )
    })
  }
}
