import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAddonInputSchema,
  createCategoryInputSchema,
  createItemInputSchema,
  createStationInputSchema
} from '@shared/menu'
import {
  KOT_TRANSITIONS,
  cancelKotInputSchema,
  kotFilterSchema,
  setKotStatusInputSchema,
  type KotStatus
} from '@shared/kitchen'
import {
  addItemsInputSchema,
  cancelLineInputSchema,
  cancelOrderInputSchema,
  createOrderInputSchema,
  setOrderStatusInputSchema,
  type OrderLineInput
} from '@shared/orders'
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, diningTables, menuItems } from '@main/db/schema'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

describe('kitchen order tickets', () => {
  let app: TestApp
  let owner: AuthContext
  let tableId: string
  let tandoorStation: string
  let curryStation: string
  let naan: string
  let tikka: string
  let dal: string
  let soda: string
  let extraButter: string

  const station = (name: string) =>
    app.services.stations.create(owner, createStationInputSchema.parse({ name })).id
  const line = (menuItemId: string, extra: Partial<OrderLineInput> = {}): OrderLineInput => ({
    menuItemId,
    quantity: 1,
    ...extra
  })
  const dineIn = (lines: OrderLineInput[], atTable = tableId) =>
    app.services.orders.create(
      owner,
      createOrderInputSchema.parse({ type: 'DINE_IN', tableId: atTable, lines })
    )
  const add = (orderId: string, lines: OrderLineInput[]) =>
    app.services.orders.addItems(owner, addItemsInputSchema.parse({ orderId, lines }))
  const send = (orderId: string) => app.services.orders.sendAndGetKots(owner, orderId)
  /** The order's tickets, oldest first. */
  const kotsOf = (orderId: string) => app.services.orders.get(orderId).kots
  const move = (id: string, status: string) =>
    app.services.kots.setStatus(owner, setKotStatusInputSchema.parse({ id, status }))
  const tableStatus = () =>
    app.handle.db.select().from(diningTables).where(eq(diningTables.id, tableId)).get()?.status
  const kotAudit = () =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .all()
      .map((row) => row.action)
      .filter((action) => action.startsWith('kot.'))

  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
    const hall = app.services.areas.create(owner, createAreaInputSchema.parse({ name: 'Hall' }))
    tableId = app.services.tables.create(
      owner,
      createTableInputSchema.parse({ areaId: hall.id, tableNumber: 'T1', capacity: 4, type: 'AC' })
    ).id
    tandoorStation = station('Tandoor')
    curryStation = station('Curry')
    const make = (categoryName: string, stationId: string | null) =>
      app.services.categories.create(
        owner,
        createCategoryInputSchema.parse({ name: categoryName, stationId })
      ).id
    const breads = make('Breads', tandoorStation)
    const mains = make('Mains', curryStation)
    const drinks = make('Drinks', null)
    const item = (categoryId: string, name: string, price: number) =>
      app.services.items.create(
        owner,
        createItemInputSchema.parse({ categoryId, name, price, foodType: 'VEG' })
      ).id
    extraButter = app.services.addons.create(
      owner,
      createAddonInputSchema.parse({ name: 'Extra butter', kind: 'ADDON', price: 1000 })
    ).id
    naan = app.services.items.create(
      owner,
      createItemInputSchema.parse({
        categoryId: breads,
        name: 'Butter Naan',
        price: 6000,
        foodType: 'VEG',
        addonIds: [extraButter]
      })
    ).id
    tikka = item(breads, 'Paneer Tikka', 28000)
    dal = item(mains, 'Dal Makhani', 24000)
    soda = item(drinks, 'Soda', 4000)
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('issuing', () => {
    it('issues one ticket per kitchen station, numbered in order, when an order is sent', () => {
      const order = dineIn([line(naan, { quantity: 2 }), line(dal), line(tikka), line(soda)])
      const sent = send(order.id)
      expect(sent.kotIds).toHaveLength(3)
      const tickets = kotsOf(order.id)
      expect(tickets.map((kot) => kot.kotNumber)).toEqual([
        'TK-KOT-000001',
        'TK-KOT-000002',
        'TK-KOT-000003'
      ])
      const byStation = Object.fromEntries(tickets.map((kot) => [kot.stationName, kot]))
      expect(Object.keys(byStation).sort()).toEqual(['Curry', 'Kitchen', 'Tandoor'])
      expect(byStation.Tandoor?.itemCount).toBe(3)
      expect(byStation.Curry?.itemCount).toBe(1)
      expect(byStation.Kitchen?.stationId).toBeNull()
      expect(tickets.every((kot) => kot.status === 'NEW' && !kot.isAdditional)).toBe(true)
      expect(tickets.every((kot) => kot.printStatus === 'NOT_PRINTED')).toBe(true)
    })

    it('copies the names, sizes, extras and notes onto the ticket', () => {
      const order = dineIn([
        line(naan, { quantity: 3, addonIds: [extraButter], notes: 'Well done' })
      ])
      const [kotId] = send(order.id).kotIds
      const kot = app.services.kots.get(kotId ?? '')
      expect(kot).toMatchObject({
        orderNumber: order.orderNumber,
        tableNumber: 'T1',
        areaName: 'Hall',
        createdByName: 'Olivia Owner'
      })
      expect(kot.items).toHaveLength(1)
      expect(kot.items[0]).toMatchObject({
        name: 'Butter Naan',
        quantity: 3,
        notes: 'Well done',
        status: 'ACTIVE',
        addons: [{ name: 'Extra butter', kind: 'ADDON' }]
      })
    })

    it('makes an additional ticket for items sent later and never rewrites the first', () => {
      const order = dineIn([line(dal, { quantity: 2 })])
      send(order.id)
      const [first] = kotsOf(order.id)
      add(order.id, [line(dal, { quantity: 2 })])
      send(order.id)

      const tickets = kotsOf(order.id)
      expect(tickets.map((kot) => [kot.kotNumber, kot.isAdditional])).toEqual([
        ['TK-KOT-000001', false],
        ['TK-KOT-000002', true]
      ])
      const original = app.services.kots.get(first?.id ?? '')
      expect(original.items.map((item) => item.quantity)).toEqual([2])
      expect(original.revision).toBe(0)
      expect(
        app.services.kots.get(tickets[1]?.id ?? '').items.map((item) => item.quantity)
      ).toEqual([2])
    })

    it('keeps the ticket as it was when the menu changes afterwards', () => {
      const order = dineIn([line(dal)])
      const [kotId] = send(order.id).kotIds
      app.handle.db
        .update(menuItems)
        .set({ name: 'Renamed Dal' })
        .where(eq(menuItems.id, dal))
        .run()
      expect(app.services.kots.get(kotId ?? '').items[0]?.name).toBe('Dal Makhani')
    })

    it('shows the tickets on the order itself', () => {
      const order = dineIn([line(dal), line(naan)])
      expect(app.services.orders.get(order.id).kots).toEqual([])
      send(order.id)
      expect(
        app.services.orders
          .get(order.id)
          .kots.map((kot) => kot.stationName)
          .sort()
      ).toEqual(['Curry', 'Tandoor'])
    })

    it('issues nothing and changes nothing when there is nothing new to send', async () => {
      const order = dineIn([line(dal)])
      send(order.id)
      expect(await failureCode(() => send(order.id))).toBe('CONFLICT')
      expect(kotsOf(order.id)).toHaveLength(1)
    })

    it('records the issue in the audit log', () => {
      send(dineIn([line(dal), line(naan)]).id)
      expect(kotAudit().filter((action) => action === 'kot.created')).toHaveLength(2)
    })
  })

  describe('kitchen progress', () => {
    it('moves a ticket through the kitchen and the order follows', () => {
      const order = dineIn([line(dal)])
      const [kotId = ''] = send(order.id).kotIds
      expect(app.services.orders.get(order.id).status).toBe('CONFIRMED')

      expect(move(kotId, 'ACCEPTED')).toMatchObject({ status: 'ACCEPTED' })
      expect(app.services.orders.get(order.id).status).toBe('KOT_PENDING')
      expect(tableStatus()).toBe('KOT_PENDING')

      move(kotId, 'PREPARING')
      expect(app.services.orders.get(order.id).status).toBe('PREPARING')
      expect(tableStatus()).toBe('PREPARING')

      move(kotId, 'READY')
      expect(app.services.orders.get(order.id).status).toBe('READY')
      expect(tableStatus()).toBe('READY')

      const served = move(kotId, 'SERVED')
      expect(served.status).toBe('SERVED')
      expect(app.services.orders.get(order.id).status).toBe('SERVED')
      expect(
        served.acceptedAt && served.preparingAt && served.readyAt && served.servedAt
      ).toBeTruthy()
      expect(kotAudit().filter((action) => action === 'kot.status_changed')).toHaveLength(4)
    })

    it('only follows the allowed steps', async () => {
      const [kotId = ''] = send(dineIn([line(dal)]).id).kotIds
      expect(await failureCode(() => move(kotId, 'READY'))).toBe('CONFLICT')
      expect(await failureCode(() => move(kotId, 'SERVED'))).toBe('CONFLICT')
      move(kotId, 'ACCEPTED')
      expect(await failureCode(() => move(kotId, 'ACCEPTED'))).toBe('CONFLICT')
      expect(
        setKotStatusInputSchema.safeParse({ id: crypto.randomUUID(), status: 'NEW' }).success
      ).toBe(false)
      expect(
        setKotStatusInputSchema.safeParse({ id: crypto.randomUUID(), status: 'CANCELLED' }).success
      ).toBe(false)
      const closed: KotStatus[] = ['SERVED', 'CANCELLED']
      for (const status of closed) expect(KOT_TRANSITIONS[status]).toEqual([])
    })

    it('keeps the order in the right state while stations finish at different times', () => {
      const order = dineIn([line(naan), line(dal)])
      const kots = send(order.id).kotIds
      const [first = '', second = ''] = kots
      for (const status of ['ACCEPTED', 'PREPARING', 'READY'] as const) move(first, status)
      // One station is ready, the other has not even looked: the order is waiting on the kitchen.
      expect(app.services.orders.get(order.id).status).toBe('CONFIRMED')
      move(second, 'ACCEPTED')
      expect(app.services.orders.get(order.id).status).toBe('KOT_PENDING')
      move(second, 'PREPARING')
      expect(app.services.orders.get(order.id).status).toBe('PREPARING')
      move(second, 'READY')
      expect(app.services.orders.get(order.id).status).toBe('READY')
      move(first, 'SERVED')
      expect(app.services.orders.get(order.id).status).toBe('READY')
      move(second, 'SERVED')
      expect(app.services.orders.get(order.id).status).toBe('SERVED')
    })

    it('puts the order back to confirmed when an additional ticket arrives', () => {
      const order = dineIn([line(dal)])
      const [kotId = ''] = send(order.id).kotIds
      for (const status of ['ACCEPTED', 'PREPARING', 'READY'] as const) move(kotId, status)
      add(order.id, [line(dal)])
      send(order.id)
      expect(app.services.orders.get(order.id).status).toBe('CONFIRMED')
    })

    it('lets staff mark the order served by hand, which serves the open tickets', () => {
      const order = dineIn([line(dal), line(naan)])
      send(order.id)
      app.services.orders.setStatus(
        owner,
        setOrderStatusInputSchema.parse({ id: order.id, status: 'SERVED' })
      )
      expect(kotsOf(order.id).every((kot) => kot.status === 'SERVED')).toBe(true)
    })

    it('refuses kitchen steps once the bill is requested', async () => {
      const order = dineIn([line(dal)])
      const [kotId = ''] = send(order.id).kotIds
      app.services.orders.setStatus(
        owner,
        setOrderStatusInputSchema.parse({ id: order.id, status: 'SERVED' })
      )
      app.services.orders.setStatus(
        owner,
        setOrderStatusInputSchema.parse({ id: order.id, status: 'BILL_REQUESTED' })
      )
      expect(await failureCode(() => move(kotId, 'ACCEPTED'))).toBe('CONFLICT')
    })
  })

  describe('cancelling', () => {
    it('cancels a whole ticket with a reason and takes its items off the bill', () => {
      const order = dineIn([line(dal, { quantity: 2 }), line(naan)])
      send(order.id)
      const curry = kotsOf(order.id).find((kot) => kot.stationName === 'Curry')
      const cancelled = app.services.kots.cancel(
        owner,
        cancelKotInputSchema.parse({ id: curry?.id, reason: 'Kitchen ran out of dal' })
      )
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Kitchen ran out of dal',
        itemCount: 0
      })
      expect(cancelled.items.every((item) => item.status === 'CANCELLED')).toBe(true)
      const after = app.services.orders.get(order.id)
      expect(after.subtotal).toBe(6000)
      expect(after.lines.find((l) => l.name === 'Dal Makhani')?.status).toBe('CANCELLED')
      expect(kotAudit()).toContain('kot.cancelled')
    })

    it('needs a reason and refuses to change a cancelled or served ticket', async () => {
      const order = dineIn([line(dal), line(naan)])
      send(order.id)
      const [a, b] = kotsOf(order.id)
      expect(cancelKotInputSchema.safeParse({ id: crypto.randomUUID(), reason: '' }).success).toBe(
        false
      )
      app.services.kots.cancel(
        owner,
        cancelKotInputSchema.parse({ id: a?.id, reason: 'Wrong table' })
      )
      expect(
        await failureCode(() =>
          app.services.kots.cancel(
            owner,
            cancelKotInputSchema.parse({ id: a?.id, reason: 'Again' })
          )
        )
      ).toBe('CONFLICT')
      expect(await failureCode(() => move(a?.id ?? '', 'ACCEPTED'))).toBe('CONFLICT')
      for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'SERVED'] as const) {
        move(b?.id ?? '', status)
      }
      expect(
        await failureCode(() =>
          app.services.kots.cancel(
            owner,
            cancelKotInputSchema.parse({ id: b?.id, reason: 'Too late' })
          )
        )
      ).toBe('CONFLICT')
    })

    it('revises the ticket when one of its items is cancelled', () => {
      const order = dineIn([line(dal), line(naan), line(tikka)])
      send(order.id)
      const naanLine = app.services.orders.get(order.id).lines.find((l) => l.name === 'Butter Naan')
      app.services.orders.cancelLine(
        owner,
        cancelLineInputSchema.parse({
          orderId: order.id,
          lineId: naanLine?.id,
          reason: 'Guest changed mind'
        })
      )
      const tandoor = app.services.kots.get(
        kotsOf(order.id).find((kot) => kot.stationName === 'Tandoor')?.id ?? ''
      )
      expect(tandoor.status).toBe('NEW')
      expect(tandoor.revision).toBe(1)
      expect(tandoor.itemCount).toBe(1)
      expect(tandoor.items.map((item) => [item.name, item.status])).toEqual([
        ['Butter Naan', 'CANCELLED'],
        ['Paneer Tikka', 'ACTIVE']
      ])
      expect(tandoor.items[0]?.cancelReason).toBe('Guest changed mind')
      expect(kotAudit()).toContain('kot.item_cancelled')
    })

    it('cancels a ticket when its last item is cancelled', () => {
      const order = dineIn([line(dal), line(naan)])
      send(order.id)
      const dalLine = app.services.orders.get(order.id).lines.find((l) => l.name === 'Dal Makhani')
      app.services.orders.cancelLine(
        owner,
        cancelLineInputSchema.parse({
          orderId: order.id,
          lineId: dalLine?.id,
          reason: 'Out of stock'
        })
      )
      const curry = kotsOf(order.id).find((kot) => kot.stationName === 'Curry')
      expect(curry).toMatchObject({ status: 'CANCELLED', itemCount: 0 })
      // The other station's ticket is untouched.
      expect(kotsOf(order.id).find((kot) => kot.stationName === 'Tandoor')?.status).toBe('NEW')
    })

    it('cancels the open tickets when the order is cancelled', () => {
      const order = dineIn([line(dal), line(naan)])
      send(order.id)
      const [a] = kotsOf(order.id)
      move(a?.id ?? '', 'ACCEPTED')
      app.services.orders.cancel(
        owner,
        cancelOrderInputSchema.parse({ id: order.id, reason: 'Guests left' })
      )
      const tickets = kotsOf(order.id)
      expect(tickets.every((kot) => kot.status === 'CANCELLED')).toBe(true)
      expect(tickets.every((kot) => kot.cancelReason === 'Guests left')).toBe(true)
      expect(tableStatus()).toBe('AVAILABLE')
    })
  })

  describe('immutability', () => {
    it('refuses to rewrite or delete an issued ticket at the database level', () => {
      const order = dineIn([line(dal, { quantity: 2 })])
      const [kotId = ''] = send(order.id).kotIds
      const sqlite = app.handle.sqlite
      expect(() =>
        sqlite.prepare("update kots set kot_number = 'TK-KOT-999999' where id = ?").run(kotId)
      ).toThrow(/cannot be rewritten/)
      expect(() =>
        sqlite.prepare('update kots set station_name = ? where id = ?').run('X', kotId)
      ).toThrow(/cannot be rewritten/)
      expect(() => sqlite.prepare('delete from kots where id = ?').run(kotId)).toThrow(
        /cannot be deleted/
      )
      expect(() =>
        sqlite.prepare('update kot_items set quantity = 9 where kot_id = ?').run(kotId)
      ).toThrow(/cannot be rewritten/)
      expect(() =>
        sqlite.prepare("update kot_items set item_name = 'Other' where kot_id = ?").run(kotId)
      ).toThrow(/cannot be rewritten/)
      expect(() => sqlite.prepare('delete from kot_items where kot_id = ?').run(kotId)).toThrow(
        /cannot be deleted/
      )
      // The kitchen's own progress is still allowed.
      expect(() =>
        sqlite.prepare("update kots set status = 'ACCEPTED' where id = ?").run(kotId)
      ).not.toThrow()
    })

    it('does not let a cancelled item come back', () => {
      const order = dineIn([line(dal), line(naan)])
      send(order.id)
      const dalLine = app.services.orders.get(order.id).lines.find((l) => l.name === 'Dal Makhani')
      app.services.orders.cancelLine(
        owner,
        cancelLineInputSchema.parse({
          orderId: order.id,
          lineId: dalLine?.id,
          reason: 'Out of stock'
        })
      )
      expect(() =>
        app.handle.sqlite
          .prepare("update kot_items set status = 'ACTIVE' where status = 'CANCELLED'")
          .run()
      ).toThrow(/cannot be restored/)
    })
  })

  describe('listing', () => {
    it('filters by order, station, status and search, and lists open tickets oldest first', () => {
      const first = dineIn([line(dal), line(naan)])
      send(first.id)
      const hall = app.services.areas.list()[0]
      const second = dineIn(
        [line(dal)],
        app.services.tables.create(
          owner,
          createTableInputSchema.parse({
            areaId: hall?.id,
            tableNumber: 'T2',
            capacity: 2,
            type: 'AC'
          })
        ).id
      )
      send(second.id)

      expect(app.services.kots.list({})).toHaveLength(3)
      expect(kotsOf(second.id)).toHaveLength(1)
      expect(app.services.kots.list({ stationId: curryStation })).toHaveLength(2)
      expect(app.services.kots.list({ search: 'KOT-000003' })).toHaveLength(1)
      expect(app.services.kots.list({ search: second.orderNumber })).toHaveLength(1)

      const [firstKot] = kotsOf(first.id)
      app.services.kots.cancel(
        owner,
        cancelKotInputSchema.parse({ id: firstKot?.id, reason: 'Mistake' })
      )
      expect(app.services.kots.list({ openOnly: true })).toHaveLength(2)
      expect(app.services.kots.list({ statuses: ['CANCELLED'] })).toHaveLength(1)
      expect(app.services.kots.list({ openOnly: true }).map((kot) => kot.kotNumber)).toEqual([
        'TK-KOT-000002',
        'TK-KOT-000003'
      ])
    })

    it('builds the kitchen board: open tickets with items, recent cancellations, no served ones', () => {
      const order = dineIn([line(dal), line(naan, { quantity: 2 })])
      send(order.id)
      const board = app.services.kots.board()
      expect(board.map((kot) => kot.stationName).sort()).toEqual(['Curry', 'Tandoor'])
      expect(board.find((kot) => kot.stationName === 'Tandoor')?.items[0]).toMatchObject({
        name: 'Butter Naan',
        quantity: 2
      })
      expect(app.services.kots.board(curryStation)).toHaveLength(1)

      const tandoor = kotsOf(order.id).find((kot) => kot.stationName === 'Tandoor')
      const curry = kotsOf(order.id).find((kot) => kot.stationName === 'Curry')
      app.services.kots.cancel(
        owner,
        cancelKotInputSchema.parse({ id: tandoor?.id, reason: 'Mistake' })
      )
      for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'SERVED'])
        move(curry?.id ?? '', status)
      const after = app.services.kots.board()
      expect(after.map((kot) => kot.status)).toEqual(['CANCELLED'])
    })

    it('validates the filter', () => {
      expect(kotFilterSchema.safeParse({ statuses: ['NOPE'] }).success).toBe(false)
      expect(kotFilterSchema.safeParse({ limit: 0 }).success).toBe(false)
      expect(kotFilterSchema.safeParse({ openOnly: true, search: 'TK' }).success).toBe(true)
    })

    it('reports a missing ticket', async () => {
      expect(await failureCode(() => app.services.kots.get(crypto.randomUUID()))).toBe('NOT_FOUND')
    })
  })
})
