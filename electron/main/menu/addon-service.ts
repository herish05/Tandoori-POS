import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { markModified, menuAddons, menuItemAddons, menuItems } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import type { AddonData, MenuAddon, SetActiveMenuData, UpdateAddonData } from '@shared/menu'
import { assertNameFree, changedFields, recordMenuAudit, type NamedTableSpec } from './common'

type AddonRow = typeof menuAddons.$inferSelect

const NAME_SPEC: NamedTableSpec = {
  table: menuAddons,
  id: menuAddons.id,
  name: menuAddons.name,
  restaurantId: menuAddons.restaurantId,
  deletedAt: menuAddons.deletedAt
}

/** Loads a live add-on or fails with NOT_FOUND. */
export function requireAddon(db: DbExecutor, id: string): AddonRow {
  const row = db
    .select()
    .from(menuAddons)
    .where(and(eq(menuAddons.id, id), isNull(menuAddons.deletedAt)))
    .get()
  if (!row) throw new AppError('NOT_FOUND', 'That add-on no longer exists.')
  return row
}

const EDITABLE = ['name', 'kind', 'price'] as const

export class AddonService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  list(): MenuAddon[] {
    const rows = this.db
      .select()
      .from(menuAddons)
      .where(isNull(menuAddons.deletedAt))
      .orderBy(asc(menuAddons.kind), asc(menuAddons.name))
      .all()
    const counts = this.db
      .select({ addonId: menuItemAddons.addonId, total: sql<number>`count(*)` })
      .from(menuItemAddons)
      .innerJoin(menuItems, eq(menuItems.id, menuItemAddons.menuItemId))
      .where(isNull(menuItems.deletedAt))
      .groupBy(menuItemAddons.addonId)
      .all()
    const byAddon = new Map(counts.map((count) => [count.addonId, count.total]))
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      price: row.price,
      isActive: row.isActive,
      isDemo: row.isDemo,
      itemCount: byAddon.get(row.id) ?? 0
    }))
  }

  create(auth: AuthContext, input: AddonData): MenuAddon {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      assertNameFree(tx, NAME_SPEC, restaurantId, input.name, 'An add-on or modifier')
      const row = tx
        .insert(menuAddons)
        .values({ restaurantId, ...input })
        .returning()
        .get()
      recordMenuAudit(this.audit, tx, auth, 'menu.addon.created', 'menu_addon', row.id, {
        name: row.name,
        kind: row.kind
      })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateAddonData): MenuAddon {
    this.db.transaction((tx) => {
      const current = requireAddon(tx, input.id)
      assertNameFree(
        tx,
        NAME_SPEC,
        current.restaurantId,
        input.name,
        'An add-on or modifier',
        current.id
      )
      const changed = changedFields(current, input, EDITABLE)
      if (changed.length === 0) return
      tx.update(menuAddons)
        .set({
          name: input.name,
          kind: input.kind,
          price: input.price,
          ...markModified(menuAddons)
        })
        .where(eq(menuAddons.id, current.id))
        .run()
      this.touchItems(tx, [current.id])
      recordMenuAudit(this.audit, tx, auth, 'menu.addon.updated', 'menu_addon', current.id, {
        name: input.name,
        changedFields: changed
      })
    })
    return this.get(input.id)
  }

  setActive(auth: AuthContext, input: SetActiveMenuData): MenuAddon {
    this.db.transaction((tx) => {
      const current = requireAddon(tx, input.id)
      if (current.isActive === input.isActive) return
      tx.update(menuAddons)
        .set({ isActive: input.isActive, ...markModified(menuAddons) })
        .where(eq(menuAddons.id, current.id))
        .run()
      this.touchItems(tx, [current.id])
      recordMenuAudit(
        this.audit,
        tx,
        auth,
        input.isActive ? 'menu.addon.activated' : 'menu.addon.deactivated',
        'menu_addon',
        current.id,
        { name: current.name }
      )
    })
    return this.get(input.id)
  }

  /** Deleting an add-on also takes it off every item that offered it. */
  delete(auth: AuthContext, id: string): void {
    this.db.transaction((tx) => {
      const current = requireAddon(tx, id)
      this.touchItems(tx, [id])
      tx.delete(menuItemAddons).where(eq(menuItemAddons.addonId, id)).run()
      tx.update(menuAddons)
        .set({ deletedAt: new Date(), ...markModified(menuAddons) })
        .where(eq(menuAddons.id, id))
        .run()
      recordMenuAudit(this.audit, tx, auth, 'menu.addon.deleted', 'menu_addon', id, {
        name: current.name
      })
    })
  }

  /** Items that offer these add-ons changed too, so they must sync again. */
  private touchItems(tx: DbExecutor, addonIds: string[]): void {
    const itemIds = tx
      .select({ id: menuItemAddons.menuItemId })
      .from(menuItemAddons)
      .where(inArray(menuItemAddons.addonId, addonIds))
      .all()
      .map((row) => row.id)
    if (itemIds.length === 0) return
    tx.update(menuItems).set(markModified(menuItems)).where(inArray(menuItems.id, itemIds)).run()
  }

  private get(id: string): MenuAddon {
    const found = this.list().find((addon) => addon.id === id)
    if (!found) throw new AppError('NOT_FOUND', 'That add-on no longer exists.')
    return found
  }
}
