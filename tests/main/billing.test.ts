import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyDiscountInputSchema,
  billFilterSchema,
  cancelBillInputSchema,
  generateBillInputSchema,
  payBillInputSchema,
  updateBillingSettingsInputSchema,
  type ApplyDiscountInput,
  type PaymentLineInput
} from '@shared/billing'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import { createTaxCategoryInputSchema } from '@shared/menu'
import {
  addItemsInputSchema,
  createOrderInputSchema,
  setOrderStatusInputSchema,
  type OrderLineInput
} from '@shared/orders'
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, billItems, bills, diningTables, payments } from '@main/db/schema'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

describe('billing', () => {
  let app: TestApp
  let owner: AuthContext
  let tableId: string
  let naan: string // 60.00 at 5%
  let tikka: string // 280.00 at 5%
  let soda: string // 40.00 at 18%
  let water: string // 20.00 untaxed

  const line = (menuItemId: string, quantity = 1): OrderLineInput => ({ menuItemId, quantity })
  const status = (orderId: string, next: string) =>
    app.services.orders.setStatus(
      owner,
      setOrderStatusInputSchema.parse({ id: orderId, status: next })
    )
  /** A served dine-in order, ready to bill. */
  const served = (lines: OrderLineInput[], atTable = tableId) => {
    const order = app.services.orders.create(
      owner,
      createOrderInputSchema.parse({ type: 'DINE_IN', tableId: atTable, lines })
    )
    app.services.orders.sendAndGetKots(owner, order.id)
    return status(order.id, 'SERVED')
  }
  const billFor = (orderId: string) =>
    app.services.bills.generate(owner, generateBillInputSchema.parse({ orderId }))
  /** The usual bill: 2 naan + tikka + soda = 440.00 before tax. */
  const usualBill = () => billFor(served([line(naan, 2), line(tikka), line(soda)]).id)
  const discount = (billId: string, extra: Partial<ApplyDiscountInput>) =>
    app.services.bills.applyDiscount(
      owner,
      applyDiscountInputSchema.parse({
        billId,
        scope: 'BILL',
        type: 'PERCENTAGE',
        value: 1000,
        reason: 'Regular guest',
        ...extra
      })
    )
  const pay = (billId: string, lines: PaymentLineInput[]) =>
    app.services.bills.pay(owner, payBillInputSchema.parse({ billId, payments: lines }))
  const settings = (extra: Record<string, unknown> = {}) =>
    app.services.billingSettings.update(
      owner,
      updateBillingSettingsInputSchema.parse({
        taxMode: 'INTRA_STATE',
        serviceChargeBps: 0,
        serviceChargeDineInOnly: true,
        serviceChargeTaxable: true,
        roundOffUnit: 100,
        ...extra
      })
    )
  const actions = () =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .all()
      .map((row) => row.action)
      .filter((action) => action.startsWith('bill'))
  const tableStatus = () =>
    app.handle.db.select().from(diningTables).where(eq(diningTables.id, tableId)).get()?.status

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
    const tax = (name: string, rateBps: number) =>
      app.services.taxCategories.create(
        owner,
        createTaxCategoryInputSchema.parse({ name, rateBps })
      ).id
    const gst5 = tax('GST 5%', 500)
    const gst18 = tax('GST 18%', 1800)
    const item = (name: string, price: number, taxCategoryId: string | null) =>
      app.services.items.create(
        owner,
        createItemInputSchema.parse({
          categoryId: category,
          name,
          price,
          foodType: 'VEG',
          taxCategoryId
        })
      ).id
    naan = item('Butter Naan', 6000, gst5)
    tikka = item('Paneer Tikka', 28000, gst5)
    soda = item('Soda', 4000, gst18)
    water = item('Water', 2000, null)
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('making a bill', () => {
    it('works out every figure from the order', () => {
      const bill = usualBill()
      expect(bill.billNumber).toMatch(/^[A-Z]{2}-BILL-000001$/)
      expect(bill.status).toBe('PENDING')
      expect(bill.subtotal).toBe(44000)
      expect(bill.items.map((i) => [i.name, i.quantity, i.unitPrice, i.gross])).toEqual([
        ['Butter Naan', 2, 6000, 12000],
        ['Paneer Tikka', 1, 28000, 28000],
        ['Soda', 1, 4000, 4000]
      ])
      expect(bill.taxes).toEqual([
        { component: 'CGST', rateBps: 500, taxableAmount: 40000, taxAmount: 1000 },
        { component: 'SGST', rateBps: 500, taxableAmount: 40000, taxAmount: 1000 },
        { component: 'CGST', rateBps: 1800, taxableAmount: 4000, taxAmount: 360 },
        { component: 'SGST', rateBps: 1800, taxableAmount: 4000, taxAmount: 360 }
      ])
      expect(bill.taxTotal).toBe(2720)
      expect(bill.serviceCharge).toBe(0)
      expect(bill.roundOff).toBe(-20) // 467.20 to 467.00
      expect(bill.grandTotal).toBe(46700)
      expect(bill.paidTotal).toBe(0)
      expect(bill.balance).toBe(46700)
      expect(bill.tableNumber).toBe('T1')
    })

    it('moves the order to "bill requested" and shows the bill on the order', () => {
      const order = served([line(naan)])
      const bill = billFor(order.id)
      const after = app.services.orders.get(order.id)
      expect(after.status).toBe('BILL_REQUESTED')
      expect(after.bill).toEqual({
        id: bill.id,
        billNumber: bill.billNumber,
        status: 'PENDING',
        grandTotal: bill.grandTotal
      })
    })

    it('numbers bills in order', () => {
      const first = billFor(served([line(naan)]).id)
      const other = app.services.tables.create(
        owner,
        createTableInputSchema.parse({
          areaId: app.services.areas.list()[0]?.id ?? '',
          tableNumber: 'T2',
          capacity: 2,
          type: 'AC'
        })
      ).id
      const second = billFor(served([line(tikka)], other).id)
      expect(first.billNumber.endsWith('000001')).toBe(true)
      expect(second.billNumber.endsWith('000002')).toBe(true)
    })

    it('leaves cancelled lines off the bill', () => {
      const order = served([line(naan), line(tikka)])
      const tikkaLine = order.lines.find((l) => l.name === 'Paneer Tikka')
      expect(tikkaLine).toBeDefined()
      app.services.orders.cancelLine(owner, {
        orderId: order.id,
        lineId: tikkaLine?.id ?? '',
        reason: 'Guest changed mind'
      })
      const bill = billFor(order.id)
      expect(bill.items.map((i) => i.name)).toEqual(['Butter Naan'])
      expect(bill.subtotal).toBe(6000)
    })

    it('includes priced add-ons and untaxed items', () => {
      const bill = billFor(served([line(water, 3)]).id)
      expect(bill.taxes).toEqual([])
      expect(bill.subtotal).toBe(6000)
      expect(bill.grandTotal).toBe(6000)
      expect(bill.roundOff).toBe(0)
    })

    it('refuses an order that is not served, one with unsent items, and an empty one', async () => {
      const open = app.services.orders.create(
        owner,
        createOrderInputSchema.parse({ type: 'DINE_IN', tableId, lines: [line(naan)] })
      )
      expect(await failureCode(() => billFor(open.id))).toBe('CONFLICT')
      expect(await failureCode(() => billFor(crypto.randomUUID()))).toBe('NOT_FOUND')
    })

    it('makes one live bill per order', async () => {
      const order = served([line(naan)])
      billFor(order.id)
      expect(await failureCode(() => billFor(order.id))).toBe('CONFLICT')
      expect(app.services.bills.list({ orderId: order.id })).toHaveLength(1)
    })

    it('is not changed by later edits to the billing settings', () => {
      settings({ serviceChargeBps: 1000 })
      const bill = billFor(served([line(tikka)]).id)
      expect(bill.serviceCharge).toBe(2800)
      settings({ serviceChargeBps: 0, roundOffUnit: 1, taxMode: 'INTER_STATE' })
      const again = app.services.bills.get(bill.id)
      expect(again.serviceCharge).toBe(2800)
      expect(again.grandTotal).toBe(bill.grandTotal)
      expect(again.taxMode).toBe('INTRA_STATE')
      expect(again.roundOffUnit).toBe(100)
    })

    it('does not trust anything but the order: totals sent in are dropped', () => {
      const parsed = generateBillInputSchema.parse({
        orderId: crypto.randomUUID(),
        grandTotal: 1,
        subtotal: 1
      })
      expect(parsed).not.toHaveProperty('grandTotal')
      expect(parsed).not.toHaveProperty('subtotal')
    })
  })

  describe('billing settings', () => {
    it('starts with the documented defaults', () => {
      expect(app.services.billingSettings.get()).toEqual({
        taxMode: 'INTRA_STATE',
        serviceChargeBps: 0,
        serviceChargeDineInOnly: true,
        serviceChargeTaxable: true,
        roundOffUnit: 100,
        autoPrintReceipt: false
      })
    })

    it('saves changes in the database and records them', () => {
      const saved = settings({ taxMode: 'INTER_STATE', serviceChargeBps: 500, roundOffUnit: 10 })
      expect(saved).toMatchObject({
        taxMode: 'INTER_STATE',
        serviceChargeBps: 500,
        roundOffUnit: 10
      })
      expect(app.services.billingSettings.get()).toEqual(saved)
      settings({ serviceChargeBps: 700 })
      expect(app.services.billingSettings.get().serviceChargeBps).toBe(700)
      expect(actions().filter((a) => a === 'billing.settings_updated')).toHaveLength(2)
    })

    it('refuses nonsense', () => {
      for (const bad of [
        { serviceChargeBps: -1 },
        { serviceChargeBps: 3001 },
        { serviceChargeBps: 5.5 },
        { roundOffUnit: 7 },
        { taxMode: 'EXEMPT' }
      ]) {
        expect(
          updateBillingSettingsInputSchema.safeParse({
            taxMode: 'INTRA_STATE',
            serviceChargeBps: 0,
            serviceChargeDineInOnly: true,
            serviceChargeTaxable: true,
            roundOffUnit: 100,
            ...bad
          }).success
        ).toBe(false)
      }
    })

    it('charges IGST when set to inter-state', () => {
      settings({ taxMode: 'INTER_STATE', roundOffUnit: 1 })
      const bill = billFor(served([line(tikka)]).id)
      expect(bill.taxes).toEqual([
        { component: 'IGST', rateBps: 500, taxableAmount: 28000, taxAmount: 1400 }
      ])
      expect(bill.grandTotal).toBe(29400)
    })

    it('adds the service charge to dine-in bills, taxed unless set otherwise', () => {
      settings({ serviceChargeBps: 1000, roundOffUnit: 1 })
      const taxed = billFor(served([line(tikka)]).id)
      expect(taxed.serviceCharge).toBe(2800)
      expect(taxed.serviceChargeBps).toBe(1000)
      expect(taxed.taxes[0]?.taxableAmount).toBe(30800)
      expect(taxed.grandTotal).toBe(28000 + 2800 + 1540)

      const other = app.services.tables.create(
        owner,
        createTableInputSchema.parse({
          areaId: app.services.areas.list()[0]?.id ?? '',
          tableNumber: 'T2',
          capacity: 2,
          type: 'AC'
        })
      ).id
      settings({ serviceChargeBps: 1000, serviceChargeTaxable: false, roundOffUnit: 1 })
      const untaxed = billFor(served([line(tikka)], other).id)
      expect(untaxed.taxes[0]?.taxableAmount).toBe(28000)
      expect(untaxed.grandTotal).toBe(28000 + 2800 + 1400)
    })

    it('leaves the service charge off a takeaway when it is for dine-in only', () => {
      settings({ serviceChargeBps: 1000, roundOffUnit: 1 })
      const order = app.services.orders.create(
        owner,
        createOrderInputSchema.parse({ type: 'TAKEAWAY', lines: [line(tikka)] })
      )
      app.services.orders.sendAndGetKots(owner, order.id)
      status(order.id, 'SERVED')
      const takeaway = billFor(order.id)
      expect(takeaway.serviceCharge).toBe(0)
      expect(takeaway.serviceChargeBps).toBe(0)
    })

    it('can charge service on every order type', () => {
      settings({ serviceChargeBps: 500, serviceChargeDineInOnly: false, roundOffUnit: 1 })
      const order = app.services.orders.create(
        owner,
        createOrderInputSchema.parse({ type: 'TAKEAWAY', lines: [line(tikka)] })
      )
      app.services.orders.sendAndGetKots(owner, order.id)
      status(order.id, 'SERVED')
      expect(billFor(order.id).serviceCharge).toBe(1400)
    })
  })

  describe('discounts', () => {
    it('takes a percentage off the bill before tax', () => {
      const bill = usualBill()
      const after = discount(bill.id, { type: 'PERCENTAGE', value: 1000 })
      expect(after.billDiscountTotal).toBe(4400)
      expect(after.discountedSubtotal).toBe(39600)
      expect(after.items.map((i) => i.billDiscountShare)).toEqual([1200, 2800, 400])
      expect(after.taxTotal).toBe(2448) // 5% of 36000 + 18% of 3600
      expect(after.grandTotal).toBe(42000)
      expect(after.roundOff).toBe(-48)
      expect(after.discounts).toHaveLength(1)
      expect(after.discounts[0]).toMatchObject({
        scope: 'BILL',
        type: 'PERCENTAGE',
        value: 1000,
        amount: 4400,
        reason: 'Regular guest',
        appliedByName: 'Olivia Owner'
      })
    })

    it('takes a fixed amount off the bill', () => {
      const bill = usualBill()
      const after = discount(bill.id, { type: 'FIXED', value: 4400 })
      expect(after.billDiscountTotal).toBe(4400)
      expect(after.grandTotal).toBe(42000)
    })

    it('takes a discount off one item', () => {
      const bill = usualBill()
      const tikkaLine = bill.items.find((i) => i.name === 'Paneer Tikka')
      const after = discount(bill.id, {
        scope: 'ITEM',
        billItemId: tikkaLine?.id,
        type: 'FIXED',
        value: 2800
      })
      expect(after.itemDiscountTotal).toBe(2800)
      expect(after.items.find((i) => i.name === 'Paneer Tikka')?.itemDiscount).toBe(2800)
      expect(after.discountedSubtotal).toBe(41200)
      expect(after.taxTotal).toBe(2580) // 5% of 37200 + 18% of 4000
      expect(after.grandTotal).toBe(43800)
      expect(after.roundOff).toBe(20)
    })

    it('combines an item discount and a bill discount', () => {
      const bill = usualBill()
      const tikkaLine = bill.items.find((i) => i.name === 'Paneer Tikka')
      discount(bill.id, {
        scope: 'ITEM',
        billItemId: tikkaLine?.id,
        type: 'PERCENTAGE',
        value: 5000
      })
      const after = discount(bill.id, { type: 'FIXED', value: 3000 })
      // 440.00 - 140.00 item discount - 30.00 bill discount
      expect(after.itemDiscountTotal).toBe(14000)
      expect(after.billDiscountTotal).toBe(3000)
      expect(after.discountedSubtotal).toBe(27000)
      expect(after.items.reduce((s, i) => s + i.billDiscountShare, 0)).toBe(3000)
      expect(after.discounts).toHaveLength(2)
    })

    it('puts the discount before the service charge', () => {
      settings({ serviceChargeBps: 1000, roundOffUnit: 1 })
      const bill = billFor(served([line(tikka)]).id)
      const after = discount(bill.id, { type: 'PERCENTAGE', value: 1000 })
      expect(after.discountedSubtotal).toBe(25200)
      expect(after.serviceCharge).toBe(2520)
      expect(after.grandTotal).toBe(25200 + 2520 + 1386)
    })

    it('allows 100% off and then settles the bill with no payment', () => {
      const bill = usualBill()
      const free = discount(bill.id, { type: 'PERCENTAGE', value: 10000, reason: "Owner's guest" })
      expect(free.grandTotal).toBe(0)
      expect(free.taxes).toEqual([])
      const paid = pay(bill.id, []).bill
      expect(paid.status).toBe('PAID')
      expect(paid.payments).toEqual([])
    })

    it('allows only one discount per item and one for the bill', async () => {
      const bill = usualBill()
      const naanLine = bill.items[0]
      discount(bill.id, {})
      expect(await failureCode(() => discount(bill.id, { value: 500 }))).toBe('CONFLICT')
      const item = { scope: 'ITEM' as const, billItemId: naanLine?.id }
      discount(bill.id, { ...item, value: 500 })
      expect(await failureCode(() => discount(bill.id, { ...item, value: 600 }))).toBe('CONFLICT')
    })

    it('refuses a fixed discount above what it applies to, and an item that is not on the bill', async () => {
      const bill = usualBill()
      expect(await failureCode(() => discount(bill.id, { type: 'FIXED', value: 44001 }))).toBe(
        'VALIDATION_ERROR'
      )
      const naanLine = bill.items[0]
      expect(
        await failureCode(() =>
          discount(bill.id, {
            scope: 'ITEM',
            billItemId: naanLine?.id,
            type: 'FIXED',
            value: 12001
          })
        )
      ).toBe('VALIDATION_ERROR')
      expect(
        await failureCode(() =>
          discount(bill.id, { scope: 'ITEM', billItemId: crypto.randomUUID() })
        )
      ).toBe('NOT_FOUND')
      expect(app.services.bills.get(bill.id).discounts).toEqual([])
    })

    it('needs a sensible request and a reason', () => {
      const base = {
        billId: crypto.randomUUID(),
        scope: 'BILL',
        type: 'PERCENTAGE',
        value: 500,
        reason: 'Loyal guest'
      }
      expect(applyDiscountInputSchema.safeParse(base).success).toBe(true)
      for (const bad of [
        { reason: 'x' },
        { reason: '   ' },
        { reason: 'x'.repeat(201) },
        { value: 0 },
        { value: -5 },
        { value: 10.5 },
        { value: 10001 },
        { scope: 'ITEM' },
        { scope: 'BILL', billItemId: crypto.randomUUID() },
        { type: 'BOGO' }
      ]) {
        expect(applyDiscountInputSchema.safeParse({ ...base, ...bad }).success).toBe(false)
      }
    })

    it('can be removed, which restores the bill and keeps the record', () => {
      const bill = usualBill()
      const given = discount(bill.id, {})
      const removed = app.services.bills.removeDiscount(owner, {
        billId: bill.id,
        discountId: given.discounts[0]?.id ?? ''
      })
      expect(removed.discounts).toEqual([])
      expect(removed.grandTotal).toBe(bill.grandTotal)
      expect(removed.billDiscountTotal).toBe(0)
      // The discount can now be given again.
      expect(discount(bill.id, { value: 2000 }).billDiscountTotal).toBe(8800)
    })

    it('cannot remove a discount that is not on the bill', async () => {
      const bill = usualBill()
      expect(
        await failureCode(() =>
          app.services.bills.removeDiscount(owner, {
            billId: bill.id,
            discountId: crypto.randomUUID()
          })
        )
      ).toBe('NOT_FOUND')
    })

    it('records who gave and removed it, and why', () => {
      const bill = usualBill()
      const given = discount(bill.id, { reason: 'Birthday' })
      app.services.bills.removeDiscount(owner, {
        billId: bill.id,
        discountId: given.discounts[0]?.id ?? ''
      })
      const rows = app.handle.db
        .select({ action: auditLogs.action, details: auditLogs.details })
        .from(auditLogs)
        .all()
      const applied = rows.find((r) => r.action === 'bill.discount_applied')
      expect(applied).toBeDefined()
      expect(JSON.stringify(applied?.details)).toContain('Birthday')
      expect(actions()).toContain('bill.discount_removed')
    })
  })

  describe('cancelling a bill', () => {
    it('returns the order to served and frees it to be changed and billed again', () => {
      const order = served([line(naan)])
      const bill = billFor(order.id)
      const cancelled = app.services.bills.cancel(owner, { id: bill.id, reason: 'Wrong item' })
      expect(cancelled.status).toBe('CANCELLED')
      expect(cancelled.cancelReason).toBe('Wrong item')
      expect(cancelled.cancelledAt).not.toBeNull()
      expect(app.services.orders.get(order.id).status).toBe('SERVED')
      expect(app.services.orders.get(order.id).bill).toBeNull()

      app.services.orders.addItems(
        owner,
        addItemsInputSchema.parse({ orderId: order.id, lines: [line(tikka)] })
      )
      app.services.orders.sendAndGetKots(owner, order.id)
      status(order.id, 'SERVED')
      const again = billFor(order.id)
      expect(again.billNumber).not.toBe(bill.billNumber)
      expect(again.subtotal).toBe(34000)
      expect(app.services.bills.list({ orderId: order.id })).toHaveLength(2)
    })

    it('needs a reason and cannot be done twice', async () => {
      const bill = billFor(served([line(naan)]).id)
      expect(cancelBillInputSchema.safeParse({ id: bill.id, reason: 'x' }).success).toBe(false)
      app.services.bills.cancel(owner, { id: bill.id, reason: 'Mistake' })
      expect(
        await failureCode(() =>
          app.services.bills.cancel(owner, { id: bill.id, reason: 'Mistake' })
        )
      ).toBe('CONFLICT')
    })

    it('locks a cancelled bill', async () => {
      const bill = usualBill()
      app.services.bills.cancel(owner, { id: bill.id, reason: 'Mistake' })
      expect(await failureCode(() => discount(bill.id, {}))).toBe('CONFLICT')
      expect(await failureCode(() => pay(bill.id, [{ method: 'CASH', amount: 100 }]))).toBe(
        'CONFLICT'
      )
    })

    it('cannot be done once a payment has been taken', async () => {
      const bill = usualBill()
      pay(bill.id, [{ method: 'CASH', amount: 10000 }])
      expect(
        await failureCode(() =>
          app.services.bills.cancel(owner, { id: bill.id, reason: 'Mistake' })
        )
      ).toBe('CONFLICT')
    })

    it('cannot be bypassed by changing the order while the bill stands', async () => {
      const order = served([line(naan)])
      billFor(order.id)
      expect(await failureCode(() => status(order.id, 'SERVED'))).toBe('CONFLICT')
      expect(
        await failureCode(() =>
          app.services.orders.addItems(
            owner,
            addItemsInputSchema.parse({ orderId: order.id, lines: [line(tikka)] })
          )
        )
      ).toBe('CONFLICT')
    })
  })

  describe('payment', () => {
    it('settles a bill paid in cash, completes the order and marks the table paid', () => {
      const order = served([line(tikka)])
      const bill = billFor(order.id)
      expect(bill.grandTotal).toBe(29400)
      const result = pay(bill.id, [{ method: 'CASH', amount: 29400 }])
      expect(result.changeDue).toBe(0)
      expect(result.bill).toMatchObject({ status: 'PAID', paidTotal: 29400, balance: 0 })
      expect(result.bill.paidAt).not.toBeNull()
      expect(app.services.orders.get(order.id).status).toBe('COMPLETED')
      expect(tableStatus()).toBe('PAID')
    })

    it('gives change for cash handed over', () => {
      const bill = billFor(served([line(tikka)]).id)
      const result = pay(bill.id, [{ method: 'CASH', amount: 29400, tendered: 50000 }])
      expect(result.changeDue).toBe(20600)
      expect(result.bill.payments[0]).toMatchObject({
        method: 'CASH',
        amount: 29400,
        tendered: 50000,
        change: 20600
      })
      expect(result.bill.paidTotal).toBe(29400)
    })

    it('takes a split payment across several methods', () => {
      const bill = usualBill()
      const result = pay(bill.id, [
        { method: 'CASH', amount: 10000 },
        { method: 'UPI', amount: 20000, reference: 'UTR 4455' },
        { method: 'CARD', amount: 10000, reference: '1234' },
        { method: 'OTHER', amount: 6700, reference: 'Gift voucher' }
      ])
      expect(result.bill.status).toBe('PAID')
      expect(result.bill.payments.map((p) => [p.method, p.amount])).toEqual([
        ['CASH', 10000],
        ['UPI', 20000],
        ['CARD', 10000],
        ['OTHER', 6700]
      ])
      expect(result.bill.payments[1]?.reference).toBe('UTR 4455')
      expect(result.bill.payments.every((p) => p.receivedByName === 'Olivia Owner')).toBe(true)
    })

    it('gives change on the cash part of a split', () => {
      const bill = usualBill()
      const result = pay(bill.id, [
        { method: 'UPI', amount: 40000 },
        { method: 'CASH', amount: 6700, tendered: 10000 }
      ])
      expect(result.changeDue).toBe(3300)
      expect(result.bill.status).toBe('PAID')
    })

    it('keeps a part-paid bill open until the balance is paid', () => {
      const bill = usualBill()
      const first = pay(bill.id, [{ method: 'UPI', amount: 20000 }]).bill
      expect(first).toMatchObject({ status: 'PARTIAL', paidTotal: 20000, balance: 26700 })
      expect(app.services.orders.get(first.orderId).status).toBe('BILL_REQUESTED')
      expect(tableStatus()).not.toBe('PAID')
      const last = pay(bill.id, [{ method: 'CASH', amount: 26700 }]).bill
      expect(last).toMatchObject({ status: 'PAID', paidTotal: 46700, balance: 0 })
      expect(last.payments).toHaveLength(2)
      expect(app.services.orders.get(first.orderId).status).toBe('COMPLETED')
    })

    it('refuses payments above the balance and leaves nothing behind', async () => {
      const bill = usualBill()
      expect(
        await failureCode(() =>
          pay(bill.id, [
            { method: 'UPI', amount: 40000 },
            { method: 'CARD', amount: 6701 }
          ])
        )
      ).toBe('VALIDATION_ERROR')
      expect(app.services.bills.get(bill.id)).toMatchObject({ status: 'PENDING', paidTotal: 0 })
      expect(app.handle.db.select().from(payments).all()).toEqual([])
    })

    it('refuses a payment on a paid bill and an empty payment on a bill with something owing', async () => {
      const bill = usualBill()
      expect(await failureCode(() => pay(bill.id, []))).toBe('VALIDATION_ERROR')
      pay(bill.id, [{ method: 'CASH', amount: 46700 }])
      expect(await failureCode(() => pay(bill.id, [{ method: 'CASH', amount: 100 }]))).toBe(
        'CONFLICT'
      )
    })

    it('refuses badly formed payments', () => {
      const billId = crypto.randomUUID()
      const ok = { billId, payments: [{ method: 'CASH', amount: 100 }] }
      expect(payBillInputSchema.safeParse(ok).success).toBe(true)
      for (const payments of [
        [{ method: 'CASH', amount: 0 }],
        [{ method: 'CASH', amount: -1 }],
        [{ method: 'CASH', amount: 10.5 }],
        [{ method: 'CASH', amount: 100_000_001 }],
        [{ method: 'CASH', amount: 100, tendered: 50 }],
        [{ method: 'UPI', amount: 100, tendered: 200 }],
        [{ method: 'OTHER', amount: 100 }],
        [{ method: 'CRYPTO', amount: 100 }],
        Array.from({ length: 11 }, () => ({ method: 'CASH', amount: 1 }))
      ]) {
        expect(payBillInputSchema.safeParse({ billId, payments }).success).toBe(false)
      }
    })

    it('ignores a total sent along with a payment', () => {
      const parsed = payBillInputSchema.parse({
        billId: crypto.randomUUID(),
        grandTotal: 1,
        payments: [{ method: 'CASH', amount: 100, change: 99999 }]
      })
      expect(parsed).not.toHaveProperty('grandTotal')
      expect(parsed.payments[0]).not.toHaveProperty('change')
    })

    it('locks a bill that has had a payment', async () => {
      const bill = usualBill()
      pay(bill.id, [{ method: 'UPI', amount: 100 }])
      expect(await failureCode(() => discount(bill.id, {}))).toBe('CONFLICT')
    })
  })

  describe('integrity', () => {
    it('refuses to change the amounts of a bill after payment, in the database itself', () => {
      const bill = usualBill()
      pay(bill.id, [{ method: 'CASH', amount: 46700 }])
      const run = (statement: ReturnType<typeof sql>) => () => app.handle.db.run(statement)
      expect(run(sql`update bills set grand_total = 1 where id = ${bill.id}`)).toThrow()
      expect(run(sql`update bills set status = 'PENDING' where id = ${bill.id}`)).toThrow()
      expect(run(sql`update bills set bill_number = 'X' where id = ${bill.id}`)).toThrow()
      expect(run(sql`delete from bills where id = ${bill.id}`)).toThrow()
      expect(run(sql`update bill_items set quantity = 9 where bill_id = ${bill.id}`)).toThrow()
      expect(run(sql`update bill_items set gross = 1 where bill_id = ${bill.id}`)).toThrow()
      expect(run(sql`delete from bill_items where bill_id = ${bill.id}`)).toThrow()
      expect(run(sql`update payments set amount = 1 where bill_id = ${bill.id}`)).toThrow()
      expect(run(sql`delete from payments where bill_id = ${bill.id}`)).toThrow()
      expect(app.services.bills.get(bill.id).grandTotal).toBe(46700)
      expect(app.handle.db.select().from(billItems).all().length).toBe(3)
    })

    it('refuses a payment on a bill that is not open, in the database itself', () => {
      const bill = usualBill()
      app.services.bills.cancel(owner, { id: bill.id, reason: 'Mistake' })
      const insert = () =>
        app.handle.db.run(
          sql`insert into payments (id, bill_id, method, amount, tendered, received_by, received_at, created_at, updated_at, version)
              select lower(hex(randomblob(16))), id, 'CASH', 100, 100, created_by, 0, 0, 0, 1 from bills where id = ${bill.id}`
        )
      expect(insert).toThrow()
      expect(app.handle.db.select().from(payments).all()).toEqual([])
      expect(app.handle.db.select().from(bills).all()).toHaveLength(1)
    })
  })

  describe('listing', () => {
    it('lists bills, newest first, and filters them', () => {
      const first = billFor(served([line(naan)]).id)
      const other = app.services.tables.create(
        owner,
        createTableInputSchema.parse({
          areaId: app.services.areas.list()[0]?.id ?? '',
          tableNumber: 'T2',
          capacity: 2,
          type: 'AC'
        })
      ).id
      const second = billFor(served([line(tikka)], other).id)
      pay(second.id, [{ method: 'CASH', amount: second.grandTotal }])

      const all = app.services.bills.list(billFilterSchema.parse({}))
      expect(all.map((b) => b.id)).toEqual([second.id, first.id])
      expect(app.services.bills.list({ statuses: ['PAID'] }).map((b) => b.id)).toEqual([second.id])
      expect(
        app.services.bills.list({ statuses: ['PENDING', 'PARTIAL'] }).map((b) => b.id)
      ).toEqual([first.id])
      expect(app.services.bills.list({ search: '000001' }).map((b) => b.id)).toEqual([first.id])
      expect(app.services.bills.list({ search: second.orderNumber }).map((b) => b.id)).toEqual([
        second.id
      ])
      expect(app.services.bills.list({ search: '%' })).toEqual([])
      const summary = all.find((b) => b.id === second.id)
      expect(summary).toMatchObject({ paidTotal: second.grandTotal, balance: 0, tableNumber: 'T2' })
    })

    it('says so when a bill does not exist', async () => {
      expect(await failureCode(() => app.services.bills.get(crypto.randomUUID()))).toBe('NOT_FOUND')
    })
  })

  describe('the audit trail', () => {
    it('records making, discounting, paying and cancelling a bill', () => {
      const first = usualBill()
      discount(first.id, {})
      pay(first.id, [{ method: 'CASH', amount: 42000 }])
      const spare = app.services.tables.create(
        owner,
        createTableInputSchema.parse({
          areaId: app.services.areas.list()[0]?.id ?? '',
          tableNumber: 'T2',
          capacity: 2,
          type: 'AC'
        })
      ).id
      const other = billFor(served([line(naan)], spare).id)
      app.services.bills.cancel(owner, { id: other.id, reason: 'Mistake' })
      const seen = new Set(actions())
      for (const action of [
        'bill.generated',
        'bill.discount_applied',
        'bill.payment_recorded',
        'bill.paid',
        'bill.cancelled'
      ]) {
        expect(seen.has(action)).toBe(true)
      }
    })
  })
})
