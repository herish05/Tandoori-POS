import { and, asc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext, Clock } from '../auth/types'
import { linkCustomer } from '../customers/customer-link'
import type { AppDatabase, DbExecutor } from '../db/client'
import { areas, diningTables, markModified, reservations, users } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import type { TableService } from '../tables/table-service'
import {
  MAX_RESERVE_AHEAD_MS,
  RESERVE_PAST_GRACE_MS,
  type CancelReservationData,
  type CreateReservationData,
  type Reservation,
  type ReservationFilterData,
  type SeatReservationData,
  type UpdateReservationData
} from '@shared/reservations'

type ReservationRow = typeof reservations.$inferSelect

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (match) => `\\${match}`)

interface Slot {
  tableId: string | null
  partySize: number
  start: Date
  durationMinutes: number
}

export class ReservationService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly tables: TableService
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  list(filter: ReservationFilterData = {}): Reservation[] {
    const conditions: SQL[] = []
    if (filter.from) conditions.push(gte(reservations.reservedFor, new Date(filter.from)))
    if (filter.to) conditions.push(lt(reservations.reservedFor, new Date(filter.to)))
    if (filter.statuses && filter.statuses.length > 0) {
      conditions.push(inArray(reservations.status, filter.statuses))
    }
    if (filter.tableId) conditions.push(eq(reservations.tableId, filter.tableId))
    if (filter.search) {
      const like = `%${escapeLike(filter.search)}%`
      const digits = filter.search.replace(/\D/g, '')
      conditions.push(
        digits.length >= 2
          ? sql`(${reservations.guestName} like ${like} escape '\\' or ${reservations.guestPhone} like ${`%${digits}%`})`
          : sql`${reservations.guestName} like ${like} escape '\\'`
      )
    }
    return this.load(this.db, conditions).slice(0, filter.limit ?? 300)
  }

  get(id: string): Reservation {
    const found = this.load(this.db, [eq(reservations.id, id)]).at(0)
    if (!found) throw new AppError('NOT_FOUND', 'That reservation no longer exists.')
    return found
  }

  // --- Writes ------------------------------------------------------------------------------

  create(auth: AuthContext, input: CreateReservationData): Reservation {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      const start = this.checkTime(input.reservedFor)
      this.checkSlot(tx, {
        tableId: input.tableId,
        partySize: input.partySize,
        start,
        durationMinutes: input.durationMinutes
      })
      const customerId = linkCustomer(
        tx,
        this.audit,
        auth,
        restaurantId,
        { name: input.guestName, phone: input.guestPhone, address: null },
        'reservation'
      )
      const row = tx
        .insert(reservations)
        .values({
          restaurantId,
          customerId,
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          partySize: input.partySize,
          reservedFor: start,
          durationMinutes: input.durationMinutes,
          tableId: input.tableId,
          notes: input.notes,
          createdBy: auth.userId
        })
        .returning()
        .get()
      this.record(tx, auth, 'reservation.created', row.id, {
        partySize: row.partySize,
        reservedFor: start.toISOString(),
        tableId: row.tableId
      })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateReservationData): Reservation {
    this.db.transaction((tx) => {
      const current = this.requireBooked(tx, input.id)
      const start = new Date(input.reservedFor)
      // A time already on the booking may stay as it is even once it has passed.
      const timeChanged = start.getTime() !== current.reservedFor.getTime()
      if (timeChanged) this.checkTime(input.reservedFor)
      this.checkSlot(
        tx,
        {
          tableId: input.tableId,
          partySize: input.partySize,
          start,
          durationMinutes: input.durationMinutes
        },
        current.id
      )
      const customerId =
        input.guestPhone === current.guestPhone
          ? current.customerId
          : linkCustomer(
              tx,
              this.audit,
              auth,
              current.restaurantId,
              { name: input.guestName, phone: input.guestPhone, address: null },
              'reservation'
            )
      const next = {
        customerId,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        partySize: input.partySize,
        durationMinutes: input.durationMinutes,
        tableId: input.tableId,
        notes: input.notes
      }
      const changed: string[] = (Object.keys(next) as (keyof typeof next)[]).filter(
        (field) => next[field] !== current[field]
      )
      if (timeChanged) changed.push('reservedFor')
      if (changed.length === 0) return
      tx.update(reservations)
        .set({ ...next, reservedFor: start, ...markModified(reservations) })
        .where(eq(reservations.id, current.id))
        .run()
      this.record(tx, auth, 'reservation.updated', current.id, { changedFields: changed })
    })
    return this.get(input.id)
  }

  cancel(auth: AuthContext, input: CancelReservationData): Reservation {
    this.finish(auth, input.id, 'CANCELLED', 'reservation.cancelled', input.reason)
    return this.get(input.id)
  }

  /** The guests did not come. Only possible once the booking time has been reached. */
  noShow(auth: AuthContext, id: string): Reservation {
    this.finish(auth, id, 'NO_SHOW', 'reservation.no_show', null)
    return this.get(id)
  }

  /** The guests arrived: opens the table for them and closes the booking, all or nothing. */
  seat(auth: AuthContext, input: SeatReservationData): Reservation {
    this.db.transaction((tx) => {
      const current = this.requireBooked(tx, input.id)
      const tableId = input.tableId ?? current.tableId
      if (!tableId) throw new AppError('VALIDATION_ERROR', 'Choose a table to seat the guests at.')
      if (tableId !== current.tableId) {
        this.checkSlot(
          tx,
          {
            tableId,
            partySize: current.partySize,
            start: current.reservedFor,
            durationMinutes: current.durationMinutes
          },
          current.id
        )
      }
      this.tables.openWithin(tx, auth, { id: tableId, guestCount: current.partySize })
      const result = tx
        .update(reservations)
        .set({
          status: 'SEATED',
          tableId,
          seatedAt: new Date(this.clock()),
          seatedBy: auth.userId,
          ...markModified(reservations)
        })
        .where(and(eq(reservations.id, current.id), eq(reservations.status, 'BOOKED')))
        .run()
      if (result.changes !== 1) {
        throw new AppError('CONFLICT', 'This reservation was just changed somewhere else.')
      }
      this.record(tx, auth, 'reservation.seated', current.id, {
        tableId,
        partySize: current.partySize
      })
    })
    return this.get(input.id)
  }

  // --- Internals ---------------------------------------------------------------------------

  private finish(
    auth: AuthContext,
    id: string,
    status: 'CANCELLED' | 'NO_SHOW',
    action: AuditAction,
    reason: string | null
  ): void {
    this.db.transaction((tx) => {
      const current = this.requireBooked(tx, id)
      if (status === 'NO_SHOW' && this.clock() < current.reservedFor.getTime()) {
        throw new AppError(
          'CONFLICT',
          'The booking time has not come yet. Cancel it instead if the guests are not coming.'
        )
      }
      const result = tx
        .update(reservations)
        .set({
          status,
          cancelReason: reason,
          cancelledAt: new Date(this.clock()),
          cancelledBy: auth.userId,
          ...markModified(reservations)
        })
        .where(and(eq(reservations.id, id), eq(reservations.status, 'BOOKED')))
        .run()
      if (result.changes !== 1) {
        throw new AppError('CONFLICT', 'This reservation was just changed somewhere else.')
      }
      this.record(tx, auth, action, id, { reason })
    })
  }

  /** The booking time must be neither long gone nor absurdly far ahead. */
  private checkTime(iso: string): Date {
    const start = new Date(iso)
    const now = this.clock()
    if (start.getTime() < now - RESERVE_PAST_GRACE_MS) {
      throw new AppError('VALIDATION_ERROR', 'The booking time has already passed.')
    }
    if (start.getTime() > now + MAX_RESERVE_AHEAD_MS) {
      throw new AppError('VALIDATION_ERROR', 'That booking time is too far ahead.')
    }
    return start
  }

  /** A table must be in service, big enough, and free for the whole slot. */
  private checkSlot(tx: DbExecutor, slot: Slot, exceptId?: string): void {
    if (!slot.tableId) return
    const table = tx
      .select({
        id: diningTables.id,
        displayName: diningTables.displayName,
        capacity: diningTables.capacity,
        isActive: diningTables.isActive
      })
      .from(diningTables)
      .where(and(eq(diningTables.id, slot.tableId), isNull(diningTables.deletedAt)))
      .get()
    if (!table) throw new AppError('NOT_FOUND', 'That table no longer exists.')
    if (!table.isActive) throw new AppError('CONFLICT', `${table.displayName} is not in use.`)
    if (slot.partySize > table.capacity) {
      throw new AppError(
        'CONFLICT',
        `${table.displayName} seats ${String(table.capacity)}. Choose a bigger table.`
      )
    }
    const start = slot.start.getTime()
    const end = start + slot.durationMinutes * 60_000
    const clash = tx
      .select({ guestName: reservations.guestName, reservedFor: reservations.reservedFor })
      .from(reservations)
      .where(
        and(
          eq(reservations.tableId, slot.tableId),
          eq(reservations.status, 'BOOKED'),
          isNull(reservations.deletedAt),
          exceptId ? ne(reservations.id, exceptId) : undefined,
          sql`${reservations.reservedFor} < ${end}`,
          sql`${reservations.reservedFor} + ${reservations.durationMinutes} * 60000 > ${start}`
        )
      )
      .get()
    if (clash) {
      throw new AppError(
        'CONFLICT',
        `${table.displayName} is already booked for ${clash.guestName} around that time.`
      )
    }
  }

  private requireBooked(db: DbExecutor, id: string): ReservationRow {
    const row = db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, id), isNull(reservations.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That reservation no longer exists.')
    if (row.status !== 'BOOKED') {
      throw new AppError('CONFLICT', 'This reservation is already closed and cannot be changed.')
    }
    return row
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: AuditAction,
    id: string,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'reservation',
        entityId: id,
        details
      },
      tx
    )
  }

  private load(db: DbExecutor, conditions: SQL[]): Reservation[] {
    const creator = alias(users, 'creator')
    const rows = db
      .select({
        row: reservations,
        tableNumber: diningTables.tableNumber,
        tableName: diningTables.displayName,
        areaName: areas.name,
        createdByName: creator.fullName
      })
      .from(reservations)
      .leftJoin(diningTables, eq(reservations.tableId, diningTables.id))
      .leftJoin(areas, eq(diningTables.areaId, areas.id))
      .innerJoin(creator, eq(reservations.createdBy, creator.id))
      .where(and(isNull(reservations.deletedAt), ...conditions))
      .orderBy(asc(reservations.reservedFor), asc(reservations.createdAt))
      .all()
    return rows.map(({ row, tableNumber, tableName, areaName, createdByName }) => ({
      id: row.id,
      customerId: row.customerId,
      guestName: row.guestName,
      guestPhone: row.guestPhone,
      partySize: row.partySize,
      reservedFor: row.reservedFor.toISOString(),
      durationMinutes: row.durationMinutes,
      endsAt: new Date(row.reservedFor.getTime() + row.durationMinutes * 60_000).toISOString(),
      tableId: row.tableId,
      tableNumber,
      tableName,
      areaName,
      status: row.status,
      notes: row.notes,
      seatedAt: row.seatedAt ? row.seatedAt.toISOString() : null,
      cancelReason: row.cancelReason,
      cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
      createdByName,
      createdAt: row.createdAt.toISOString()
    }))
  }
}
