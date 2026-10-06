import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { categories, kitchenStations, markModified, menuItems } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import type {
  CategoryData,
  MenuCategory,
  SetActiveMenuData,
  UpdateCategoryData
} from '@shared/menu'
import { assertNameFree, changedFields, recordMenuAudit, type NamedTableSpec } from './common'
import { assertStationUsable } from './station-service'

type CategoryRow = typeof categories.$inferSelect

const NAME_SPEC: NamedTableSpec = {
  table: categories,
  id: categories.id,
  name: categories.name,
  restaurantId: categories.restaurantId,
  deletedAt: categories.deletedAt
}

/** Loads a live category or fails with NOT_FOUND. */
export function requireCategory(db: DbExecutor, id: string): CategoryRow {
  const row = db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .get()
  if (!row) throw new AppError('NOT_FOUND', 'That category no longer exists.')
  return row
}

const EDITABLE = ['name', 'description', 'sortOrder', 'stationId'] as const

export class CategoryService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  list(): MenuCategory[] {
    const rows = this.db
      .select({
        category: categories,
        stationName: kitchenStations.name
      })
      .from(categories)
      .leftJoin(kitchenStations, eq(kitchenStations.id, categories.stationId))
      .where(isNull(categories.deletedAt))
      .orderBy(asc(categories.sortOrder), asc(categories.name))
      .all()
    const counts = this.db
      .select({ categoryId: menuItems.categoryId, total: sql<number>`count(*)` })
      .from(menuItems)
      .where(isNull(menuItems.deletedAt))
      .groupBy(menuItems.categoryId)
      .all()
    const byCategory = new Map(counts.map((count) => [count.categoryId, count.total]))

    return rows.map(({ category, stationName }) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      isDemo: category.isDemo,
      stationId: category.stationId,
      stationName,
      itemCount: byCategory.get(category.id) ?? 0
    }))
  }

  create(auth: AuthContext, input: CategoryData): MenuCategory {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      assertNameFree(tx, NAME_SPEC, restaurantId, input.name, 'A category')
      assertStationUsable(tx, input.stationId, null)
      const row = tx
        .insert(categories)
        .values({ restaurantId, ...input })
        .returning()
        .get()
      recordMenuAudit(this.audit, tx, auth, 'menu.category.created', 'category', row.id, {
        name: row.name
      })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateCategoryData): MenuCategory {
    this.db.transaction((tx) => {
      const current = requireCategory(tx, input.id)
      assertNameFree(tx, NAME_SPEC, current.restaurantId, input.name, 'A category', current.id)
      assertStationUsable(tx, input.stationId, current.stationId)
      const changed = changedFields(current, input, EDITABLE)
      if (changed.length === 0) return
      tx.update(categories)
        .set({
          name: input.name,
          description: input.description,
          sortOrder: input.sortOrder,
          stationId: input.stationId,
          ...markModified(categories)
        })
        .where(eq(categories.id, current.id))
        .run()
      recordMenuAudit(this.audit, tx, auth, 'menu.category.updated', 'category', current.id, {
        name: input.name,
        changedFields: changed
      })
    })
    return this.get(input.id)
  }

  /** Deactivating a category hides all its items from ordering; the items themselves are untouched. */
  setActive(auth: AuthContext, input: SetActiveMenuData): MenuCategory {
    this.db.transaction((tx) => {
      const current = requireCategory(tx, input.id)
      if (current.isActive === input.isActive) return
      tx.update(categories)
        .set({ isActive: input.isActive, ...markModified(categories) })
        .where(eq(categories.id, current.id))
        .run()
      recordMenuAudit(
        this.audit,
        tx,
        auth,
        input.isActive ? 'menu.category.activated' : 'menu.category.deactivated',
        'category',
        current.id,
        { name: current.name }
      )
    })
    return this.get(input.id)
  }

  delete(auth: AuthContext, id: string): void {
    this.db.transaction((tx) => {
      const current = requireCategory(tx, id)
      const hasItems = tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(and(eq(menuItems.categoryId, id), isNull(menuItems.deletedAt)))
        .get()
      if (hasItems) {
        throw new AppError(
          'CONFLICT',
          'This category still has items. Move or delete them first, or deactivate the category instead.'
        )
      }
      tx.update(categories)
        .set({ deletedAt: new Date(), ...markModified(categories) })
        .where(eq(categories.id, id))
        .run()
      recordMenuAudit(this.audit, tx, auth, 'menu.category.deleted', 'category', id, {
        name: current.name
      })
    })
  }

  private get(id: string): MenuCategory {
    const found = this.list().find((category) => category.id === id)
    if (!found) throw new AppError('NOT_FOUND', 'That category no longer exists.')
    return found
  }
}
