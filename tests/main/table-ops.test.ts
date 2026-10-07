import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import { generateBillInputSchema } from '@shared/billing'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import {
  createOrderInputSchema,
  setOrderStatusInputSchema,
  type OrderDetail,
  type OrderLineInput
} from '@shared/orders'
import type { PermissionCode } from '@shared/permissions'
import { mergeTablesInputSchema, shiftTableInputSchema } from '@shared/table-ops'
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { createIpcRegistrar } from '@main/ipc/registrar'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, kots, orders, tableOperations } from '@main/db/schema'
import { registerTableHandlers } from '@main/table-handlers'
import {
  completeSetup,
  createTestApp,
  failureCode,
  loginAsOwner,
  silentLogger,
  type TestApp
} from './helpers'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, raw: unknown) => Promise<unknown>) => {
      electron.handlers.set(channel, fn)
    }
  }
}))

const trustedEvent = { senderFrame: { url: 'app://tandoori-pos/index.html' } }

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value')
  return value
}

async function invoke<T = unknown>(channel: string, raw?: unknown) {
  const handler = electron.handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return (await handler(trustedEvent, raw)) as IpcResult<T>
}

const PASSWORD = 'Biryani-2026'

describe('table operations', () => {
  let app: TestApp
  let owner: AuthContext
  let t1: string
  let t2: string
  let t3: string
  let naan: string
  let dal: string

  const line = (menuItemId: string, quantity = 1): OrderLineInput => ({ menuItemId, quantity })
  const seat = (tableId: string, lines: OrderLineInput[], guestCount: number | null = 2) =>
    app.services.orders.create(
      owner,
      createOrderInputSchema.parse({ type: 'DINE_IN', tableId, guestCount, lines })
    )
  /** An order on the table with its items already in the kitchen. */
  const sent = (tableId: string, lines: OrderLineInput[], guestCount: number | null = 2) => {
    const order = seat(tableId, lines, guestCount)
    app.services.orders.sendAndGetKots(owner, order.id)
    return app.services.orders.get(order.id)
  }
  const shift = (orderId: string, toTableId: string) =>
    app.services.tableOps.shift(owner, shiftTableInputSchema.parse({ orderId, toTableId }))
  const merge = (sourceOrderId: string, targetOrderId: string) =>
    app.services.tableOps.merge(
      owner,
      mergeTablesInputSchema.parse({ sourceOrderId, targetOrderId })
    )
  const table = (id: string) => {
    const found = app.services.tables.list().find((entry) => entry.id === id)
    if (!found) throw new Error('missing table')
    return found
  }
  const ticketsOf = (orderId: string) =>
    app.handle.db.select().from(kots).where(eq(kots.orderId, orderId)).all()
  const operations = () =>
    app.handle.db
      .select()
      .from(tableOperations)
      .orderBy(sql`rowid`)
      .all()
  const actions = () =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(sql`rowid`)
      .all()
      .map((row) => row.action)
  const setKot = (kotId: string, status: 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED') =>
    app.services.kots.setStatus(owner, { id: kotId, status })

  beforeEach(async () => {
    electron.handlers.clear()
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
    const hall = app.services.areas.create(owner, createAreaInputSchema.parse({ name: 'Hall' }))
    const makeTable = (tableNumber: string) =>
      app.services.tables.create(
        owner,
        createTableInputSchema.parse({
          areaId: hall.id,
          tableNumber,
          capacity: 4,
          type: 'AC'
        })
      ).id
    t1 = makeTable('T1')
    t2 = makeTable('T2')
    t3 = makeTable('T3')
    const category = app.services.categories.create(
      owner,
      createCategoryInputSchema.parse({ name: 'Food' })
    ).id
    const item = (name: string, price: number) =>
      app.services.items.create(
        owner,
        createItemInputSchema.parse({ categoryId: category, name, price, foodType: 'VEG' })
      ).id
    naan = item('Butter Naan', 6000)
    dal = item('Dal Makhani', 24000)
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('shifting a table', () => {
    it('moves the order to a free table and frees the old one', () => {
      const order = sent(t1, [line(naan, 2)], 3)
      const opened = table(t1).openedAt

      const shifted = shift(order.id, t2)

      expect(shifted).toMatchObject({
        id: order.id,
        tableId: t2,
        tableNumber: 'T2',
        guestCount: 3,
        subtotal: 12000
      })
      expect(table(t1)).toMatchObject({
        status: 'AVAILABLE',
        openedAt: null,
        openedByName: null,
        guestCount: null
      })
      expect(table(t2)).toMatchObject({ status: 'OCCUPIED', guestCount: 3, openedAt: opened })
      expect(table(t2).openedByName).not.toBeNull()
      expect(actions()).toContain('order.table_shifted')
      expect(operations()).toMatchObject([
        { kind: 'SHIFT', orderId: order.id, fromTableId: t1, toTableId: t2, sourceOrderId: null }
      ])
    })

    it('makes the new table show what the kitchen is doing', () => {
      const order = sent(t1, [line(naan)])
      const [ticket] = ticketsOf(order.id)
      setKot(must(ticket).id, 'ACCEPTED')
      setKot(must(ticket).id, 'PREPARING')

      shift(order.id, t2)

      expect(table(t2).status).toBe('PREPARING')
      expect(table(t1).status).toBe('AVAILABLE')
    })

    it('keeps the kitchen tickets and the table on them in step', () => {
      const order = sent(t1, [line(dal)])
      shift(order.id, t2)
      const tickets = app.services.kots.forOrder(app.handle.db, order.id)
      expect(tickets).toHaveLength(1)
      expect(app.services.kots.get(must(tickets[0]).id)).toMatchObject({ tableNumber: 'T2' })
    })

    it('works for a draft that was never sent', () => {
      const order = seat(t1, [line(naan)])
      expect(shift(order.id, t3)).toMatchObject({ tableNumber: 'T3', status: 'DRAFT' })
      expect(table(t3).status).toBe('OCCUPIED')
    })

    it('works while the bill waits for payment', () => {
      const order = sent(t1, [line(naan)])
      app.services.orders.setStatus(
        owner,
        setOrderStatusInputSchema.parse({ id: order.id, status: 'SERVED' })
      )
      app.services.bills.generate(owner, generateBillInputSchema.parse({ orderId: order.id }))
      expect(shift(order.id, t2)).toMatchObject({ tableNumber: 'T2', status: 'BILL_REQUESTED' })
      expect(table(t2).status).toBe('BILL_REQUESTED')
    })

    it('lets the old table take a new party afterwards', () => {
      const order = sent(t1, [line(naan)])
      shift(order.id, t2)
      const next = seat(t1, [line(dal)])
      expect(next.tableNumber).toBe('T1')
    })

    it('refuses a table that is taken, blocked, or out of service', async () => {
      const order = sent(t1, [line(naan)])
      sent(t2, [line(dal)])
      expect(await failureCode(() => shift(order.id, t2))).toBe('CONFLICT')

      app.services.tables.block(owner, t3)
      expect(await failureCode(() => shift(order.id, t3))).toBe('CONFLICT')
      app.services.tables.unblock(owner, t3)
      app.services.tables.setActive(owner, { id: t3, isActive: false })
      expect(await failureCode(() => shift(order.id, t3))).toBe('CONFLICT')

      // Nothing moved.
      expect(app.services.orders.get(order.id).tableNumber).toBe('T1')
      expect(operations()).toHaveLength(0)
    })

    it('refuses the same table, a missing table, and an unknown order', async () => {
      const order = sent(t1, [line(naan)])
      expect(await failureCode(() => shift(order.id, t1))).toBe('CONFLICT')
      expect(await failureCode(() => shift(order.id, crypto.randomUUID()))).toBe('NOT_FOUND')
      expect(await failureCode(() => shift(crypto.randomUUID(), t2))).toBe('NOT_FOUND')
    })

    it('refuses an order that is not a running dine-in order', async () => {
      const takeaway = app.services.orders.create(
        owner,
        createOrderInputSchema.parse({ type: 'TAKEAWAY', lines: [line(naan)] })
      )
      expect(await failureCode(() => shift(takeaway.id, t2))).toBe('CONFLICT')

      const dropped = seat(t1, [line(naan)])
      app.services.orders.cancel(owner, { id: dropped.id, reason: null })
      expect(await failureCode(() => shift(dropped.id, t2))).toBe('CONFLICT')
    })
  })

  describe('merging tables', () => {
    it('moves items and tickets into the order that carries on', () => {
      const source = sent(t1, [line(naan, 2)], 2)
      const target = sent(t2, [line(dal)], 3)

      const merged = merge(source.id, target.id)

      expect(merged).toMatchObject({ id: target.id, guestCount: 5, subtotal: 36000 })
      expect(merged.lines.map((entry) => entry.name).sort()).toEqual(['Butter Naan', 'Dal Makhani'])
      expect(ticketsOf(source.id)).toHaveLength(0)
      expect(ticketsOf(target.id)).toHaveLength(2)

      const closed = app.services.orders.get(source.id)
      expect(closed.status).toBe('CANCELLED')
      expect(closed.lines).toHaveLength(0)
      expect(closed.subtotal).toBe(0)
      expect(table(t1)).toMatchObject({ status: 'AVAILABLE', guestCount: null, openedAt: null })
      expect(table(t2)).toMatchObject({ status: 'OCCUPIED', guestCount: 5 })

      expect(actions()).toContain('order.tables_merged')
      expect(operations()).toMatchObject([
        {
          kind: 'MERGE',
          orderId: target.id,
          sourceOrderId: source.id,
          fromTableId: t1,
          toTableId: t2,
          movedLines: 1,
          movedTickets: 1
        }
      ])
      const row = app.handle.db.select().from(orders).where(eq(orders.id, source.id)).get()
      expect(row?.cancelReason).toBe(`Merged into ${target.orderNumber}`)
    })

    it('puts the order that carries on back in the kitchen when the other was cooking', () => {
      const source = sent(t1, [line(naan)])
      const target = sent(t2, [line(dal)])
      const [ticket] = ticketsOf(source.id)
      setKot(must(ticket).id, 'ACCEPTED')
      setKot(must(ticket).id, 'PREPARING')
      expect(app.services.orders.get(target.id).status).toBe('CONFIRMED')

      expect(merge(source.id, target.id).status).toBe('PREPARING')
      expect(table(t2).status).toBe('PREPARING')
    })

    it('keeps items that were not sent yet, to be sent with the next round', () => {
      const source = seat(t1, [line(naan)])
      const target = sent(t2, [line(dal)])
      const merged = merge(source.id, target.id)
      expect(merged.lines.map((entry) => entry.status).sort()).toEqual(['NEW', 'SENT'])
      const result = app.services.orders.sendAndGetKots(owner, target.id)
      expect(result.kotIds).toHaveLength(1)
      expect(ticketsOf(target.id)).toHaveLength(2)
    })

    it('keeps cancelled items on the order they ended up on', () => {
      const source = sent(t1, [line(naan), line(dal)])
      const cancelled = must(source.lines.find((entry) => entry.name === 'Dal Makhani'))
      app.services.orders.cancelLine(owner, {
        orderId: source.id,
        lineId: cancelled.id,
        reason: 'Guest changed mind'
      })
      const target = sent(t2, [line(naan)])
      const merged = merge(source.id, target.id)
      expect(merged.lines).toHaveLength(3)
      expect(merged.lines.filter((entry) => entry.status === 'CANCELLED')).toHaveLength(1)
      expect(merged.subtotal).toBe(12000)
    })

    it('leaves the guest count empty when neither table had one, and caps it at 50', () => {
      const a = sent(t1, [line(naan)], null)
      const b = sent(t2, [line(naan)], null)
      expect(merge(a.id, b.id).guestCount).toBeNull()

      const c = sent(t1, [line(naan)], 40)
      const d = sent(t3, [line(naan)], 30)
      expect(merge(c.id, d.id).guestCount).toBe(50)
    })

    it('refuses to merge a table with itself or with a take-away order', async () => {
      const order = sent(t1, [line(naan)])
      expect(
        mergeTablesInputSchema.safeParse({ sourceOrderId: order.id, targetOrderId: order.id })
          .success
      ).toBe(false)
      const takeaway = app.services.orders.create(
        owner,
        createOrderInputSchema.parse({ type: 'TAKEAWAY', lines: [line(naan)] })
      )
      expect(await failureCode(() => merge(order.id, takeaway.id))).toBe('CONFLICT')
      expect(await failureCode(() => merge(takeaway.id, order.id))).toBe('CONFLICT')
    })

    it('refuses a table that has a bill', async () => {
      const billed = sent(t1, [line(naan)])
      app.services.orders.setStatus(
        owner,
        setOrderStatusInputSchema.parse({ id: billed.id, status: 'SERVED' })
      )
      app.services.bills.generate(owner, generateBillInputSchema.parse({ orderId: billed.id }))
      const other = sent(t2, [line(dal)])

      expect(await failureCode(() => merge(billed.id, other.id))).toBe('CONFLICT')
      expect(await failureCode(() => merge(other.id, billed.id))).toBe('CONFLICT')
      expect(operations()).toHaveLength(0)
      expect(app.services.orders.get(other.id).lines).toHaveLength(1)
    })

    it('refuses when the two tables together would hold too many items', async () => {
      const many = (count: number): OrderLineInput[] =>
        Array.from({ length: count }, () => line(naan))
      const a = seat(t1, many(60))
      const b = seat(t2, many(50))
      expect(await failureCode(() => merge(a.id, b.id))).toBe('CONFLICT')
      expect(app.services.orders.get(a.id).lines).toHaveLength(60)
      expect(table(t1).status).not.toBe('AVAILABLE')
    })

    it('can merge more than once into the same order', () => {
      const a = sent(t1, [line(naan)])
      const b = sent(t2, [line(dal)])
      const c = sent(t3, [line(naan)])
      merge(a.id, b.id)
      const final = merge(c.id, b.id)
      expect(final.lines).toHaveLength(3)
      expect(ticketsOf(b.id)).toHaveLength(3)
      expect(operations()).toHaveLength(2)
    })

    it('can be followed by a bill for the combined order', () => {
      const a = sent(t1, [line(naan, 2)])
      const b = sent(t2, [line(dal)])
      merge(a.id, b.id)
      app.services.orders.setStatus(
        owner,
        setOrderStatusInputSchema.parse({ id: b.id, status: 'SERVED' })
      )
      const bill = app.services.bills.generate(
        owner,
        generateBillInputSchema.parse({ orderId: b.id })
      )
      expect(bill.subtotal).toBe(36000)
    })
  })

  describe('what the database guards', () => {
    it('refuses to re-point a ticket without a recorded merge', () => {
      const a = sent(t1, [line(naan)])
      const b = sent(t2, [line(dal)])
      const [ticket] = ticketsOf(a.id)
      expect(() =>
        app.handle.db
          .update(kots)
          .set({ orderId: b.id })
          .where(eq(kots.id, must(ticket).id))
          .run()
      ).toThrow(/cannot be rewritten/)

      // A shift is not a merge: it does not authorise moving tickets either.
      shift(a.id, t3)
      expect(() =>
        app.handle.db
          .update(kots)
          .set({ orderId: b.id })
          .where(eq(kots.id, must(ticket).id))
          .run()
      ).toThrow(/cannot be rewritten/)
    })

    it('refuses to re-point a ticket to an order the merge did not name', () => {
      const a = sent(t1, [line(naan)])
      const b = sent(t2, [line(dal)])
      const c = sent(t3, [line(naan)])
      const [ticket] = ticketsOf(a.id)
      merge(a.id, b.id)
      // The ticket now sits on b; moving it to c was never recorded.
      expect(() =>
        app.handle.db
          .update(kots)
          .set({ orderId: c.id })
          .where(eq(kots.id, must(ticket).id))
          .run()
      ).toThrow(/cannot be rewritten/)
    })

    it('never changes or deletes the record of an operation', () => {
      const order = sent(t1, [line(naan)])
      shift(order.id, t2)
      expect(() => app.handle.db.update(tableOperations).set({ toTableId: t3 }).run()).toThrow(
        /cannot be changed/
      )
      expect(() => app.handle.db.delete(tableOperations).run()).toThrow(/cannot be deleted/)
    })

    it('rejects a merge record that does not name its folded order', () => {
      const order = sent(t1, [line(naan)])
      const row = app.handle.db.select().from(orders).where(eq(orders.id, order.id)).get()
      expect(() =>
        app.handle.db
          .insert(tableOperations)
          .values({
            restaurantId: must(row).restaurantId,
            kind: 'MERGE',
            orderId: order.id,
            fromTableId: t1,
            toTableId: t2,
            performedBy: owner.userId,
            performedAt: new Date()
          })
          .run()
      ).toThrow()
    })
  })

  describe('over IPC', () => {
    const signInWith = async (username: string, permissions: PermissionCode[]) => {
      const role = app.services.roles.create(
        owner,
        createRoleInputSchema.parse({ name: `Role ${username}`, permissions })
      )
      await app.services.users.create(
        owner,
        createStaffInputSchema.parse({
          username,
          password: PASSWORD,
          fullName: `Staff ${username}`,
          roleIds: [role.id]
        })
      )
      app.services.auth.logout()
      await invoke(IPC_CHANNELS.authLogin, { username, password: PASSWORD })
      await invoke(IPC_CHANNELS.authChangePassword, {
        currentPassword: PASSWORD,
        newPassword: 'Fresh-Password-9',
        confirmPassword: 'Fresh-Password-9'
      })
    }
    const code = (result: IpcResult<unknown>) => (result.ok ? null : result.error.code)

    beforeEach(() => {
      const registrar = createIpcRegistrar({
        logger: silentLogger,
        securityLogger: silentLogger,
        isTrustedSender: () => true,
        authorize: (required, options) => app.services.auth.authorize(required, options)
      })
      registerAuthHandlers(registrar, app.services)
      registerTableHandlers(registrar, app.services)
    })

    it('needs a session and valid input', async () => {
      app.services.auth.logout()
      for (const channel of [IPC_CHANNELS.tablesShift, IPC_CHANNELS.tablesMerge]) {
        expect(code(await invoke(channel, {}))).toBe('UNAUTHENTICATED')
      }
      await loginAsOwner(app)
      expect(code(await invoke(IPC_CHANNELS.tablesShift, { orderId: 'x', toTableId: 'y' }))).toBe(
        'VALIDATION_ERROR'
      )
      const id = crypto.randomUUID()
      expect(
        code(await invoke(IPC_CHANNELS.tablesMerge, { sourceOrderId: id, targetOrderId: id }))
      ).toBe('VALIDATION_ERROR')
    })

    it('needs the shift and merge permission, which waiters with only "take orders" lack', async () => {
      const order = sent(t1, [line(naan)])
      const other = sent(t2, [line(dal)])

      await signInWith('waiter', ['pos.access', 'orders.operate'])
      expect(
        code(await invoke(IPC_CHANNELS.tablesShift, { orderId: order.id, toTableId: t3 }))
      ).toBe('FORBIDDEN')
      expect(
        code(
          await invoke(IPC_CHANNELS.tablesMerge, {
            sourceOrderId: order.id,
            targetOrderId: other.id
          })
        )
      ).toBe('FORBIDDEN')
      expect(app.services.orders.get(order.id).tableNumber).toBe('T1')

      await signInWith('captain', ['pos.access', 'tables.transfer'])
      const shifted = await invoke<OrderDetail>(IPC_CHANNELS.tablesShift, {
        orderId: order.id,
        toTableId: t3
      })
      expect(shifted).toMatchObject({ ok: true, data: { tableNumber: 'T3' } })
      const merged = await invoke<OrderDetail>(IPC_CHANNELS.tablesMerge, {
        sourceOrderId: order.id,
        targetOrderId: other.id
      })
      expect(merged).toMatchObject({ ok: true, data: { id: other.id } })
    })
  })
})
