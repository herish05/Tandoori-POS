import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { areas, diningTables, markModified } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import {
  IDLE_TABLE_STATUSES,
  type AreaData,
  type AreaSummary,
  type SetActiveData,
  type UpdateAreaData
} from '@shared/tables'

type AreaRow = typeof areas.$inferSelect

/** Loads a live (not deleted) area or fails with NOT_FOUND. */
export function requireArea(db: DbExecutor, id: string): AreaRow {
  const row = db
    .select()
    .from(areas)
    .where(and(eq(areas.id, id), isNull(areas.deletedAt)))
    .get()
  if (!row) throw new AppError('NOT_FOUND', 'That area no longer exists.')
  return row
}

const EDITABLE_FIELDS = ['name', 'floor', 'description', 'sortOrder'] as const

export class AreaService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  list(): AreaSummary[] {
    const rows = this.db
      .select()
      .from(areas)
      .where(isNull(areas.deletedAt))
      .orderBy(asc(areas.sortOrder), asc(areas.name))
      .all()
    const counts = this.db
      .select({
        areaId: diningTables.areaId,
        total: sql<number>`count(*)`,
        active: sql<number>`coalesce(sum(case when ${diningTables.isActive} = 1 then 1 else 0 end), 0)`
      })
      .from(diningTables)
      .where(isNull(diningTables.deletedAt))
      .groupBy(diningTables.areaId)
      .all()
    const byArea = new Map(counts.map((count) => [count.areaId, count]))

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      floor: row.floor,
      description: row.description,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      tableCount: byArea.get(row.id)?.total ?? 0,
      activeTableCount: byArea.get(row.id)?.active ?? 0
    }))
  }

  create(auth: AuthContext, input: AreaData): AreaSummary {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      this.assertNameFree(tx, restaurantId, input.name)
      const row = tx
        .insert(areas)
        .values({ restaurantId, ...input })
        .returning()
        .get()
      this.audit.record(
        {
          action: 'area.created',
          userId: auth.userId,
          username: auth.username,
          entityType: 'area',
          entityId: row.id,
          details: { name: row.name }
        },
        tx
      )
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateAreaData): AreaSummary {
    this.db.transaction((tx) => {
      const current = requireArea(tx, input.id)
      this.assertNameFree(tx, current.restaurantId, input.name, current.id)

      const changed = EDITABLE_FIELDS.filter((field) => current[field] !== input[field])
      if (changed.length === 0) return
      tx.update(areas)
        .set({
          name: input.name,
          floor: input.floor,
          description: input.description,
          sortOrder: input.sortOrder,
          ...markModified(areas)
        })
        .where(eq(areas.id, current.id))
        .run()
      this.audit.record(
        {
          action: 'area.updated',
          userId: auth.userId,
          username: auth.username,
          entityType: 'area',
          entityId: current.id,
          details: { name: input.name, changedFields: changed }
        },
        tx
      )
    })
    return this.get(input.id)
  }

  /** Hiding an area hides its tables from the POS, so nothing may be in use in it. */
  setActive(auth: AuthContext, input: SetActiveData): AreaSummary {
    this.db.transaction((tx) => {
      const current = requireArea(tx, input.id)
      if (current.isActive === input.isActive) return

      if (!input.isActive) {
        const inUse = tx
          .select({ id: diningTables.id })
          .from(diningTables)
          .where(
            and(
              eq(diningTables.areaId, current.id),
              isNull(diningTables.deletedAt),
              eq(diningTables.isActive, true),
              sql`${diningTables.status} not in (${sql.join(
                IDLE_TABLE_STATUSES.map((status) => sql`${status}`),
                sql`, `
              )})`
            )
          )
          .get()
        if (inUse) {
          throw new AppError(
            'CONFLICT',
            'Some tables in this area are in use. Close them before deactivating the area.'
          )
        }
      }

      tx.update(areas)
        .set({ isActive: input.isActive, ...markModified(areas) })
        .where(eq(areas.id, current.id))
        .run()
      this.audit.record(
        {
          action: input.isActive ? 'area.activated' : 'area.deactivated',
          userId: auth.userId,
          username: auth.username,
          entityType: 'area',
          entityId: current.id,
          details: { name: current.name }
        },
        tx
      )
    })
    return this.get(input.id)
  }

  /** An area can only be deleted once it holds no tables; otherwise deactivate it. */
  delete(auth: AuthContext, id: string): void {
    this.db.transaction((tx) => {
      const current = requireArea(tx, id)
      const hasTables = tx
        .select({ id: diningTables.id })
        .from(diningTables)
        .where(and(eq(diningTables.areaId, id), isNull(diningTables.deletedAt)))
        .get()
      if (hasTables) {
        throw new AppError(
          'CONFLICT',
          'This area still has tables. Move them to another area, or deactivate the area instead.'
        )
      }
      tx.update(areas)
        .set({ deletedAt: new Date(), ...markModified(areas) })
        .where(eq(areas.id, id))
        .run()
      this.audit.record(
        {
          action: 'area.deleted',
          userId: auth.userId,
          username: auth.username,
          entityType: 'area',
          entityId: id,
          details: { name: current.name }
        },
        tx
      )
    })
  }

  private get(id: string): AreaSummary {
    const found = this.list().find((area) => area.id === id)
    if (!found) throw new AppError('NOT_FOUND', 'That area no longer exists.')
    return found
  }

  private assertNameFree(
    db: DbExecutor,
    restaurantId: string,
    name: string,
    exceptId?: string
  ): void {
    const clash = db
      .select({ id: areas.id })
      .from(areas)
      .where(
        and(
          eq(areas.restaurantId, restaurantId),
          isNull(areas.deletedAt),
          sql`lower(${areas.name}) = ${name.toLowerCase()}`,
          exceptId ? ne(areas.id, exceptId) : undefined
        )
      )
      .get()
    if (clash) throw new AppError('CONFLICT', `An area named "${name}" already exists.`)
  }
}
