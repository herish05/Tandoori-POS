import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyDiscountInputSchema,
  generateBillInputSchema,
  payBillInputSchema,
  updateBillingSettingsInputSchema
} from '@shared/billing'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import {
  addItemsInputSchema,
  createOrderInputSchema,
  dispatchOrderInputSchema,
  orderStatusLabelFor,
  setOrderStatusInputSchema,
  updateOrderInputSchema,
  type OrderDetail,
  type OrderLineInput
} from '@shared/orders'
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, bills } from '@main/db/schema'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

const MINUTE = 60_000

describe('takeaway, pickup and delivery', () => {
  let app: TestApp
  let owner: AuthContext
  let tableId: string
  let dal: string // 240.00, untaxed
  let naan: string // 60.00, untaxed

  const line = (menuItemId: string, quantity = 1): OrderLineInput => ({ menuItemId, quantity })
  const inMinutes = (minutes: number) => new Date(app.clock.now + minutes * MINUTE).toISOString()

  const customer = {
    customerName: 'Gurpreet',
    customerPhone: '98765 43210',
    deliveryAddress: 'Near Bus Stand, Rampura Phul'
  }
  const create = (
    type: 'TAKEAWAY' | 'PICKUP' | 'DELIVERY' | 'DINE_IN',
    extra: Record<string, unknown> = {},
    lines: OrderLineInput[] = [line(dal)]
  ) =>
    app.services.orders.create(
      owner,
      createOrderInputSchema.parse({
        type,
        ...(type === 'DELIVERY' ? customer : {}),
        ...(type === 'DINE_IN' ? { tableId, guestCount: 2 } : {}),
        lines,
        ...extra
      })
    )
  const status = (orderId: string, next: string) =>
    app.services.orders.setStatus(
      owner,
      setOrderStatusInputSchema.parse({ id: orderId, status: next })
    )
  /** Sends the order and has every kitchen ticket finish it, so it is ready. */
  const ready = (order: OrderDetail) => {
    const { kotIds } = app.services.orders.sendAndGetKots(owner, order.id)
    for (const id of kotIds) {
      for (const next of ['ACCEPTED', 'PREPARING', 'READY'] as const) {
        app.services.kots.setStatus(owner, { id, status: next })
      }
    }
    return app.services.orders.get(order.id)
  }
  const dispatch = (orderId: string, riderName = 'Sukhi', riderPhone = '90000 11111') =>
    app.services.orders.dispatch(
      owner,
      dispatchOrderInputSchema.parse({ orderId, riderName, riderPhone })
    )
  /** Handed over to the customer (a delivery goes out with a rider first). */
  const served = (order: OrderDetail) => {
    if (order.type === 'DELIVERY') {
      ready(order)
      dispatch(order.id)
    } else {
      app.services.orders.sendAndGetKots(owner, order.id)
    }
    return status(order.id, 'SERVED')
  }
  const settings = (extra: Record<string, unknown> = {}) =>
    app.services.billingSettings.update(
      owner,
      updateBillingSettingsInputSchema.parse({
        taxMode: 'INTRA_STATE',
        serviceChargeBps: 0,
        serviceChargeDineInOnly: true,
        serviceChargeTaxable: true,
        roundOffUnit: 1,
        ...extra
      })
    )
  const billFor = (orderId: string) =>
    app.services.bills.generate(owner, generateBillInputSchema.parse({ orderId }))
  const actions = () =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(sql`rowid`)
      .all()
      .map((row) => row.action)
  const run = (query: string, ...params: unknown[]) =>
    app.handle.sqlite.prepare(query).run(...params)

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
    const category = app.services.categories.create(
      owner,
      createCategoryInputSchema.parse({ name: 'Food' })
    ).id
    const item = (name: string, price: number) =>
      app.services.items.create(
        owner,
        createItemInputSchema.parse({ categoryId: category, name, price, foodType: 'VEG' })
      ).id
    dal = item('Dal Makhani', 24000)
    naan = item('Butter Naan', 6000)
  })

  afterEach(() => {
    app.cleanup()
  })

  describe('promised time', () => {
    it('is kept on a takeaway, pickup or delivery order', () => {
      const promised = inMinutes(30)
      const takeaway = create('TAKEAWAY', { promisedAt: promised })
      const pickup = create('PICKUP', { promisedAt: promised })
      const delivery = create('DELIVERY', { promisedAt: promised })
      for (const order of [takeaway, pickup, delivery]) {
        expect(order.promisedAt).toBe(promised)
      }
      expect(create('TAKEAWAY').promisedAt).toBeNull()
      expect(create('TAKEAWAY', { promisedAt: '' }).promisedAt).toBeNull()
    })

    it('does not exist on a dine-in order', () => {
      const order = create('DINE_IN', { promisedAt: inMinutes(30) })
      expect(order.promisedAt).toBeNull()
    })

    it('cannot be in the past or more than a week ahead', async () => {
      expect(() => create('TAKEAWAY', { promisedAt: inMinutes(-30) })).toThrow(/already passed/)
      expect(() => create('TAKEAWAY', { promisedAt: inMinutes(8 * 24 * 60) })).toThrow(/7 days/)
      // A few minutes of grace for a slow cashier.
      expect(create('TAKEAWAY', { promisedAt: inMinutes(-2) }).promisedAt).not.toBeNull()
      expect(await failureCode(() => create('TAKEAWAY', { promisedAt: inMinutes(-30) }))).toBe(
        'VALIDATION_ERROR'
      )
    })

    it('can be changed, cleared, and left alone after it has passed', () => {
      const order = create('TAKEAWAY', { promisedAt: inMinutes(20) })
      const update = (extra: Record<string, unknown>) =>
        app.services.orders.update(owner, updateOrderInputSchema.parse({ id: order.id, ...extra }))

      const later = inMinutes(45)
      expect(update({ promisedAt: later }).promisedAt).toBe(later)
      expect(update({ promisedAt: null }).promisedAt).toBeNull()

      const kept = update({ promisedAt: inMinutes(10) })
      app.clock.advance(40 * MINUTE)
      // Saving the same details again does not complain that the time has gone by.
      expect(update({ promisedAt: kept.promisedAt }).promisedAt).toBe(kept.promisedAt)
      expect(() => update({ promisedAt: inMinutes(-20) })).toThrow(/not passed/)
    })
  })

  describe('dispatching a delivery', () => {
    it('sends a ready delivery out with a rider', () => {
      const order = ready(create('DELIVERY'))
      expect(order.status).toBe('READY')
      expect(orderStatusLabelFor(order)).toBe('Ready to dispatch')

      const out = dispatch(order.id, 'Sukhi', '90000 11111')
      expect(out).toMatchObject({ riderName: 'Sukhi', riderPhone: '90000 11111' })
      expect(out.dispatchedAt).not.toBeNull()
      expect(out.status).toBe('READY')
      expect(orderStatusLabelFor(out)).toBe('Out for delivery')
      expect(actions()).toContain('order.dispatched')
    })

    it('only works for a delivery that the kitchen has finished', async () => {
      const early = create('DELIVERY')
      expect(await failureCode(() => dispatch(early.id))).toBe('CONFLICT')
      app.services.orders.sendAndGetKots(owner, early.id)
      expect(() => dispatch(early.id)).toThrow(/not finished/)

      const takeaway = ready(create('TAKEAWAY'))
      expect(() => dispatch(takeaway.id)).toThrow(/Only a delivery/)
    })

    it('needs a rider name', () => {
      expect(
        dispatchOrderInputSchema.safeParse({ orderId: crypto.randomUUID(), riderName: ' ' }).success
      ).toBe(false)
      expect(
        dispatchOrderInputSchema.safeParse({
          orderId: crypto.randomUUID(),
          riderName: 'Sukhi',
          riderPhone: 'abc'
        }).success
      ).toBe(false)
      const parsed = dispatchOrderInputSchema.parse({
        orderId: crypto.randomUUID(),
        riderName: ' Sukhi ',
        riderPhone: ''
      })
      expect(parsed).toMatchObject({ riderName: 'Sukhi', riderPhone: null })
    })

    it('hands the order to another rider and keeps the first dispatch time', () => {
      const first = dispatch(ready(create('DELIVERY')).id, 'Sukhi')
      app.clock.advance(5 * MINUTE)
      const second = dispatch(first.id, 'Jaswant')
      expect(second.riderName).toBe('Jaswant')
      expect(second.dispatchedAt).toBe(first.dispatchedAt)
      const log = app.handle.db
        .select()
        .from(auditLogs)
        .orderBy(sql`rowid`)
        .all()
      const entry = log.filter((row) => row.action === 'order.dispatched').at(-1)
      expect(JSON.parse(entry?.details ?? '{}')).toMatchObject({
        reassigned: true,
        previousRider: 'Sukhi'
      })
    })

    it('locks the items while the order is out', () => {
      const out = dispatch(ready(create('DELIVERY')).id)
      expect(() =>
        app.services.orders.addItems(
          owner,
          addItemsInputSchema.parse({ orderId: out.id, lines: [line(naan)] })
        )
      ).toThrow(/out with a rider/)
    })

    it('cannot be marked delivered before it went out', () => {
      const order = ready(create('DELIVERY'))
      expect(() => status(order.id, 'SERVED')).toThrow(/rider/)
      dispatch(order.id)
      const delivered = status(order.id, 'SERVED')
      expect(delivered.status).toBe('SERVED')
      expect(orderStatusLabelFor(delivered)).toBe('Delivered')
      expect(delivered.handedOverAt).not.toBeNull()
      expect(() => dispatch(order.id)).toThrow(/already delivered/)
    })
  })

  describe('takeaway and pickup', () => {
    it('notes when the food was handed over', () => {
      for (const type of ['TAKEAWAY', 'PICKUP'] as const) {
        const order = ready(create(type))
        expect(orderStatusLabelFor(order)).toBe('Ready for pickup')
        expect(order.handedOverAt).toBeNull()
        const done = status(order.id, 'SERVED')
        expect(orderStatusLabelFor(done)).toBe('Handed over')
        expect(done.handedOverAt).not.toBeNull()
      }
    })

    it('keeps the dine-in wording', () => {
      const order = ready(create('DINE_IN'))
      expect(orderStatusLabelFor(order)).toBe('Ready')
      expect(status(order.id, 'SERVED').handedOverAt).toBeNull()
    })
  })

  describe('delivery and packaging charges', () => {
    const charges = {
      deliveryCharge: 3000,
      deliveryChargeTaxBps: 500,
      packagingCharge: 1000,
      packagingChargeTaxBps: 0
    }
    const billOf = (type: 'TAKEAWAY' | 'DELIVERY' | 'DINE_IN', lines = [line(dal)]) => {
      return billFor(served(create(type, {}, lines)).id)
    }

    it('are off until the owner sets them', () => {
      const bill = billOf('DELIVERY')
      expect(bill).toMatchObject({ deliveryCharge: 0, packagingCharge: 0, grandTotal: 24000 })
    })

    it('add a taxed delivery charge and a packaging charge to a delivery', () => {
      settings(charges)
      const bill = billOf('DELIVERY')
      expect(bill.deliveryCharge).toBe(3000)
      expect(bill.packagingCharge).toBe(1000)
      // 5% GST on the delivery charge only: 2.5% + 2.5% of 30.00.
      expect(bill.taxes).toEqual([
        { component: 'CGST', rateBps: 500, taxableAmount: 3000, taxAmount: 75 },
        { component: 'SGST', rateBps: 500, taxableAmount: 3000, taxAmount: 75 }
      ])
      expect(bill.taxTotal).toBe(150)
      expect(bill.grandTotal).toBe(24000 + 3000 + 1000 + 150)
    })

    it('charge only packaging on a takeaway, and nothing on dine-in', () => {
      settings(charges)
      expect(billOf('TAKEAWAY')).toMatchObject({
        deliveryCharge: 0,
        packagingCharge: 1000,
        grandTotal: 25000
      })
      expect(billOf('DINE_IN')).toMatchObject({
        deliveryCharge: 0,
        packagingCharge: 0,
        grandTotal: 24000
      })
    })

    it('waive the delivery charge on a big enough order', () => {
      settings({ ...charges, deliveryFreeAbove: 30000 })
      expect(billOf('DELIVERY', [line(dal)]).deliveryCharge).toBe(3000)
      expect(billOf('DELIVERY', [line(dal), line(naan)]).deliveryCharge).toBe(0)
    })

    it('are not discounted and carry no service charge', () => {
      settings({ ...charges, serviceChargeBps: 1000, serviceChargeDineInOnly: false })
      const bill = billOf('DELIVERY')
      expect(bill.serviceCharge).toBe(2400)
      app.services.bills.applyDiscount(
        owner,
        applyDiscountInputSchema.parse({
          billId: bill.id,
          scope: 'BILL',
          type: 'PERCENTAGE',
          value: 1000,
          reason: 'Regular guest'
        })
      )
      const after = app.services.bills.get(bill.id)
      expect(after.billDiscountTotal).toBe(2400)
      expect(after.serviceCharge).toBe(2160)
      expect(after.deliveryCharge).toBe(3000)
      expect(after.packagingCharge).toBe(1000)
      expect(after.grandTotal).toBe(24000 - 2400 + 2160 + 3000 + 1000 + 150)
    })

    it('stay as they were when the settings change later', () => {
      settings(charges)
      const bill = billOf('DELIVERY')
      settings({ ...charges, deliveryCharge: 9900, packagingCharge: 5000 })
      const same = app.services.bills.get(bill.id)
      expect(same).toMatchObject({ deliveryCharge: 3000, packagingCharge: 1000 })
      expect(billOf('DELIVERY').deliveryCharge).toBe(9900)
    })

    it('are refused when out of range', () => {
      const attempt = (extra: Record<string, unknown>) =>
        updateBillingSettingsInputSchema.safeParse({
          taxMode: 'INTRA_STATE',
          serviceChargeBps: 0,
          serviceChargeDineInOnly: true,
          serviceChargeTaxable: true,
          roundOffUnit: 1,
          ...extra
        }).success
      expect(attempt({ deliveryCharge: -1 })).toBe(false)
      expect(attempt({ deliveryCharge: 1_000_001 })).toBe(false)
      expect(attempt({ packagingChargeTaxBps: 2801 })).toBe(false)
      expect(attempt({ deliveryCharge: 1_000_000, packagingChargeTaxBps: 2800 })).toBe(true)
    })

    it('show on the printed receipt and are settled like any other amount', () => {
      settings(charges)
      const bill = billOf('DELIVERY')
      const text = app.services.receipts.preview({ billId: bill.id }).lines.join('\n')
      expect(text).toContain('Delivery charge')
      expect(text).toContain('Packaging charge')
      const paid = app.services.bills.pay(
        owner,
        payBillInputSchema.parse({
          billId: bill.id,
          payments: [{ method: 'CASH', amount: bill.grandTotal }]
        })
      )
      expect(paid.bill.status).toBe('PAID')
    })
  })

  describe('integrity, in the database itself', () => {
    it('keeps the delivery details off orders that are not deliveries', () => {
      const takeaway = create('TAKEAWAY')
      expect(() => run("update orders set rider_name = 'Sukhi' where id = ?", takeaway.id)).toThrow(
        /Only a delivery/
      )
      expect(() => run('update orders set dispatched_at = 1 where id = ?', takeaway.id)).toThrow(
        /Only a delivery/
      )
      const dineIn = create('DINE_IN')
      expect(() => run('update orders set promised_at = 1 where id = ?', dineIn.id)).toThrow(
        /dine-in order has no promised time/
      )
    })

    it('freezes the charges on a bill once payment has started', () => {
      settings({ deliveryCharge: 3000, deliveryChargeTaxBps: 0 })
      const bill = billFor(served(create('DELIVERY')).id)
      app.services.bills.pay(
        owner,
        payBillInputSchema.parse({
          billId: bill.id,
          payments: [{ method: 'CASH', amount: 1000 }]
        })
      )
      expect(() => run('update bills set delivery_charge = 0 where id = ?', bill.id)).toThrow(
        /cannot change once payment/
      )
      expect(() => run('update bills set packaging_charge = 5 where id = ?', bill.id)).toThrow(
        /cannot change once payment/
      )
      const row = app.handle.db.select().from(bills).where(eq(bills.id, bill.id)).get()
      expect(row?.deliveryCharge).toBe(3000)
    })
  })
})
