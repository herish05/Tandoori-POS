import { and, asc, eq, inArray, isNull, ne, notInArray, sql, type SQL } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext, AuditAction, Clock } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { areas, diningTables, markModified, orders, users } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import { CLOSED_ORDER_STATUSES } from '@shared/orders'
import {
  FLOOR_GRID,
  IDLE_TABLE_STATUSES,
  type CreateTableData,
  type DiningTable,
  type FloorArea,
  type OpenTableData,
  type SaveLayoutData,
  type SetActiveData,
  type TableStatus,
  type UpdateTableData
} from '@shared/tables'
import { requireArea } from './area-service'

type TableRow = typeof diningTables.$inferSelect

const cellKey = (x: number, y: number): string => `${String(x)},${String(y)}`
const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/** First free cell scanning left to right, top to bottom; null when the floor plan is full. */
function firstFreeCell(taken: ReadonlySet<string>): { x: number; y: number } | null {
  for (let y = 0; y < FLOOR_GRID.rows; y++) {
    for (let x = 0; x < FLOOR_GRID.columns; x++) {
      if (!taken.has(cellKey(x, y))) return { x, y }
    }
  }
  return null
}

const OPENABLE: readonly TableStatus[] = ['AVAILABLE', 'RESERVED']
const CLOSABLE: readonly TableStatus[] = ['OCCUPIED', 'PAID']

function unavailableMessage(status: TableStatus): string {
  switch (status) {
    case 'OCCUPIED':
      return 'This table is already open.'
    case 'BLOCKED':
      return 'This table is blocked. Unblock it first.'
    default:
      return 'This table already has an order in progress.'
  }
}

interface Transition {
  action: AuditAction
  from: readonly TableStatus[]
  to: TableStatus
  /** Message when the table is not in one of the `from` states. */
  refusal: (status: TableStatus) => string
}

const TRANSITIONS = {
  close: {
    action: 'table.closed',
    from: CLOSABLE,
    to: 'AVAILABLE',
    refusal: (status) =>
      status === 'AVAILABLE' || status === 'RESERVED'
        ? 'This table is not open.'
        : 'This table still has an order in progress. Settle or cancel it first.'
  },
  block: {
    action: 'table.blocked',
    from: ['AVAILABLE'],
    to: 'BLOCKED',
    refusal: (status) =>
      status === 'BLOCKED' ? 'This table is already blocked.' : 'Only a free table can be blocked.'
  },
  unblock: {
    action: 'table.unblocked',
    from: ['BLOCKED'],
    to: 'AVAILABLE',
    refusal: () => 'This table is not blocked.'
  }
} satisfies Record<string, Transition>

export class TableService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  /** Every table, active or not, for the admin screens. */
  list(): DiningTable[] {
    return this.load()
      .sort(
        (a, b) =>
          a.areaSort - b.areaSort ||
          naturalCompare(a.table.areaName, b.table.areaName) ||
          naturalCompare(a.table.tableNumber, b.table.tableNumber)
      )
      .map((entry) => entry.table)
  }

  /** What the POS shows: active areas with their active tables. */
  floor(): FloorArea[] {
    const activeAreas = this.db
      .select()
      .from(areas)
      .where(and(isNull(areas.deletedAt), eq(areas.isActive, true)))
      .orderBy(asc(areas.sortOrder), asc(areas.name))
      .all()
    const tables = this.load(eq(diningTables.isActive, true))
    return activeAreas.map((area) => ({
      id: area.id,
      name: area.name,
      floor: area.floor,
      tables: tables
        .filter((entry) => entry.table.areaId === area.id)
        .map((entry) => entry.table)
        .sort((a, b) => naturalCompare(a.tableNumber, b.tableNumber))
    }))
  }

  // --- Setup: create, edit, retire ---------------------------------------------------------

  create(auth: AuthContext, input: CreateTableData): DiningTable {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      requireArea(tx, input.areaId)
      this.assertNumberFree(tx, restaurantId, input.tableNumber)

      const taken = this.takenCells(tx, input.areaId)
      let x = input.positionX
      let y = input.positionY
      if (x === undefined || y === undefined) {
        const free = firstFreeCell(taken)
        if (!free) throw new AppError('CONFLICT', 'This area is full. Add another area.')
        ;({ x, y } = free)
      } else if (taken.has(cellKey(x, y))) {
        throw new AppError('CONFLICT', 'Another table is already at that spot.')
      }

      const row = tx
        .insert(diningTables)
        .values({
          restaurantId,
          areaId: input.areaId,
          tableNumber: input.tableNumber,
          displayName: input.displayName ?? `Table ${input.tableNumber}`,
          capacity: input.capacity,
          type: input.type,
          positionX: x,
          positionY: y
        })
        .returning()
        .get()
      this.record(tx, auth, 'table.created', row.id, {
        tableNumber: row.tableNumber,
        areaId: row.areaId
      })
      return row.id
    })
    return this.getById(id)
  }

  update(auth: AuthContext, input: UpdateTableData): DiningTable {
    this.db.transaction((tx) => {
      const current = this.requireTable(tx, input.id)
      const displayName = input.displayName ?? `Table ${input.tableNumber}`
      const areaChanged = input.areaId !== current.areaId

      if (areaChanged) {
        requireArea(tx, input.areaId)
        if (!IDLE_TABLE_STATUSES.includes(current.status)) {
          throw new AppError('CONFLICT', 'Close this table before moving it to another area.')
        }
      }
      if (input.tableNumber !== current.tableNumber) {
        this.assertNumberFree(tx, current.restaurantId, input.tableNumber, current.id)
      }

      const changed = (
        [
          ['tableNumber', current.tableNumber !== input.tableNumber],
          ['displayName', current.displayName !== displayName],
          ['capacity', current.capacity !== input.capacity],
          ['type', current.type !== input.type],
          ['areaId', areaChanged]
        ] as const
      )
        .filter(([, differs]) => differs)
        .map(([field]) => field)
      if (changed.length === 0) return

      let position: { positionX: number; positionY: number } | undefined
      if (areaChanged && current.isActive) {
        const free = firstFreeCell(this.takenCells(tx, input.areaId))
        if (!free) throw new AppError('CONFLICT', 'The chosen area is full.')
        position = { positionX: free.x, positionY: free.y }
      }

      tx.update(diningTables)
        .set({
          areaId: input.areaId,
          tableNumber: input.tableNumber,
          displayName,
          capacity: input.capacity,
          type: input.type,
          ...position,
          ...markModified(diningTables)
        })
        .where(eq(diningTables.id, current.id))
        .run()
      this.record(tx, auth, 'table.updated', current.id, {
        tableNumber: input.tableNumber,
        changedFields: changed
      })
    })
    return this.getById(input.id)
  }

  /** A deactivated table disappears from the POS but keeps its history. */
  setActive(auth: AuthContext, input: SetActiveData): DiningTable {
    this.db.transaction((tx) => {
      const current = this.requireTable(tx, input.id)
      if (current.isActive === input.isActive) return

      let position: { positionX: number; positionY: number } | undefined
      if (input.isActive) {
        const taken = this.takenCells(tx, current.areaId)
        if (taken.has(cellKey(current.positionX, current.positionY))) {
          const free = firstFreeCell(taken)
          if (!free) throw new AppError('CONFLICT', 'This area is full. Add another area.')
          position = { positionX: free.x, positionY: free.y }
        }
      } else if (!IDLE_TABLE_STATUSES.includes(current.status)) {
        throw new AppError('CONFLICT', 'Close this table before deactivating it.')
      }

      tx.update(diningTables)
        .set({ isActive: input.isActive, ...position, ...markModified(diningTables) })
        .where(eq(diningTables.id, current.id))
        .run()
      this.record(tx, auth, input.isActive ? 'table.activated' : 'table.deactivated', current.id, {
        tableNumber: current.tableNumber
      })
    })
    return this.getById(input.id)
  }

  /** Saves where the tables of one area sit on its floor plan. All or nothing. */
  saveLayout(auth: AuthContext, input: SaveLayoutData): DiningTable[] {
    this.db.transaction((tx) => {
      requireArea(tx, input.areaId)
      const inArea = tx
        .select()
        .from(diningTables)
        .where(
          and(
            eq(diningTables.areaId, input.areaId),
            isNull(diningTables.deletedAt),
            eq(diningTables.isActive, true)
          )
        )
        .all()
      const byId = new Map(inArea.map((row) => [row.id, row]))

      const requested = new Map<string, { positionX: number; positionY: number }>()
      for (const position of input.positions) {
        if (!byId.has(position.id)) {
          throw new AppError('NOT_FOUND', 'A table in this layout no longer belongs to the area.')
        }
        if (requested.has(position.id)) {
          throw new AppError('VALIDATION_ERROR', 'A table appears twice in the layout.')
        }
        requested.set(position.id, position)
      }

      // The finished layout must put one table in each cell.
      const finalCells = new Set<string>()
      for (const row of inArea) {
        const target = requested.get(row.id) ?? row
        const key = cellKey(target.positionX, target.positionY)
        if (finalCells.has(key)) {
          throw new AppError('CONFLICT', 'Two tables cannot share the same spot.')
        }
        finalCells.add(key)
      }

      const moves = [...requested.entries()].filter(([id, target]) => {
        const row = byId.get(id)
        return row && (row.positionX !== target.positionX || row.positionY !== target.positionY)
      })
      if (moves.length === 0) return

      // Tables may swap places, so park them off-grid first to keep the one-per-cell rule
      // satisfied at every step.
      moves.forEach(([id], index) => {
        tx.update(diningTables)
          .set({ positionX: -(index + 1), positionY: -1 })
          .where(eq(diningTables.id, id))
          .run()
      })
      for (const [id, target] of moves) {
        tx.update(diningTables)
          .set({
            positionX: target.positionX,
            positionY: target.positionY,
            ...markModified(diningTables)
          })
          .where(eq(diningTables.id, id))
          .run()
      }
      this.audit.record(
        {
          action: 'table.layout_updated',
          userId: auth.userId,
          username: auth.username,
          entityType: 'area',
          entityId: input.areaId,
          details: { movedTables: moves.length }
        },
        tx
      )
    })
    return this.list().filter((table) => table.areaId === input.areaId)
  }

  // --- Service: open and close -------------------------------------------------------------

  open(auth: AuthContext, input: OpenTableData): DiningTable {
    this.db.transaction((tx) => {
      const current = this.requireTable(tx, input.id)
      if (!current.isActive || !requireArea(tx, current.areaId).isActive) {
        throw new AppError('CONFLICT', 'This table is not in use. Activate it first.')
      }
      if (!OPENABLE.includes(current.status)) {
        throw new AppError('CONFLICT', unavailableMessage(current.status))
      }
      // Guarded by the expected status so two terminals can never both open the same table.
      const result = tx
        .update(diningTables)
        .set({
          status: 'OCCUPIED',
          openedAt: new Date(this.clock()),
          openedBy: auth.userId,
          guestCount: input.guestCount ?? null,
          ...markModified(diningTables)
        })
        .where(and(eq(diningTables.id, current.id), inArray(diningTables.status, [...OPENABLE])))
        .run()
      if (result.changes !== 1) {
        throw new AppError('CONFLICT', 'This table was just opened somewhere else.')
      }
      this.record(tx, auth, 'table.opened', current.id, {
        tableNumber: current.tableNumber,
        guestCount: input.guestCount ?? null
      })
    })
    return this.getById(input.id)
  }

  close(auth: AuthContext, id: string): DiningTable {
    return this.transition(auth, id, TRANSITIONS.close)
  }

  block(auth: AuthContext, id: string): DiningTable {
    return this.transition(auth, id, TRANSITIONS.block)
  }

  unblock(auth: AuthContext, id: string): DiningTable {
    return this.transition(auth, id, TRANSITIONS.unblock)
  }

  // --- Internals ---------------------------------------------------------------------------

  private transition(auth: AuthContext, id: string, step: Transition): DiningTable {
    this.db.transaction((tx) => {
      const current = this.requireTable(tx, id)
      if (!step.from.includes(current.status)) {
        throw new AppError('CONFLICT', step.refusal(current.status))
      }
      if (step.action === 'table.closed' && this.hasOpenOrder(tx, id)) {
        throw new AppError(
          'CONFLICT',
          'This table has an order in progress. Settle or cancel the order first.'
        )
      }
      const details: Record<string, unknown> = { tableNumber: current.tableNumber }
      if (step.action === 'table.closed' && current.openedAt) {
        details.openMinutes = Math.max(
          0,
          Math.round((this.clock() - current.openedAt.getTime()) / 60_000)
        )
      }

      const result = tx
        .update(diningTables)
        .set({
          status: step.to,
          ...(step.to === 'AVAILABLE' ? { openedAt: null, openedBy: null, guestCount: null } : {}),
          ...markModified(diningTables)
        })
        .where(and(eq(diningTables.id, id), inArray(diningTables.status, [...step.from])))
        .run()
      if (result.changes !== 1) {
        throw new AppError('CONFLICT', 'This table was just changed somewhere else.')
      }
      this.record(tx, auth, step.action, id, details)
    })
    return this.getById(id)
  }

  /** Whether an order that is not finished yet belongs to the table. */
  private hasOpenOrder(db: DbExecutor, tableId: string): boolean {
    return (
      db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.tableId, tableId),
            isNull(orders.deletedAt),
            notInArray(orders.status, [...CLOSED_ORDER_STATUSES])
          )
        )
        .get() !== undefined
    )
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: AuditAction,
    tableId: string,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'table',
        entityId: tableId,
        details
      },
      tx
    )
  }

  private requireTable(db: DbExecutor, id: string): TableRow {
    const row = db
      .select()
      .from(diningTables)
      .where(and(eq(diningTables.id, id), isNull(diningTables.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That table no longer exists.')
    return row
  }

  private getById(id: string): DiningTable {
    const found = this.load(eq(diningTables.id, id)).at(0)
    if (!found) throw new AppError('NOT_FOUND', 'That table no longer exists.')
    return found.table
  }

  /** Cells used by tables that are in service in an area. */
  private takenCells(db: DbExecutor, areaId: string): Set<string> {
    const rows = db
      .select({ x: diningTables.positionX, y: diningTables.positionY })
      .from(diningTables)
      .where(
        and(
          eq(diningTables.areaId, areaId),
          isNull(diningTables.deletedAt),
          eq(diningTables.isActive, true)
        )
      )
      .all()
    return new Set(rows.map((row) => cellKey(row.x, row.y)))
  }

  private assertNumberFree(
    db: DbExecutor,
    restaurantId: string,
    tableNumber: string,
    exceptId?: string
  ): void {
    const clash = db
      .select({ id: diningTables.id })
      .from(diningTables)
      .where(
        and(
          eq(diningTables.restaurantId, restaurantId),
          isNull(diningTables.deletedAt),
          sql`lower(${diningTables.tableNumber}) = ${tableNumber.toLowerCase()}`,
          exceptId ? ne(diningTables.id, exceptId) : undefined
        )
      )
      .get()
    if (clash) throw new AppError('CONFLICT', `Table number "${tableNumber}" is already used.`)
  }

  private load(where?: SQL): { table: DiningTable; areaSort: number }[] {
    const rows = this.db
      .select({
        row: diningTables,
        areaName: areas.name,
        areaSort: areas.sortOrder,
        openedByName: users.fullName
      })
      .from(diningTables)
      .innerJoin(areas, eq(diningTables.areaId, areas.id))
      .leftJoin(users, eq(diningTables.openedBy, users.id))
      .where(and(isNull(diningTables.deletedAt), isNull(areas.deletedAt), where))
      .all()

    return rows.map(({ row, areaName, areaSort, openedByName }) => ({
      areaSort,
      table: {
        id: row.id,
        areaId: row.areaId,
        areaName,
        tableNumber: row.tableNumber,
        displayName: row.displayName,
        capacity: row.capacity,
        type: row.type,
        status: row.status,
        positionX: row.positionX,
        positionY: row.positionY,
        isActive: row.isActive,
        openedAt: row.openedAt ? row.openedAt.toISOString() : null,
        openedByName,
        guestCount: row.guestCount
      }
    }))
  }
}
