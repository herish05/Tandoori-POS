import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { markModified, menuItems, taxCategories } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import type {
  SetActiveMenuData,
  TaxCategory,
  TaxCategoryData,
  UpdateTaxCategoryData
} from '@shared/menu'
import { assertNameFree, changedFields, recordMenuAudit, type NamedTableSpec } from './common'

type TaxRow = typeof taxCategories.$inferSelect

const NAME_SPEC: NamedTableSpec = {
  table: taxCategories,
  id: taxCategories.id,
  name: taxCategories.name,
  restaurantId: taxCategories.restaurantId,
  deletedAt: taxCategories.deletedAt
}

/** Loads a live tax category or fails with NOT_FOUND. */
export function requireTaxCategory(db: DbExecutor, id: string): TaxRow {
  const row = db
    .select()
    .from(taxCategories)
    .where(and(eq(taxCategories.id, id), isNull(taxCategories.deletedAt)))
    .get()
  if (!row) throw new AppError('NOT_FOUND', 'That tax category no longer exists.')
  return row
}

/** A tax category can be picked for an item if it is active, or the item already uses it. */
export function assertTaxUsable(db: DbExecutor, id: string | null, currentId: string | null): void {
  if (id === null) return
  const tax = requireTaxCategory(db, id)
  if (!tax.isActive && id !== currentId) {
    throw new AppError('CONFLICT', `The tax category "${tax.name}" is inactive.`)
  }
}

const EDITABLE = ['name', 'rateBps'] as const

export class TaxCategoryService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  list(): TaxCategory[] {
    const rows = this.db
      .select()
      .from(taxCategories)
      .where(isNull(taxCategories.deletedAt))
      .orderBy(asc(taxCategories.rateBps), asc(taxCategories.name))
      .all()
    const counts = this.db
      .select({ taxCategoryId: menuItems.taxCategoryId, total: sql<number>`count(*)` })
      .from(menuItems)
      .where(isNull(menuItems.deletedAt))
      .groupBy(menuItems.taxCategoryId)
      .all()
    const byTax = new Map(counts.map((count) => [count.taxCategoryId, count.total]))
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      rateBps: row.rateBps,
      isActive: row.isActive,
      isDemo: row.isDemo,
      itemCount: byTax.get(row.id) ?? 0
    }))
  }

  create(auth: AuthContext, input: TaxCategoryData): TaxCategory {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      assertNameFree(tx, NAME_SPEC, restaurantId, input.name, 'A tax category')
      const row = tx
        .insert(taxCategories)
        .values({ restaurantId, ...input })
        .returning()
        .get()
      recordMenuAudit(this.audit, tx, auth, 'menu.tax.created', 'tax_category', row.id, {
        name: row.name,
        rateBps: row.rateBps
      })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateTaxCategoryData): TaxCategory {
    this.db.transaction((tx) => {
      const current = requireTaxCategory(tx, input.id)
      assertNameFree(tx, NAME_SPEC, current.restaurantId, input.name, 'A tax category', current.id)
      const changed = changedFields(current, input, EDITABLE)
      if (changed.length === 0) return
      tx.update(taxCategories)
        .set({ name: input.name, rateBps: input.rateBps, ...markModified(taxCategories) })
        .where(eq(taxCategories.id, current.id))
        .run()
      recordMenuAudit(this.audit, tx, auth, 'menu.tax.updated', 'tax_category', current.id, {
        name: input.name,
        changedFields: changed,
        ...(changed.includes('rateBps') ? { from: current.rateBps, to: input.rateBps } : {})
      })
    })
    return this.get(input.id)
  }

  setActive(auth: AuthContext, input: SetActiveMenuData): TaxCategory {
    this.db.transaction((tx) => {
      const current = requireTaxCategory(tx, input.id)
      if (current.isActive === input.isActive) return
      tx.update(taxCategories)
        .set({ isActive: input.isActive, ...markModified(taxCategories) })
        .where(eq(taxCategories.id, current.id))
        .run()
      recordMenuAudit(
        this.audit,
        tx,
        auth,
        input.isActive ? 'menu.tax.activated' : 'menu.tax.deactivated',
        'tax_category',
        current.id,
        { name: current.name }
      )
    })
    return this.get(input.id)
  }

  delete(auth: AuthContext, id: string): void {
    this.db.transaction((tx) => {
      const current = requireTaxCategory(tx, id)
      const used = tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(and(eq(menuItems.taxCategoryId, id), isNull(menuItems.deletedAt)))
        .get()
      if (used) {
        throw new AppError(
          'CONFLICT',
          'Menu items still use this tax category. Change their tax first, or deactivate the category instead.'
        )
      }
      tx.update(taxCategories)
        .set({ deletedAt: new Date(), ...markModified(taxCategories) })
        .where(eq(taxCategories.id, id))
        .run()
      recordMenuAudit(this.audit, tx, auth, 'menu.tax.deleted', 'tax_category', id, {
        name: current.name
      })
    })
  }

  private get(id: string): TaxCategory {
    const found = this.list().find((tax) => tax.id === id)
    if (!found) throw new AppError('NOT_FOUND', 'That tax category no longer exists.')
    return found
  }
}
