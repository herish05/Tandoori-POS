import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
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
import type { DemoMenuStatus, DemoRemoveResult } from '@shared/menu'
import { recordMenuAudit } from './common'
import { DEMO_ADDONS, DEMO_CATEGORIES, DEMO_ITEMS, DEMO_STATIONS, DEMO_TAXES } from './demo-data'

/**
 * Sample menu, kept apart from real data: only loadable on request, only outside production,
 * only into an empty menu, every row flagged `is_demo`, and removable again in one step.
 */
export class DemoMenuService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly allowed: boolean
  ) {}

  status(): DemoMenuStatus {
    const demoItems = this.db
      .select({ total: sql<number>`count(*)` })
      .from(menuItems)
      .where(and(isNull(menuItems.deletedAt), eq(menuItems.isDemo, true)))
      .get()
    const itemCount = demoItems?.total ?? 0
    return {
      available: this.allowed,
      loaded: itemCount > 0 || this.hasDemoRows(this.db),
      itemCount
    }
  }

  load(auth: AuthContext): DemoMenuStatus {
    this.assertAllowed()
    this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      if (this.hasDemoRows(tx)) {
        throw new AppError('CONFLICT', 'The sample menu is already loaded.')
      }
      if (this.hasRealRows(tx)) {
        throw new AppError(
          'CONFLICT',
          'The sample menu can only be loaded into an empty menu. Your menu already has its own data.'
        )
      }

      const stationId = new Map<string, string>()
      for (const station of DEMO_STATIONS) {
        const row = tx
          .insert(kitchenStations)
          .values({ restaurantId, isDemo: true, ...station })
          .returning({ id: kitchenStations.id })
          .get()
        stationId.set(station.name, row.id)
      }
      const taxId = new Map<string, string>()
      for (const tax of DEMO_TAXES) {
        const row = tx
          .insert(taxCategories)
          .values({ restaurantId, isDemo: true, ...tax })
          .returning({ id: taxCategories.id })
          .get()
        taxId.set(tax.name, row.id)
      }
      const categoryId = new Map<string, string>()
      for (const category of DEMO_CATEGORIES) {
        const row = tx
          .insert(categories)
          .values({
            restaurantId,
            isDemo: true,
            name: category.name,
            sortOrder: category.sortOrder,
            stationId: stationId.get(category.station) ?? null
          })
          .returning({ id: categories.id })
          .get()
        categoryId.set(category.name, row.id)
      }
      const addonId = new Map<string, string>()
      for (const addon of DEMO_ADDONS) {
        const row = tx
          .insert(menuAddons)
          .values({ restaurantId, isDemo: true, ...addon })
          .returning({ id: menuAddons.id })
          .get()
        addonId.set(addon.name, row.id)
      }
      for (const item of DEMO_ITEMS) {
        const category = categoryId.get(item.category)
        if (!category) throw new Error(`Sample data error: unknown category ${item.category}`)
        const row = tx
          .insert(menuItems)
          .values({
            restaurantId,
            isDemo: true,
            categoryId: category,
            name: item.name,
            description: item.description,
            price: item.price,
            costPrice: item.costPrice,
            foodType: item.foodType,
            isBestSeller: item.isBestSeller ?? false,
            taxCategoryId: taxId.get(item.tax) ?? null
          })
          .returning({ id: menuItems.id })
          .get()
        for (const [index, variant] of (item.variants ?? []).entries()) {
          tx.insert(menuVariants)
            .values({
              menuItemId: row.id,
              name: variant.name,
              price: variant.price,
              costPrice: variant.costPrice,
              isDefault: variant.isDefault ?? false,
              sortOrder: index
            })
            .run()
        }
        for (const [index, name] of item.addons.entries()) {
          const id = addonId.get(name)
          if (!id) throw new Error(`Sample data error: unknown add-on ${name}`)
          tx.insert(menuItemAddons)
            .values({ menuItemId: row.id, addonId: id, sortOrder: index })
            .run()
        }
      }

      recordMenuAudit(this.audit, tx, auth, 'menu.demo.loaded', 'menu', 'demo', {
        items: DEMO_ITEMS.length
      })
    })
    return this.status()
  }

  /** Removes the sample rows. Anything the restaurant has since built on top of them is kept. */
  remove(auth: AuthContext): DemoRemoveResult {
    this.assertAllowed()
    return this.db.transaction((tx) => {
      const now = new Date()
      let keptAsReal = 0

      // Items first: they are what everything else hangs on.
      const demoItemIds = tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(and(isNull(menuItems.deletedAt), eq(menuItems.isDemo, true)))
        .all()
        .map((row) => row.id)
      if (demoItemIds.length > 0) {
        tx.update(menuVariants)
          .set({ deletedAt: now, isDefault: false, ...markModified(menuVariants) })
          .where(and(inArray(menuVariants.menuItemId, demoItemIds), isNull(menuVariants.deletedAt)))
          .run()
        tx.delete(menuItemAddons).where(inArray(menuItemAddons.menuItemId, demoItemIds)).run()
        tx.update(menuItems)
          .set({ deletedAt: now, ...markModified(menuItems) })
          .where(inArray(menuItems.id, demoItemIds))
          .run()
      }

      const realItem = and(isNull(menuItems.deletedAt), eq(menuItems.isDemo, false))

      for (const addon of tx
        .select({ id: menuAddons.id })
        .from(menuAddons)
        .where(and(isNull(menuAddons.deletedAt), eq(menuAddons.isDemo, true)))
        .all()) {
        const usedByReal = tx
          .select({ id: menuItemAddons.addonId })
          .from(menuItemAddons)
          .innerJoin(menuItems, eq(menuItems.id, menuItemAddons.menuItemId))
          .where(and(eq(menuItemAddons.addonId, addon.id), realItem))
          .get()
        if (usedByReal) {
          keptAsReal += 1
          tx.update(menuAddons)
            .set({ isDemo: false, ...markModified(menuAddons) })
            .where(eq(menuAddons.id, addon.id))
            .run()
        } else {
          tx.update(menuAddons)
            .set({ deletedAt: now, ...markModified(menuAddons) })
            .where(eq(menuAddons.id, addon.id))
            .run()
        }
      }

      for (const category of tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(isNull(categories.deletedAt), eq(categories.isDemo, true)))
        .all()) {
        const usedByReal = tx
          .select({ id: menuItems.id })
          .from(menuItems)
          .where(and(eq(menuItems.categoryId, category.id), realItem))
          .get()
        if (usedByReal) {
          keptAsReal += 1
          tx.update(categories)
            .set({ isDemo: false, ...markModified(categories) })
            .where(eq(categories.id, category.id))
            .run()
        } else {
          tx.update(categories)
            .set({ deletedAt: now, ...markModified(categories) })
            .where(eq(categories.id, category.id))
            .run()
        }
      }

      for (const station of tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(and(isNull(kitchenStations.deletedAt), eq(kitchenStations.isDemo, true)))
        .all()) {
        const usedByCategory = tx
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.stationId, station.id), isNull(categories.deletedAt)))
          .get()
        const usedByItem = tx
          .select({ id: menuItems.id })
          .from(menuItems)
          .where(and(eq(menuItems.stationId, station.id), isNull(menuItems.deletedAt)))
          .get()
        if (usedByCategory !== undefined || usedByItem !== undefined) {
          keptAsReal += 1
          tx.update(kitchenStations)
            .set({ isDemo: false, ...markModified(kitchenStations) })
            .where(eq(kitchenStations.id, station.id))
            .run()
        } else {
          tx.update(kitchenStations)
            .set({ deletedAt: now, ...markModified(kitchenStations) })
            .where(eq(kitchenStations.id, station.id))
            .run()
        }
      }

      for (const tax of tx
        .select({ id: taxCategories.id })
        .from(taxCategories)
        .where(and(isNull(taxCategories.deletedAt), eq(taxCategories.isDemo, true)))
        .all()) {
        const usedByItem = tx
          .select({ id: menuItems.id })
          .from(menuItems)
          .where(and(eq(menuItems.taxCategoryId, tax.id), isNull(menuItems.deletedAt)))
          .get()
        if (usedByItem) {
          keptAsReal += 1
          tx.update(taxCategories)
            .set({ isDemo: false, ...markModified(taxCategories) })
            .where(eq(taxCategories.id, tax.id))
            .run()
        } else {
          tx.update(taxCategories)
            .set({ deletedAt: now, ...markModified(taxCategories) })
            .where(eq(taxCategories.id, tax.id))
            .run()
        }
      }

      recordMenuAudit(this.audit, tx, auth, 'menu.demo.removed', 'menu', 'demo', {
        removedItems: demoItemIds.length,
        keptAsReal
      })
      return { removedItems: demoItemIds.length, keptAsReal }
    })
  }

  private assertAllowed(): void {
    if (!this.allowed) {
      throw new AppError(
        'NOT_AVAILABLE',
        'Sample data is not available in this installation. Add your own menu instead.'
      )
    }
  }

  private hasDemoRows(db: DbExecutor): boolean {
    return this.anyLive(db, true)
  }

  private hasRealRows(db: DbExecutor): boolean {
    return this.anyLive(db, false)
  }

  private anyLive(db: DbExecutor, demo: boolean): boolean {
    const found = [
      db
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(and(isNull(menuItems.deletedAt), eq(menuItems.isDemo, demo)))
        .get(),
      db
        .select({ id: categories.id })
        .from(categories)
        .where(and(isNull(categories.deletedAt), eq(categories.isDemo, demo)))
        .get(),
      db
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(and(isNull(kitchenStations.deletedAt), eq(kitchenStations.isDemo, demo)))
        .get(),
      db
        .select({ id: taxCategories.id })
        .from(taxCategories)
        .where(and(isNull(taxCategories.deletedAt), eq(taxCategories.isDemo, demo)))
        .get(),
      db
        .select({ id: menuAddons.id })
        .from(menuAddons)
        .where(and(isNull(menuAddons.deletedAt), eq(menuAddons.isDemo, demo)))
        .get()
    ]
    return found.some((row) => row !== undefined)
  }
}
