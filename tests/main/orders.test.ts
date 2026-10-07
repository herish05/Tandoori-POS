import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAddonInputSchema,
  createCategoryInputSchema,
  createItemInputSchema,
  createStationInputSchema,
  createTaxCategoryInputSchema,
  type CreateItemInput
} from '@shared/menu'
import {
  addItemsInputSchema,
  cancelLineInputSchema,
  cancelOrderInputSchema,
  createOrderInputSchema,
  orderFilterSchema,
  setOrderStatusInputSchema,
  updateLineInputSchema,
  updateOrderInputSchema,
  type CreateOrderInput,
  type OrderLineInput
} from '@shared/orders'
import { setKotStatusInputSchema } from '@shared/kitchen'
import { withImpliedPermissions } from '@shared/permissions'
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, diningTables, documentSequences, orders, restaurants } from '@main/db/schema'
import { derivePrefix, formatDocumentNumber } from '@main/orders/numbering'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

describe('order management', () => {
  let app: TestApp
  let owner: AuthContext

  const area = () => app.services.areas.create(owner, createAreaInputSchema.parse({ name: 'Hall' }))
  const makeTable = (areaId: string, tableNumber: string) =>
    app.services.tables.create(
      owner,
      createTableInputSchema.parse({ areaId, tableNumber, capacity: 4, type: 'AC' })
    )
  const makeCategory = (name: string, extra: Record<string, unknown> = {}) =>
    app.services.categories.create(owner, createCategoryInputSchema.parse({ name, ...extra }))
  const makeItem = (categoryId: string, name: string, extra: Partial<CreateItemInput> = {}) =>
    app.services.items.create(
      owner,
      createItemInputSchema.parse({ categoryId, name, price: 25000, foodType: 'VEG', ...extra })
    )
  const makeAddon = (name: string, kind: 'ADDON' | 'MODIFIER', price: number) =>
    app.services.addons.create(owner, createAddonInputSchema.parse({ name, kind, price }))

  const line = (menuItemId: string, extra: Partial<OrderLineInput> = {}): OrderLineInput => ({
    menuItemId,
    quantity: 1,
    ...extra
  })
  const newOrder = (input: CreateOrderInput, ctx: AuthContext = owner) =>
    app.services.orders.create(ctx, createOrderInputSchema.parse(input))
  const dineIn = (
    tableId: string,
    lines: OrderLineInput[],
    extra: Partial<CreateOrderInput> = {}
  ) => newOrder({ type: 'DINE_IN', tableId, lines, ...extra })
  const tableStatus = (id: string) =>
    app.handle.db.select().from(diningTables).where(eq(diningTables.id, id)).get()
  const status = (orderId: string, next: string, ctx: AuthContext = owner) =>
    app.services.orders.setStatus(
      ctx,
      setOrderStatusInputSchema.parse({ id: orderId, status: next })
    )
  /** Moves every open ticket of the order through the kitchen up to the given step. */
  const kitchen = (orderId: string, target: 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED') => {
    const steps: readonly string[] = ['ACCEPTED', 'PREPARING', 'READY', 'SERVED']
    for (const kot of app.services.kots.list({ orderId, openOnly: true })) {
      for (const step of steps.slice(0, steps.indexOf(target) + 1)) {
        if (steps.indexOf(step) > steps.indexOf(kot.status)) {
          app.services.kots.setStatus(
            owner,
            setKotStatusInputSchema.parse({ id: kot.id, status: step })
          )
        }
      }
    }
    return app.services.orders.get(orderId)
  }
  const auditActions = (): string[] =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .all()
      .map((row) => row.action)
      .filter((action) => action.startsWith('order.'))
  const withPermissions = (
    ...codes: Parameters<typeof withImpliedPermissions>[0]
  ): AuthContext => ({
    ...owner,
    permissions: new Set(withImpliedPermissions(codes))
  })

  let tableId: string
  let dal: string
  let naan: string

  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
    const hall = area()
    tableId = makeTable(hall.id, 'T1').id
    const mains = makeCategory('Mains')
    dal = makeItem(mains.id, 'Dal Makhani').id
    naan = makeItem(mains.id, 'Butter Naan', { price: 6000 }).id
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('order numbers', () => {
    it('derives a prefix from the restaurant name', () => {
      expect(derivePrefix('Test Kitchen')).toBe('TK')
      expect(derivePrefix('TANDOORI BITES')).toBe('TB')
      expect(derivePrefix('Tandoori')).toBe('TA')
      expect(derivePrefix('Shree Ganesh Bhojanalaya Rampura')).toBe('SGBR')
      expect(derivePrefix('  ')).toBe('POS')
      expect(derivePrefix('!!!')).toBe('POS')
      expect(formatDocumentNumber('TB', 'ORD', 1)).toBe('TB-ORD-000001')
      expect(formatDocumentNumber('TB', 'ORD', 1234567)).toBe('TB-ORD-1234567')
    })

    it('numbers orders in sequence without gaps or duplicates', () => {
      const numbers = Array.from(
        { length: 5 },
        () => newOrder({ type: 'TAKEAWAY', lines: [line(dal)] }).orderNumber
      )
      expect(numbers).toEqual([
        'TK-ORD-000001',
        'TK-ORD-000002',
        'TK-ORD-000003',
        'TK-ORD-000004',
        'TK-ORD-000005'
      ])
      expect(new Set(numbers).size).toBe(5)
    })

    it('does not use up a number when the order fails', async () => {
      const failed = await failureCode(() => dineIn(crypto.randomUUID(), [line(dal)]))
      expect(failed).toBe('NOT_FOUND')
      const bad = await failureCode(() =>
        newOrder({ type: 'TAKEAWAY', lines: [line(crypto.randomUUID())] })
      )
      expect(bad).toBe('CONFLICT')
      expect(newOrder({ type: 'TAKEAWAY', lines: [line(dal)] }).orderNumber).toBe('TK-ORD-000001')
    })

    it('keeps one counter per restaurant and survives a new prefix', () => {
      newOrder({ type: 'TAKEAWAY', lines: [line(dal)] })
      app.handle.db.update(restaurants).set({ name: 'Another Name' }).run()
      expect(newOrder({ type: 'TAKEAWAY', lines: [line(dal)] }).orderNumber).toBe('TK-ORD-000002')
      expect(app.handle.db.select().from(documentSequences).all()).toHaveLength(1)
    })
  })

  describe('validation', () => {
    it('requires a table for dine-in and forbids one otherwise', () => {
      const base = { lines: [line(dal)] }
      expect(createOrderInputSchema.safeParse({ ...base, type: 'DINE_IN' }).success).toBe(false)
      expect(
        createOrderInputSchema.safeParse({ ...base, type: 'DINE_IN', tableId: crypto.randomUUID() })
          .success
      ).toBe(true)
      expect(
        createOrderInputSchema.safeParse({
          ...base,
          type: 'TAKEAWAY',
          tableId: crypto.randomUUID()
        }).success
      ).toBe(false)
    })

    it('requires name, phone and address for delivery', () => {
      const base = { type: 'DELIVERY', lines: [line(dal)] }
      expect(createOrderInputSchema.safeParse(base).success).toBe(false)
      expect(
        createOrderInputSchema.safeParse({
          ...base,
          customerName: 'Asha',
          customerPhone: '98765 43210',
          deliveryAddress: 'Street 4, Rampura Phul'
        }).success
      ).toBe(true)
      expect(createOrderInputSchema.safeParse({ ...base, customerName: 'Asha' }).success).toBe(
        false
      )
    })

    it('rejects bad quantities, repeated add-ons, empty orders and unknown statuses', () => {
      for (const quantity of [0, -1, 1.5, 100]) {
        expect(
          createOrderInputSchema.safeParse({ type: 'TAKEAWAY', lines: [line(dal, { quantity })] })
            .success
        ).toBe(false)
      }
      const addonId = crypto.randomUUID()
      expect(
        createOrderInputSchema.safeParse({
          type: 'TAKEAWAY',
          lines: [line(dal, { addonIds: [addonId, addonId] })]
        }).success
      ).toBe(false)
      expect(createOrderInputSchema.safeParse({ type: 'TAKEAWAY', lines: [] }).success).toBe(false)
      expect(createOrderInputSchema.safeParse({ type: 'EAT_IN', lines: [line(dal)] }).success).toBe(
        false
      )
      for (const next of ['DRAFT', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NOPE']) {
        expect(
          setOrderStatusInputSchema.safeParse({ id: crypto.randomUUID(), status: next }).success
        ).toBe(false)
      }
      expect(orderFilterSchema.safeParse({ activeOnly: true, search: 'TK' }).success).toBe(true)
      expect(
        cancelLineInputSchema.safeParse({
          orderId: crypto.randomUUID(),
          lineId: crypto.randomUUID(),
          reason: 'x'
        }).success
      ).toBe(false)
    })

    it('trims instructions and turns blanks into null', () => {
      const parsed = createOrderInputSchema.parse({
        type: 'TAKEAWAY',
        lines: [line(dal, { notes: '  less spicy  ' }), line(naan, { notes: '   ' })]
      })
      expect(parsed.lines.map((l) => l.notes)).toEqual(['less spicy', null])
    })
  })

  describe('creating orders', () => {
    it('creates a draft dine-in order and takes the table', () => {
      const order = dineIn(tableId, [line(dal, { quantity: 2 })], { guestCount: 3 })
      expect(order).toMatchObject({
        orderNumber: 'TK-ORD-000001',
        type: 'DINE_IN',
        status: 'DRAFT',
        tableId,
        guestCount: 3,
        itemCount: 2,
        subtotal: 50000,
        hasUnsentLines: true
      })
      expect(order.lines).toHaveLength(1)
      expect(order.lines[0]).toMatchObject({
        name: 'Dal Makhani',
        quantity: 2,
        unitPrice: 25000,
        lineTotal: 50000,
        status: 'NEW'
      })
      expect(tableStatus(tableId)).toMatchObject({ status: 'OCCUPIED', guestCount: 3 })
      expect(tableStatus(tableId)?.openedAt).toBeTruthy()
      expect(tableStatus(tableId)?.openedBy).toBe(owner.userId)
    })

    it('reuses a table staff opened by hand and keeps its guests', () => {
      app.services.tables.open(owner, { id: tableId, guestCount: 4 })
      const order = dineIn(tableId, [line(dal)])
      expect(order.status).toBe('DRAFT')
      expect(tableStatus(tableId)).toMatchObject({ status: 'OCCUPIED', guestCount: 4 })
    })

    it('takes a reserved table', () => {
      app.handle.db
        .update(diningTables)
        .set({ status: 'RESERVED' })
        .where(eq(diningTables.id, tableId))
        .run()
      dineIn(tableId, [line(dal)])
      expect(tableStatus(tableId)?.status).toBe('OCCUPIED')
    })

    it('refuses a second open order on the same table', async () => {
      const first = dineIn(tableId, [line(dal)])
      expect(await failureCode(() => dineIn(tableId, [line(naan)]))).toBe('CONFLICT')
      expect(app.services.orders.list({ tableId })).toHaveLength(1)
      app.services.orders.cancel(owner, cancelOrderInputSchema.parse({ id: first.id }))
      expect(dineIn(tableId, [line(naan)]).orderNumber).toBe('TK-ORD-000002')
    })

    it('refuses blocked and inactive tables', async () => {
      app.services.tables.block(owner, tableId)
      expect(await failureCode(() => dineIn(tableId, [line(dal)]))).toBe('CONFLICT')
      app.services.tables.unblock(owner, tableId)
      app.services.tables.setActive(owner, { id: tableId, isActive: false })
      expect(await failureCode(() => dineIn(tableId, [line(dal)]))).toBe('CONFLICT')
      expect(app.handle.db.select().from(orders).all()).toHaveLength(0)
    })

    it('creates takeaway, pickup and delivery orders without a table', () => {
      const takeaway = newOrder({ type: 'TAKEAWAY', lines: [line(dal)], customerName: 'Raj' })
      const pickup = newOrder({ type: 'PICKUP', lines: [line(dal)], customerPhone: '9876543210' })
      const delivery = newOrder({
        type: 'DELIVERY',
        lines: [line(dal)],
        customerName: 'Asha',
        customerPhone: '9876543210',
        deliveryAddress: 'Street 4'
      })
      expect([takeaway, pickup, delivery].map((o) => o.tableId)).toEqual([null, null, null])
      expect(delivery.deliveryAddress).toBe('Street 4')
      expect(takeaway.customerName).toBe('Raj')
      expect(app.services.orders.list({ type: 'DELIVERY' }).map((o) => o.id)).toEqual([delivery.id])
    })
  })

  describe('pricing from the menu', () => {
    it('prices variants, add-ons and free modifiers on the server', () => {
      const mains = makeCategory('Biryani')
      const extraRaita = makeAddon('Extra raita', 'ADDON', 3000)
      const noOnion = makeAddon('No onion', 'MODIFIER', 0)
      const station = app.services.stations.create(
        owner,
        createStationInputSchema.parse({ name: 'Tandoor' })
      )
      const tax = app.services.taxCategories.create(
        owner,
        createTaxCategoryInputSchema.parse({ name: 'GST 5%', rateBps: 500 })
      )
      const item = makeItem(mains.id, 'Chicken Biryani', {
        price: 20000,
        stationId: station.id,
        taxCategoryId: tax.id,
        addonIds: [extraRaita.id, noOnion.id],
        variants: [
          { name: 'Half', price: 18000, isDefault: true },
          { name: 'Full', price: 32000 }
        ]
      })
      const variants = app.services.items.list().find((i) => i.id === item.id)?.variants ?? []
      const full = variants.find((v) => v.name === 'Full')
      const order = newOrder({
        type: 'TAKEAWAY',
        lines: [
          line(item.id, {
            variantId: full?.id,
            quantity: 2,
            addonIds: [extraRaita.id, noOnion.id],
            notes: 'Medium spicy'
          }),
          line(item.id)
        ]
      })
      const [first, second] = order.lines
      expect(first).toMatchObject({
        variantName: 'Full',
        unitPrice: 32000,
        addonTotal: 3000,
        lineTotal: 70000,
        notes: 'Medium spicy',
        stationName: 'Tandoor',
        taxName: 'GST 5%',
        taxRateBps: 500
      })
      expect(first?.addons.map((a) => [a.name, a.price])).toEqual([
        ['Extra raita', 3000],
        ['No onion', 0]
      ])
      expect(second).toMatchObject({ variantName: 'Half', unitPrice: 18000, lineTotal: 18000 })
      expect(order.subtotal).toBe(88000)
    })

    it('keeps the old price on a line when the menu changes later', () => {
      const order = newOrder({ type: 'TAKEAWAY', lines: [line(dal)] })
      app.services.items.update(owner, {
        ...createItemInputSchema.parse({
          categoryId: app.services.categories.list()[0]?.id ?? '',
          name: 'Dal Makhani',
          price: 99900,
          foodType: 'VEG'
        }),
        id: dal
      })
      expect(app.services.orders.get(order.id).lines[0]?.unitPrice).toBe(25000)
      const added = app.services.orders.addItems(
        owner,
        addItemsInputSchema.parse({ orderId: order.id, lines: [line(dal)] })
      )
      expect(added.lines.map((l) => l.unitPrice)).toEqual([25000, 99900])
    })

    it('refuses sold-out, inactive and unknown items, sizes and extras', async () => {
      const mains = makeCategory('Specials')
      const soldOut = makeItem(mains.id, 'Kheer', { isAvailable: false })
      const hidden = makeItem(mains.id, 'Old Dish')
      app.services.items.setActive(owner, { id: hidden.id, isActive: false })
      const sized = makeItem(mains.id, 'Lassi', {
        variants: [{ name: 'Glass', price: 8000, isDefault: true }]
      })
      const extra = makeAddon('Ice', 'ADDON', 0)

      expect(
        await failureCode(() => newOrder({ type: 'TAKEAWAY', lines: [line(soldOut.id)] }))
      ).toBe('CONFLICT')
      expect(
        await failureCode(() => newOrder({ type: 'TAKEAWAY', lines: [line(hidden.id)] }))
      ).toBe('CONFLICT')
      expect(
        await failureCode(() =>
          newOrder({
            type: 'TAKEAWAY',
            lines: [line(sized.id, { variantId: crypto.randomUUID() })]
          })
        )
      ).toBe('VALIDATION_ERROR')
      expect(
        await failureCode(() =>
          newOrder({ type: 'TAKEAWAY', lines: [line(dal, { variantId: crypto.randomUUID() })] })
        )
      ).toBe('VALIDATION_ERROR')
      expect(
        await failureCode(() =>
          newOrder({ type: 'TAKEAWAY', lines: [line(dal, { addonIds: [extra.id] })] })
        )
      ).toBe('VALIDATION_ERROR')
      app.services.categories.setActive(owner, { id: mains.id, isActive: false })
      expect(await failureCode(() => newOrder({ type: 'TAKEAWAY', lines: [line(sized.id)] }))).toBe(
        'CONFLICT'
      )
    })

    it('rolls back everything when one line is bad', async () => {
      const mains = makeCategory('Sweets')
      const soldOut = makeItem(mains.id, 'Jalebi', { isAvailable: false })
      const code = await failureCode(() => dineIn(tableId, [line(dal), line(soldOut.id)]))
      expect(code).toBe('CONFLICT')
      expect(app.handle.db.select().from(orders).all()).toHaveLength(0)
      expect(tableStatus(tableId)?.status).toBe('AVAILABLE')
      expect(app.handle.db.select().from(documentSequences).all()).toHaveLength(0)
    })

    it('shows the ordering menu without costs and marks sold-out items', () => {
      const mains = makeCategory('Drinks')
      makeItem(mains.id, 'Lassi', { costPrice: 1200 })
      const soldOut = makeItem(mains.id, 'Chaas')
      app.services.items.setAvailability(owner, { id: soldOut.id, isAvailable: false })
      const catalog = app.services.orderCatalog.get()
      const drinks = catalog.categories.find((c) => c.name === 'Drinks')
      expect(
        catalog.items
          .filter((i) => i.categoryId === drinks?.id)
          .map((i) => [i.name, i.isAvailable])
          .sort()
      ).toEqual([
        ['Chaas', false],
        ['Lassi', true]
      ])
      expect(JSON.stringify(catalog)).not.toContain('costPrice')
      expect(JSON.stringify(catalog)).not.toContain('"image"')
    })
  })

  describe('editing', () => {
    it('adds items to an order and keeps the subtotal right', () => {
      const order = dineIn(tableId, [line(dal)])
      const next = app.services.orders.addItems(
        owner,
        addItemsInputSchema.parse({ orderId: order.id, lines: [line(naan, { quantity: 4 })] })
      )
      expect(next.lines).toHaveLength(2)
      expect(next.subtotal).toBe(25000 + 24000)
      expect(next.itemCount).toBe(5)
    })

    it('changes quantity and notes of an unsent line only', async () => {
      const order = dineIn(tableId, [line(dal)])
      const lineId = order.lines[0]?.id ?? ''
      const edited = app.services.orders.updateLine(
        owner,
        updateLineInputSchema.parse({
          orderId: order.id,
          lineId,
          quantity: 3,
          notes: 'Extra butter'
        })
      )
      expect(edited.lines[0]).toMatchObject({
        quantity: 3,
        lineTotal: 75000,
        notes: 'Extra butter'
      })
      expect(edited.subtotal).toBe(75000)

      app.services.orders.send(owner, order.id)
      expect(
        await failureCode(() =>
          app.services.orders.updateLine(
            owner,
            updateLineInputSchema.parse({ orderId: order.id, lineId, quantity: 1 })
          )
        )
      ).toBe('CONFLICT')
    })

    it('removes an unsent line and refuses to remove a sent one', async () => {
      const order = dineIn(tableId, [line(dal), line(naan)])
      const [first, second] = order.lines
      const after = app.services.orders.removeLine(owner, {
        orderId: order.id,
        lineId: first?.id ?? ''
      })
      expect(after.lines.map((l) => l.name)).toEqual(['Butter Naan'])
      expect(after.subtotal).toBe(6000)
      app.services.orders.send(owner, order.id)
      expect(
        await failureCode(() =>
          app.services.orders.removeLine(owner, { orderId: order.id, lineId: second?.id ?? '' })
        )
      ).toBe('CONFLICT')
    })

    it('cancels a sent line with a reason, keeps it on the order and drops it from the total', async () => {
      const order = dineIn(tableId, [line(dal), line(naan)])
      const sent = app.services.orders.send(owner, order.id)
      const target = sent.lines[0]?.id ?? ''
      const cancelled = app.services.orders.cancelLine(
        owner,
        cancelLineInputSchema.parse({
          orderId: order.id,
          lineId: target,
          reason: 'Guest changed mind'
        })
      )
      expect(cancelled.lines[0]).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Guest changed mind'
      })
      expect(cancelled.subtotal).toBe(6000)
      expect(cancelled.itemCount).toBe(1)
      expect(
        await failureCode(() =>
          app.services.orders.cancelLine(
            owner,
            cancelLineInputSchema.parse({ orderId: order.id, lineId: target, reason: 'Again' })
          )
        )
      ).toBe('CONFLICT')
    })

    it('does not cancel an unsent line (it is removed instead)', async () => {
      const order = dineIn(tableId, [line(dal)])
      expect(
        await failureCode(() =>
          app.services.orders.cancelLine(
            owner,
            cancelLineInputSchema.parse({
              orderId: order.id,
              lineId: order.lines[0]?.id,
              reason: 'Nope'
            })
          )
        )
      ).toBe('CONFLICT')
    })

    it('does not edit a line from another order', async () => {
      const a = newOrder({ type: 'TAKEAWAY', lines: [line(dal)] })
      const b = newOrder({ type: 'TAKEAWAY', lines: [line(naan)] })
      expect(
        await failureCode(() =>
          app.services.orders.removeLine(owner, { orderId: a.id, lineId: b.lines[0]?.id ?? '' })
        )
      ).toBe('NOT_FOUND')
    })

    it('updates guests, customer and notes, and the table follows the guests', () => {
      const order = dineIn(tableId, [line(dal)], { guestCount: 2 })
      const next = app.services.orders.update(
        owner,
        updateOrderInputSchema.parse({
          id: order.id,
          guestCount: 5,
          customerName: 'Mr Singh',
          notes: 'Birthday'
        })
      )
      expect(next).toMatchObject({ guestCount: 5, customerName: 'Mr Singh', notes: 'Birthday' })
      expect(tableStatus(tableId)?.guestCount).toBe(5)
    })

    it('keeps a delivery order complete when editing it', async () => {
      const order = newOrder({
        type: 'DELIVERY',
        lines: [line(dal)],
        customerName: 'Asha',
        customerPhone: '9876543210',
        deliveryAddress: 'Street 4'
      })
      expect(
        await failureCode(() =>
          app.services.orders.update(
            owner,
            updateOrderInputSchema.parse({
              id: order.id,
              customerName: 'Asha',
              customerPhone: '9876543210'
            })
          )
        )
      ).toBe('VALIDATION_ERROR')
    })

    it('limits the number of lines on an order', async () => {
      const order = newOrder({ type: 'TAKEAWAY', lines: [line(dal)] })
      const many = Array.from({ length: 99 }, () => line(naan))
      app.services.orders.addItems(
        owner,
        addItemsInputSchema.parse({ orderId: order.id, lines: many })
      )
      expect(
        await failureCode(() =>
          app.services.orders.addItems(
            owner,
            addItemsInputSchema.parse({ orderId: order.id, lines: [line(naan)] })
          )
        )
      ).toBe('CONFLICT')
    })
  })

  describe('sending and the order status', () => {
    it('confirms a draft when it is sent and marks the lines as sent', () => {
      const order = dineIn(tableId, [line(dal)])
      const sent = app.services.orders.send(owner, order.id)
      expect(sent.status).toBe('CONFIRMED')
      expect(sent.confirmedAt).toBeTruthy()
      expect(sent.hasUnsentLines).toBe(false)
      expect(sent.lines[0]?.status).toBe('SENT')
      expect(tableStatus(tableId)?.status).toBe('OCCUPIED')
    })

    it('refuses to send when there is nothing new', async () => {
      const order = dineIn(tableId, [line(dal)])
      app.services.orders.send(owner, order.id)
      expect(await failureCode(() => app.services.orders.send(owner, order.id))).toBe('CONFLICT')
    })

    it('sends only the new lines of an order that is being prepared and keeps its status', () => {
      const order = dineIn(tableId, [line(dal)])
      app.services.orders.send(owner, order.id)
      kitchen(order.id, 'PREPARING')
      app.services.orders.addItems(
        owner,
        addItemsInputSchema.parse({ orderId: order.id, lines: [line(naan)] })
      )
      const sent = app.services.orders.send(owner, order.id)
      expect(sent.status).toBe('PREPARING')
      expect(sent.lines.map((l) => l.status)).toEqual(['SENT', 'SENT'])
    })

    it('goes back to confirmed when more is ordered after ready or served', () => {
      const order = dineIn(tableId, [line(dal)])
      app.services.orders.send(owner, order.id)
      expect(kitchen(order.id, 'READY').status).toBe('READY')
      app.services.orders.addItems(
        owner,
        addItemsInputSchema.parse({ orderId: order.id, lines: [line(naan)] })
      )
      expect(app.services.orders.send(owner, order.id).status).toBe('CONFIRMED')
      expect(kitchen(order.id, 'SERVED').status).toBe('SERVED')
      app.services.orders.addItems(
        owner,
        addItemsInputSchema.parse({ orderId: order.id, lines: [line(naan)] })
      )
      expect(app.services.orders.send(owner, order.id).status).toBe('CONFIRMED')
    })

    it('follows the status machine and keeps the table in step', async () => {
      const order = dineIn(tableId, [line(dal)])
      expect(await failureCode(() => status(order.id, 'SERVED'))).toBe('CONFLICT')
      app.services.orders.send(owner, order.id)
      // The kitchen statuses follow the tickets; they cannot be set by hand.
      for (const manual of ['KOT_PENDING', 'PREPARING', 'READY']) {
        expect(setOrderStatusInputSchema.safeParse({ id: order.id, status: manual }).success).toBe(
          false
        )
        expect(
          await failureCode(() =>
            app.services.orders.setStatus(owner, { id: order.id, status: manual } as never)
          )
        ).toBe('CONFLICT')
      }
      expect(kitchen(order.id, 'ACCEPTED').status).toBe('KOT_PENDING')
      expect(tableStatus(tableId)?.status).toBe('KOT_PENDING')
      kitchen(order.id, 'PREPARING')
      expect(app.services.orders.get(order.id).status).toBe('PREPARING')
      expect(kitchen(order.id, 'READY').status).toBe('READY')
      expect(await failureCode(() => status(order.id, 'BILL_REQUESTED'))).toBe('CONFLICT')
      expect(status(order.id, 'SERVED').status).toBe('SERVED')
      expect(status(order.id, 'BILL_REQUESTED').status).toBe('BILL_REQUESTED')
      expect(tableStatus(tableId)?.status).toBe('BILL_REQUESTED')
      expect(status(order.id, 'SERVED').status).toBe('SERVED')
      expect(tableStatus(tableId)?.status).toBe('OCCUPIED')
    })

    it('needs sent lines before served or billing, and a live line to bill', async () => {
      const order = dineIn(tableId, [line(dal)])
      app.services.orders.send(owner, order.id)
      app.services.orders.addItems(
        owner,
        addItemsInputSchema.parse({ orderId: order.id, lines: [line(naan)] })
      )
      expect(await failureCode(() => status(order.id, 'SERVED'))).toBe('CONFLICT')
      const sent = app.services.orders.send(owner, order.id)
      status(order.id, 'SERVED')
      for (const l of sent.lines) {
        app.services.orders.cancelLine(
          owner,
          cancelLineInputSchema.parse({
            orderId: order.id,
            lineId: l.id,
            reason: 'Kitchen ran out'
          })
        )
      }
      expect(await failureCode(() => status(order.id, 'BILL_REQUESTED'))).toBe('CONFLICT')
    })

    it('does not allow item changes once the bill is requested', async () => {
      const order = dineIn(tableId, [line(dal)])
      app.services.orders.send(owner, order.id)
      status(order.id, 'SERVED')
      status(order.id, 'BILL_REQUESTED')
      expect(
        await failureCode(() =>
          app.services.orders.addItems(
            owner,
            addItemsInputSchema.parse({ orderId: order.id, lines: [line(naan)] })
          )
        )
      ).toBe('CONFLICT')
      status(order.id, 'SERVED')
      expect(
        app.services.orders.addItems(
          owner,
          addItemsInputSchema.parse({ orderId: order.id, lines: [line(naan)] })
        ).lines
      ).toHaveLength(2)
    })
  })

  describe('cancelling an order', () => {
    it('drops a draft without a reason and frees the table', () => {
      const order = dineIn(tableId, [line(dal)], { guestCount: 2 })
      const cancelled = app.services.orders.cancel(
        owner,
        cancelOrderInputSchema.parse({ id: order.id })
      )
      expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: null })
      expect(cancelled.cancelledAt).toBeTruthy()
      expect(tableStatus(tableId)).toMatchObject({
        status: 'AVAILABLE',
        guestCount: null,
        openedAt: null,
        openedBy: null
      })
    })

    it('needs a reason and the cancel permission once the order was sent', async () => {
      const order = dineIn(tableId, [line(dal)])
      app.services.orders.send(owner, order.id)
      expect(
        await failureCode(() =>
          app.services.orders.cancel(owner, cancelOrderInputSchema.parse({ id: order.id }))
        )
      ).toBe('VALIDATION_ERROR')
      expect(
        await failureCode(() =>
          app.services.orders.cancel(
            owner,
            cancelOrderInputSchema.parse({ id: order.id, reason: 'ab' })
          )
        )
      ).toBe('VALIDATION_ERROR')
      const waiter = withPermissions('orders.operate')
      expect(
        await failureCode(() =>
          app.services.orders.cancel(
            waiter,
            cancelOrderInputSchema.parse({ id: order.id, reason: 'Guests left' })
          )
        )
      ).toBe('FORBIDDEN')
      const cancelled = app.services.orders.cancel(
        owner,
        cancelOrderInputSchema.parse({ id: order.id, reason: 'Guests left' })
      )
      expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Guests left' })
      expect(tableStatus(tableId)?.status).toBe('AVAILABLE')
    })

    it('lets a cashier with operate drop a draft', () => {
      const waiter = withPermissions('orders.operate')
      const order = newOrder({ type: 'TAKEAWAY', lines: [line(dal)] }, waiter)
      expect(
        app.services.orders.cancel(waiter, cancelOrderInputSchema.parse({ id: order.id })).status
      ).toBe('CANCELLED')
    })

    it('cannot cancel what is served, finished or already cancelled, and cannot be edited afterwards', async () => {
      const order = dineIn(tableId, [line(dal)])
      app.services.orders.send(owner, order.id)
      status(order.id, 'SERVED')
      expect(
        await failureCode(() =>
          app.services.orders.cancel(
            owner,
            cancelOrderInputSchema.parse({ id: order.id, reason: 'Too late' })
          )
        )
      ).toBe('CONFLICT')

      const other = newOrder({ type: 'TAKEAWAY', lines: [line(dal)] })
      app.services.orders.cancel(owner, cancelOrderInputSchema.parse({ id: other.id }))
      expect(
        await failureCode(() =>
          app.services.orders.cancel(owner, cancelOrderInputSchema.parse({ id: other.id }))
        )
      ).toBe('CONFLICT')
      expect(
        await failureCode(() =>
          app.services.orders.addItems(
            owner,
            addItemsInputSchema.parse({ orderId: other.id, lines: [line(naan)] })
          )
        )
      ).toBe('CONFLICT')
      expect(await failureCode(() => app.services.orders.send(owner, other.id))).toBe('CONFLICT')
      expect(await failureCode(() => status(other.id, 'SERVED'))).toBe('CONFLICT')
    })
  })

  describe('tables', () => {
    it('does not let a table with an open order be closed by hand', async () => {
      const order = dineIn(tableId, [line(dal)])
      expect(await failureCode(() => app.services.tables.close(owner, tableId))).toBe('CONFLICT')
      app.services.orders.cancel(owner, cancelOrderInputSchema.parse({ id: order.id }))
      expect(tableStatus(tableId)?.status).toBe('AVAILABLE')
    })

    it('can still close a table that was opened by hand and has no order', () => {
      app.services.tables.open(owner, { id: tableId, guestCount: 2 })
      expect(app.services.tables.close(owner, tableId).status).toBe('AVAILABLE')
    })
  })

  describe('listing', () => {
    it('filters by activity, status, type, table and search, newest first', () => {
      const a = dineIn(tableId, [line(dal)])
      const b = newOrder({
        type: 'TAKEAWAY',
        lines: [line(naan)],
        customerName: 'Raj Kumar',
        customerPhone: '9876500000'
      })
      const c = newOrder({ type: 'PICKUP', lines: [line(naan)] })
      app.services.orders.cancel(owner, cancelOrderInputSchema.parse({ id: c.id }))
      app.services.orders.send(owner, b.id)

      const ids = (filter: Parameters<typeof orderFilterSchema.parse>[0]) =>
        app.services.orders
          .list(orderFilterSchema.parse(filter))
          .map((o) => o.orderNumber)
          .sort()
      expect(ids({})).toHaveLength(3)
      expect(ids({ activeOnly: true })).toEqual([a.orderNumber, b.orderNumber].sort())
      expect(ids({ statuses: ['CONFIRMED'] })).toEqual([b.orderNumber])
      expect(ids({ type: 'PICKUP' })).toEqual([c.orderNumber])
      expect(ids({ tableId })).toEqual([a.orderNumber])
      expect(ids({ search: 'raj' })).toEqual([b.orderNumber])
      expect(ids({ search: '98765' })).toEqual([b.orderNumber])
      expect(ids({ search: 'ORD-000001' })).toEqual([a.orderNumber])
      expect(ids({ search: '%' })).toEqual([])
      expect(app.services.orders.list({ limit: 2 })).toHaveLength(2)
      const summary = app.services.orders.list({ tableId })[0]
      expect(summary).toMatchObject({
        tableNumber: 'T1',
        areaName: 'Hall',
        itemCount: 1,
        subtotal: 25000
      })
    })

    it('reports a missing order', async () => {
      expect(await failureCode(() => app.services.orders.get(crypto.randomUUID()))).toBe(
        'NOT_FOUND'
      )
    })
  })

  describe('audit and permissions', () => {
    it('records each change in the audit log', () => {
      const order = dineIn(tableId, [line(dal)])
      const added = app.services.orders.addItems(
        owner,
        addItemsInputSchema.parse({ orderId: order.id, lines: [line(naan)] })
      )
      app.services.orders.updateLine(
        owner,
        updateLineInputSchema.parse({ orderId: order.id, lineId: order.lines[0]?.id, quantity: 2 })
      )
      app.services.orders.removeLine(owner, { orderId: order.id, lineId: order.lines[0]?.id ?? '' })
      app.services.orders.send(owner, order.id)
      status(order.id, 'SERVED')
      app.services.orders.cancelLine(
        owner,
        cancelLineInputSchema.parse({
          orderId: order.id,
          lineId: added.lines[1]?.id,
          reason: 'Wrong item'
        })
      )
      expect(auditActions()).toEqual(
        expect.arrayContaining([
          'order.created',
          'order.items_added',
          'order.item_updated',
          'order.item_removed',
          'order.sent',
          'order.status_changed'
        ])
      )
    })

    it('gives the owner every order permission and lets cancel imply operate and view', () => {
      const ownerRole = app.services.roles.list().find((r) => r.name === 'OWNER')
      expect(ownerRole?.permissions).toEqual(
        expect.arrayContaining(['orders.view', 'orders.operate', 'orders.cancel'])
      )
      expect(withImpliedPermissions(['orders.cancel'])).toEqual(
        expect.arrayContaining(['orders.view', 'orders.operate', 'orders.cancel'])
      )
      expect(withImpliedPermissions(['orders.view'])).toEqual(['orders.view'])
    })
  })
})
