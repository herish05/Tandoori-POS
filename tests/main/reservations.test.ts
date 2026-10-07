import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cancelReservationInputSchema,
  createReservationInputSchema,
  reservationFilterSchema,
  seatReservationInputSchema,
  updateReservationInputSchema,
  type Reservation
} from '@shared/reservations'
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

const MINUTE = 60_000

describe('reservations', () => {
  let app: TestApp
  let owner: AuthContext
  let t1: string // seats 4
  let t2: string // seats 2

  const at = (minutes: number) => new Date(app.clock.now + minutes * MINUTE).toISOString()
  const book = (extra: Record<string, unknown> = {}) =>
    app.services.reservations.create(
      owner,
      createReservationInputSchema.parse({
        guestName: 'Harpreet',
        guestPhone: '98765 43210',
        partySize: 3,
        reservedFor: at(120),
        tableId: t1,
        ...extra
      })
    )
  const seat = (id: string, tableId?: string) =>
    app.services.reservations.seat(owner, seatReservationInputSchema.parse({ id, tableId }))
  const tableNow = (id: string) => app.services.tables.list().find((table) => table.id === id)

  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
    const hall = app.services.areas.create(owner, createAreaInputSchema.parse({ name: 'Hall' }))
    const table = (tableNumber: string, capacity: number) =>
      app.services.tables.create(
        owner,
        createTableInputSchema.parse({ areaId: hall.id, tableNumber, capacity, type: 'AC' })
      ).id
    t1 = table('T1', 4)
    t2 = table('T2', 2)
  })

  afterEach(() => {
    app.cleanup()
  })

  describe('booking', () => {
    it('keeps the guest, time, table and a default slot length', () => {
      const booked = book({ notes: 'Birthday' })
      expect(booked.status).toBe('BOOKED')
      expect(booked.guestPhone).toBe('9876543210')
      expect(booked.tableNumber).toBe('T1')
      expect(booked.durationMinutes).toBe(90)
      expect(booked.notes).toBe('Birthday')
      expect(new Date(booked.endsAt).getTime() - new Date(booked.reservedFor).getTime()).toBe(
        90 * MINUTE
      )
    })

    it('can be made without a table', () => {
      const booked = book({ tableId: null })
      expect(booked.tableId).toBeNull()
    })

    it('records the guest as a customer', () => {
      const booked = book()
      expect(booked.customerId).not.toBeNull()
      expect(app.services.customers.get(booked.customerId ?? '').name).toBe('Harpreet')
    })

    it('refuses a table that is too small, a past time or one too far ahead', async () => {
      expect(() => book({ tableId: t2, partySize: 3 })).toThrow(/seats 2/)
      expect(() => book({ reservedFor: at(-60) })).toThrow(/already passed/)
      expect(() => book({ reservedFor: at(200 * 24 * 60) })).toThrow(/too far ahead/)
      expect(await failureCode(() => book({ reservedFor: at(-60) }))).toBe('VALIDATION_ERROR')
      expect(createReservationInputSchema.safeParse({ partySize: 0 }).success).toBe(false)
    })

    it('refuses a table that is already booked at an overlapping time', async () => {
      book({ reservedFor: at(120) })
      expect(await failureCode(() => book({ reservedFor: at(180) }))).toBe('CONFLICT')
      expect(() => book({ guestName: 'Other', reservedFor: at(60) })).toThrow(/already booked/)
      // Back to back is fine, and so is another table.
      expect(book({ reservedFor: at(210) }).status).toBe('BOOKED')
      expect(book({ reservedFor: at(120), tableId: t2, partySize: 2 }).status).toBe('BOOKED')
    })

    it('can be changed while booked, without clashing with itself', () => {
      const booked = book()
      const updated = app.services.reservations.update(
        owner,
        updateReservationInputSchema.parse({
          id: booked.id,
          guestName: 'Harpreet S',
          guestPhone: booked.guestPhone,
          partySize: 4,
          reservedFor: at(150),
          tableId: t1,
          notes: null
        })
      )
      expect(updated.guestName).toBe('Harpreet S')
      expect(updated.partySize).toBe(4)
      expect(updated.reservedFor).toBe(at(150))
    })
  })

  describe('listing', () => {
    it('filters by day range, status and search, in time order', () => {
      const late = book({ reservedFor: at(600), tableId: t2, partySize: 2 })
      const early = book({ reservedFor: at(120) })
      const cancelled = book({
        guestName: 'Simran',
        guestPhone: '90000 11111',
        reservedFor: at(300)
      })
      app.services.reservations.cancel(
        owner,
        cancelReservationInputSchema.parse({ id: cancelled.id })
      )

      const list = (filter: Record<string, unknown>) =>
        app.services.reservations.list(reservationFilterSchema.parse(filter)).map((r) => r.id)
      expect(list({})).toEqual([early.id, cancelled.id, late.id])
      expect(list({ from: at(200), to: at(400) })).toEqual([cancelled.id])
      expect(list({ statuses: ['BOOKED'] })).toEqual([early.id, late.id])
      expect(list({ search: 'simran' })).toEqual([cancelled.id])
      expect(list({ search: '90000' })).toEqual([cancelled.id])
      expect(list({ tableId: t2 })).toEqual([late.id])
    })
  })

  describe('cancel and no-show', () => {
    it('cancels with a reason and frees the slot', () => {
      const booked = book()
      const cancelled = app.services.reservations.cancel(
        owner,
        cancelReservationInputSchema.parse({ id: booked.id, reason: 'Plans changed' })
      )
      expect(cancelled.status).toBe('CANCELLED')
      expect(cancelled.cancelReason).toBe('Plans changed')
      expect(book().status).toBe('BOOKED')
    })

    it('marks a no-show only once the booking time has come', async () => {
      const booked = book({ reservedFor: at(60) })
      expect(await failureCode(() => app.services.reservations.noShow(owner, booked.id))).toBe(
        'CONFLICT'
      )
      app.clock.advance(61 * MINUTE)
      expect(app.services.reservations.noShow(owner, booked.id).status).toBe('NO_SHOW')
    })

    it('are final: a closed reservation cannot be changed again', async () => {
      const booked = book()
      app.services.reservations.cancel(owner, cancelReservationInputSchema.parse({ id: booked.id }))
      expect(
        await failureCode(() =>
          app.services.reservations.cancel(
            owner,
            cancelReservationInputSchema.parse({ id: booked.id })
          )
        )
      ).toBe('CONFLICT')
      expect(await failureCode(() => seat(booked.id))).toBe('CONFLICT')
      expect(() =>
        app.handle.sqlite
          .prepare("update reservations set status = 'BOOKED' where id = ?")
          .run(booked.id)
      ).toThrow(/cannot be reopened/)
      expect(() =>
        app.handle.sqlite.prepare('delete from reservations where id = ?').run(booked.id)
      ).toThrow(/cannot be deleted/)
    })
  })

  describe('seating', () => {
    it('opens the table for the party and closes the booking', () => {
      const booked = book({ partySize: 3 })
      const seated: Reservation = seat(booked.id)
      expect(seated.status).toBe('SEATED')
      expect(seated.seatedAt).not.toBeNull()
      const table = tableNow(t1)
      expect(table?.status).toBe('OCCUPIED')
      expect(table?.guestCount).toBe(3)
    })

    it('needs a table when the booking has none, and checks the chosen one', async () => {
      const booked = book({ tableId: null })
      expect(await failureCode(() => seat(booked.id))).toBe('VALIDATION_ERROR')
      expect(() => seat(booked.id, t2)).toThrow(/seats 2/)
      expect(seat(booked.id, t1).tableId).toBe(t1)
    })

    it('can seat the guests at a different free table than the one booked', () => {
      const booked = book({ partySize: 2 })
      const seated = seat(booked.id, t2)
      expect(seated.tableId).toBe(t2)
      expect(tableNow(t2)?.status).toBe('OCCUPIED')
      expect(tableNow(t1)?.status).not.toBe('OCCUPIED')
    })

    it('is all or nothing: a table that is already open leaves the booking untouched', async () => {
      app.services.tables.open(owner, { id: t1, guestCount: 2 })
      const booked = book()
      expect(await failureCode(() => seat(booked.id))).toBe('CONFLICT')
      expect(app.services.reservations.get(booked.id).status).toBe('BOOKED')
    })
  })

  describe('on the floor', () => {
    const floorTable = (id: string) =>
      app.services.tables
        .floor()
        .flatMap((area) => area.tables)
        .find((table) => table.id === id)

    it('shows a free table as reserved from an hour before the booking', () => {
      const booked = book({ reservedFor: at(120) })
      expect(floorTable(t1)?.status).toBe('AVAILABLE')
      expect(floorTable(t1)?.reservedFor).toBeNull()

      app.clock.advance(61 * MINUTE)
      const held = floorTable(t1)
      expect(held?.status).toBe('RESERVED')
      expect(held?.reservationId).toBe(booked.id)
      expect(held?.reservedName).toBe('Harpreet')
      expect(held?.reservedFor).toBe(booked.reservedFor)
      expect(floorTable(t2)?.status).toBe('AVAILABLE')
    })

    it('stops holding the table once the booking is cancelled or the slot is over', () => {
      const booked = book({ reservedFor: at(30) })
      expect(floorTable(t1)?.status).toBe('RESERVED')
      app.services.reservations.cancel(owner, cancelReservationInputSchema.parse({ id: booked.id }))
      expect(floorTable(t1)?.status).toBe('AVAILABLE')

      book({ reservedFor: at(30) })
      expect(floorTable(t1)?.status).toBe('RESERVED')
      app.clock.advance((30 + 91) * MINUTE)
      expect(floorTable(t1)?.status).toBe('AVAILABLE')
    })

    it('a reserved table can still be opened for a walk-in', () => {
      book({ reservedFor: at(30) })
      app.services.tables.open(owner, { id: t1 })
      expect(floorTable(t1)?.status).toBe('OCCUPIED')
      expect(floorTable(t1)?.reservedFor).toBeNull()
    })
  })

  it('writes every step to the audit log', () => {
    const booked = book()
    seat(booked.id)
    const actions = app.handle.sqlite
      .prepare("select action from audit_logs where action like 'reservation.%' order by rowid")
      .all() as { action: string }[]
    expect(actions.map((a) => a.action)).toEqual(['reservation.created', 'reservation.seated'])
  })
})
