import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { kitchenStations, markModified, printers } from '../db/schema'
import { AppError } from '../ipc/errors'
import { assertNameFree, recordMenuAudit, type NamedTableSpec } from '../menu/common'
import { requireStation } from '../menu/station-service'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import type { CreatePrinterData, PrinterConfig, UpdatePrinterData } from '@shared/kitchen'

type PrinterRow = typeof printers.$inferSelect

const NAME_SPEC: NamedTableSpec = {
  table: printers,
  id: printers.id,
  name: printers.name,
  restaurantId: printers.restaurantId,
  deletedAt: printers.deletedAt
}

const toConfig = (row: PrinterRow, stationName: string | null): PrinterConfig => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  address: row.address,
  paperWidth: row.paperWidth,
  stationId: row.stationId,
  stationName,
  isDefault: row.isDefault,
  isActive: row.isActive
})

/** The printers kitchen tickets can go to, and which printer serves which station. */
export class PrinterService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  list(): PrinterConfig[] {
    return this.db
      .select({ printer: printers, stationName: kitchenStations.name })
      .from(printers)
      .leftJoin(kitchenStations, eq(kitchenStations.id, printers.stationId))
      .where(isNull(printers.deletedAt))
      .orderBy(asc(printers.name))
      .all()
      .map((row) => toConfig(row.printer, row.stationName))
  }

  get(id: string): PrinterConfig {
    const found = this.list().find((printer) => printer.id === id)
    if (!found) throw new AppError('NOT_FOUND', 'That printer no longer exists.')
    return found
  }

  /** The printer for a station's tickets: its own, else the default one. */
  resolveFor(db: DbExecutor, stationId: string | null): PrinterConfig | null {
    const live = and(isNull(printers.deletedAt), eq(printers.isActive, true))
    const rows = db
      .select({ printer: printers, stationName: kitchenStations.name })
      .from(printers)
      .leftJoin(kitchenStations, eq(kitchenStations.id, printers.stationId))
      .where(live)
      .all()
    const own = stationId ? rows.find((row) => row.printer.stationId === stationId) : undefined
    const chosen = own ?? rows.find((row) => row.printer.isDefault)
    return chosen ? toConfig(chosen.printer, chosen.stationName) : null
  }

  create(auth: AuthContext, input: CreatePrinterData): PrinterConfig {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      assertNameFree(tx, NAME_SPEC, restaurantId, input.name, 'A printer')
      this.checkStation(tx, input.stationId, null)
      // The first shared printer becomes the default so tickets always have somewhere to go.
      const makeDefault =
        input.isDefault || (input.stationId === null && !this.hasDefault(tx, restaurantId))
      if (makeDefault) this.clearDefault(tx, restaurantId, null)
      const row = tx
        .insert(printers)
        .values({
          restaurantId,
          name: input.name,
          kind: input.kind,
          address: input.address,
          paperWidth: input.paperWidth,
          stationId: input.stationId,
          isDefault: makeDefault,
          isActive: input.isActive
        })
        .returning()
        .get()
      recordMenuAudit(this.audit, tx, auth, 'printer.created', 'printer', row.id, {
        name: row.name,
        kind: row.kind,
        address: row.address,
        stationId: row.stationId,
        isDefault: row.isDefault
      })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdatePrinterData): PrinterConfig {
    this.db.transaction((tx) => {
      const current = this.requirePrinter(tx, input.id)
      assertNameFree(tx, NAME_SPEC, current.restaurantId, input.name, 'A printer', current.id)
      this.checkStation(tx, input.stationId, current.id)
      if (input.isDefault) this.clearDefault(tx, current.restaurantId, current.id)
      tx.update(printers)
        .set({
          name: input.name,
          kind: input.kind,
          address: input.address,
          paperWidth: input.paperWidth,
          stationId: input.stationId,
          isDefault: input.isDefault,
          isActive: input.isActive,
          ...markModified(printers)
        })
        .where(eq(printers.id, current.id))
        .run()
      recordMenuAudit(this.audit, tx, auth, 'printer.updated', 'printer', current.id, {
        name: input.name,
        kind: input.kind,
        address: input.address,
        stationId: input.stationId,
        isDefault: input.isDefault,
        isActive: input.isActive
      })
    })
    return this.get(input.id)
  }

  /** Removes a printer from use. Past print jobs keep its name. */
  delete(auth: AuthContext, id: string): void {
    this.db.transaction((tx) => {
      const current = this.requirePrinter(tx, id)
      tx.update(printers)
        .set({ deletedAt: new Date(), isDefault: false, ...markModified(printers) })
        .where(eq(printers.id, id))
        .run()
      recordMenuAudit(this.audit, tx, auth, 'printer.deleted', 'printer', id, {
        name: current.name
      })
    })
  }

  private requirePrinter(db: DbExecutor, id: string): PrinterRow {
    const row = db
      .select()
      .from(printers)
      .where(and(eq(printers.id, id), isNull(printers.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That printer no longer exists.')
    return row
  }

  /** One printer per station. */
  private checkStation(tx: DbExecutor, stationId: string | null, exceptId: string | null): void {
    if (stationId === null) return
    const station = requireStation(tx, stationId)
    const taken = tx
      .select({ name: printers.name })
      .from(printers)
      .where(
        and(
          eq(printers.stationId, stationId),
          isNull(printers.deletedAt),
          exceptId ? ne(printers.id, exceptId) : undefined
        )
      )
      .get()
    if (taken) {
      throw new AppError(
        'CONFLICT',
        `The station "${station.name}" already prints on "${taken.name}".`
      )
    }
  }

  private hasDefault(tx: DbExecutor, restaurantId: string): boolean {
    return (
      tx
        .select({ id: printers.id })
        .from(printers)
        .where(
          and(
            eq(printers.restaurantId, restaurantId),
            eq(printers.isDefault, true),
            isNull(printers.deletedAt)
          )
        )
        .get() !== undefined
    )
  }

  /** Only one printer can be the default; a new default takes over. */
  private clearDefault(tx: DbExecutor, restaurantId: string, exceptId: string | null): void {
    tx.update(printers)
      .set({ isDefault: false, ...markModified(printers) })
      .where(
        and(
          eq(printers.restaurantId, restaurantId),
          eq(printers.isDefault, true),
          isNull(printers.deletedAt),
          exceptId ? ne(printers.id, exceptId) : undefined
        )
      )
      .run()
  }
}
