import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { categories, kitchenStations, markModified, menuItems } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import type {
  KitchenStation,
  SetActiveMenuData,
  StationData,
  UpdateStationData
} from '@shared/menu'
import { assertNameFree, changedFields, recordMenuAudit, type NamedTableSpec } from './common'

type StationRow = typeof kitchenStations.$inferSelect

const NAME_SPEC: NamedTableSpec = {
  table: kitchenStations,
  id: kitchenStations.id,
  name: kitchenStations.name,
  restaurantId: kitchenStations.restaurantId,
  deletedAt: kitchenStations.deletedAt
}

/** Loads a live station or fails with NOT_FOUND. */
export function requireStation(db: DbExecutor, id: string): StationRow {
  const row = db
    .select()
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, id), isNull(kitchenStations.deletedAt)))
    .get()
  if (!row) throw new AppError('NOT_FOUND', 'That kitchen station no longer exists.')
  return row
}

/**
 * Checks a station can be picked for a category or item: it must exist, and be active unless
 * the record already points at it (so editing an old record never forces a change).
 */
export function assertStationUsable(
  db: DbExecutor,
  id: string | null,
  currentId: string | null
): void {
  if (id === null) return
  const station = requireStation(db, id)
  if (!station.isActive && id !== currentId) {
    throw new AppError('CONFLICT', `The kitchen station "${station.name}" is inactive.`)
  }
}

const EDITABLE = ['name', 'description', 'sortOrder'] as const

export class StationService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  list(): KitchenStation[] {
    const rows = this.db
      .select()
      .from(kitchenStations)
      .where(isNull(kitchenStations.deletedAt))
      .orderBy(asc(kitchenStations.sortOrder), asc(kitchenStations.name))
      .all()
    const fromCategories = this.db
      .select({ stationId: categories.stationId, total: sql<number>`count(*)` })
      .from(categories)
      .where(and(isNull(categories.deletedAt), eq(categories.isActive, true)))
      .groupBy(categories.stationId)
      .all()
    const fromItems = this.db
      .select({ stationId: menuItems.stationId, total: sql<number>`count(*)` })
      .from(menuItems)
      .where(and(isNull(menuItems.deletedAt), eq(menuItems.isActive, true)))
      .groupBy(menuItems.stationId)
      .all()
    const usage = new Map<string, number>()
    for (const { stationId, total } of [...fromCategories, ...fromItems]) {
      if (stationId) usage.set(stationId, (usage.get(stationId) ?? 0) + total)
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      isDemo: row.isDemo,
      usageCount: usage.get(row.id) ?? 0
    }))
  }

  create(auth: AuthContext, input: StationData): KitchenStation {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      assertNameFree(tx, NAME_SPEC, restaurantId, input.name, 'A kitchen station')
      const row = tx
        .insert(kitchenStations)
        .values({ restaurantId, ...input })
        .returning()
        .get()
      recordMenuAudit(this.audit, tx, auth, 'menu.station.created', 'kitchen_station', row.id, {
        name: row.name
      })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateStationData): KitchenStation {
    this.db.transaction((tx) => {
      const current = requireStation(tx, input.id)
      assertNameFree(
        tx,
        NAME_SPEC,
        current.restaurantId,
        input.name,
        'A kitchen station',
        current.id
      )
      const changed = changedFields(current, input, EDITABLE)
      if (changed.length === 0) return
      tx.update(kitchenStations)
        .set({
          name: input.name,
          description: input.description,
          sortOrder: input.sortOrder,
          ...markModified(kitchenStations)
        })
        .where(eq(kitchenStations.id, current.id))
        .run()
      recordMenuAudit(this.audit, tx, auth, 'menu.station.updated', 'kitchen_station', current.id, {
        name: input.name,
        changedFields: changed
      })
    })
    return this.get(input.id)
  }

  /** A station that categories or items still send tickets to cannot be switched off. */
  setActive(auth: AuthContext, input: SetActiveMenuData): KitchenStation {
    this.db.transaction((tx) => {
      const current = requireStation(tx, input.id)
      if (current.isActive === input.isActive) return
      if (!input.isActive && this.usageCount(tx, current.id, true) > 0) {
        throw new AppError(
          'CONFLICT',
          'Categories or items still use this station. Move them to another station before deactivating it.'
        )
      }
      tx.update(kitchenStations)
        .set({ isActive: input.isActive, ...markModified(kitchenStations) })
        .where(eq(kitchenStations.id, current.id))
        .run()
      recordMenuAudit(
        this.audit,
        tx,
        auth,
        input.isActive ? 'menu.station.activated' : 'menu.station.deactivated',
        'kitchen_station',
        current.id,
        { name: current.name }
      )
    })
    return this.get(input.id)
  }

  delete(auth: AuthContext, id: string): void {
    this.db.transaction((tx) => {
      const current = requireStation(tx, id)
      if (this.usageCount(tx, id, false) > 0) {
        throw new AppError(
          'CONFLICT',
          'Categories or items still use this station. Move them to another station first.'
        )
      }
      tx.update(kitchenStations)
        .set({ deletedAt: new Date(), ...markModified(kitchenStations) })
        .where(eq(kitchenStations.id, id))
        .run()
      recordMenuAudit(this.audit, tx, auth, 'menu.station.deleted', 'kitchen_station', id, {
        name: current.name
      })
    })
  }

  private usageCount(db: DbExecutor, id: string, activeOnly: boolean): number {
    const fromCategories = db
      .select({ total: sql<number>`count(*)` })
      .from(categories)
      .where(
        and(
          eq(categories.stationId, id),
          isNull(categories.deletedAt),
          activeOnly ? eq(categories.isActive, true) : undefined
        )
      )
      .get()
    const fromItems = db
      .select({ total: sql<number>`count(*)` })
      .from(menuItems)
      .where(
        and(
          eq(menuItems.stationId, id),
          isNull(menuItems.deletedAt),
          activeOnly ? eq(menuItems.isActive, true) : undefined
        )
      )
      .get()
    return (fromCategories?.total ?? 0) + (fromItems?.total ?? 0)
  }

  private get(id: string): KitchenStation {
    const found = this.list().find((station) => station.id === id)
    if (!found) throw new AppError('NOT_FOUND', 'That kitchen station no longer exists.')
    return found
  }
}
