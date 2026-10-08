import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyDiscountInputSchema,
  generateBillInputSchema,
  payBillInputSchema,
  refundBillInputSchema
} from '@shared/billing'
import { closeDayInputSchema, reopenDayInputSchema } from '@shared/day-closing'
import { createExpenseCategoryInputSchema, createExpenseInputSchema } from '@shared/expenses'
import {
  createInventoryItemInputSchema,
  stockInInputSchema,
  wastageInputSchema
} from '@shared/inventory'
import {
  createCategoryInputSchema,
  createItemInputSchema,
  createTaxCategoryInputSchema
} from '@shared/menu'
import {
  cancelOrderInputSchema,
  createOrderInputSchema,
  setOrderStatusInputSchema
} from '@shared/orders'
import {
  createPurchaseInputSchema,
  createSupplierInputSchema,
  recordPaymentInputSchema
} from '@shared/purchasing'
import { MAX_REPORT_DAYS, REPORT_KINDS, REPORTS, reportFilterSchema } from '@shared/reports'
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { localDateString } from '@main/finance/dates'
import { reportToCsv, reportToHtml } from '@main/reports/format'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

const DAY = 24 * 60 * 60 * 1000

describe('reports', () => {
  let app: TestApp
  let owner: AuthContext
  let tableId: string
  let spareTableId: string
  let foodId: string
  let naan: string // 60.00 at 5%
  let tikka: string // 280.00 at 5%
  let soda: string // 40.00 at 18%

  const today = () => localDateString(app.clock.now)
  /** Rows made by the services are stamped with real time as well as the test clock. */
  const wide = () => ({
    from: localDateString(Math.min(app.clock.now, Date.now()) - DAY),
    to: localDateString(Math.max(app.clock.now, Date.now()) + DAY)
  })
  const run = (kind: string, extra: Record<string, unknown> = {}) =>
    app.services.reports.run(
      reportFilterSchema.parse({ kind, from: today(), to: today(), ...extra })
    )
  const runWide = (kind: string, extra: Record<string, unknown> = {}) =>
    run(kind, { ...wide(), ...extra })

  const newOrder = (table = tableId) =>
    app.services.orders.create(
      owner,
      createOrderInputSchema.parse({
        type: 'DINE_IN',
        tableId: table,
        lines: [
          { menuItemId: naan, quantity: 2 },
          { menuItemId: tikka, quantity: 1 },
          { menuItemId: soda, quantity: 1 }
        ]
      })
    )
  const servedBill = (table = tableId) => {
    const order = newOrder(table)
    app.services.orders.sendAndGetKots(owner, order.id)
    app.services.orders.setStatus(
      owner,
      setOrderStatusInputSchema.parse({ id: order.id, status: 'SERVED' })
    )
    return {
      order,
      bill: app.services.bills.generate(owner, generateBillInputSchema.parse({ orderId: order.id }))
    }
  }
  /** A bill of 467.00, paid 200.00 in cash and 267.00 by UPI. */
  const paidBill = (table = tableId) => {
    const { bill } = servedBill(table)
    app.services.bills.pay(
      owner,
      payBillInputSchema.parse({
        billId: bill.id,
        payments: [
          { method: 'CASH', amount: 20000 },
          { method: 'UPI', amount: 26700, reference: 'UTR 99' }
        ]
      })
    )
    return bill
  }
  const expenseCategory = (name = 'Rent') =>
    app.services.expenses.createCategory(owner, createExpenseCategoryInputSchema.parse({ name }))
  const expense = (categoryId: string, amount: number, extra: Record<string, unknown> = {}) =>
    app.services.expenses.create(
      owner,
      createExpenseInputSchema.parse({ categoryId, amount, method: 'CASH', ...extra })
    )
  const supplier = (name = 'Sharma Dairy') =>
    app.services.suppliers.create(owner, createSupplierInputSchema.parse({ name }))
  const stockItem = (name: string, extra: Record<string, unknown> = {}) =>
    app.services.inventory.create(
      owner,
      createInventoryItemInputSchema.parse({ name, unit: 'KG', ...extra })
    )

  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
    const hall = app.services.areas.create(owner, createAreaInputSchema.parse({ name: 'Hall' }))
    const table = (tableNumber: string) =>
      app.services.tables.create(
        owner,
        createTableInputSchema.parse({ areaId: hall.id, tableNumber, capacity: 4, type: 'AC' })
      ).id
    tableId = table('T1')
    spareTableId = table('T2')
    foodId = app.services.categories.create(
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
    const item = (name: string, price: number, taxCategoryId: string) =>
      app.services.items.create(
        owner,
        createItemInputSchema.parse({
          categoryId: foodId,
          name,
          price,
          foodType: 'VEG',
          taxCategoryId
        })
      ).id
    naan = item('Butter Naan', 6000, gst5)
    tikka = item('Paneer Tikka', 28000, gst5)
    soda = item('Soda', 4000, gst18)
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('the filter', () => {
    const base = { kind: 'SALES', from: '2026-01-01', to: '2026-01-31' }

    it('accepts a proper range', () => {
      expect(reportFilterSchema.safeParse(base).success).toBe(true)
      expect(reportFilterSchema.safeParse({ ...base, to: base.from }).success).toBe(true)
    })

    it('refuses a bad kind, bad dates, a backwards range and a range that is too long', () => {
      for (const bad of [
        { kind: 'NOPE' },
        { from: '01/01/2026' },
        { to: '2026-02-30' },
        { from: '2026-02-01', to: '2026-01-01' },
        { from: '2020-01-01', to: '2026-01-31' }
      ]) {
        expect(reportFilterSchema.safeParse({ ...base, ...bad }).success).toBe(false)
      }
      expect(MAX_REPORT_DAYS).toBeGreaterThan(365)
    })

    it('describes every kind', () => {
      for (const kind of REPORT_KINDS) {
        expect(REPORTS[kind].label.length).toBeGreaterThan(0)
        expect(REPORTS[kind].filters.length).toBeGreaterThanOrEqual(0)
      }
      expect(REPORT_KINDS).toHaveLength(17)
    })

    it('runs every report on an empty restaurant', () => {
      for (const kind of REPORT_KINDS) {
        const result = runWide(kind)
        expect(result.kind).toBe(kind)
        expect(result.title).toBe(REPORTS[kind].label)
        expect(result.columns.length).toBeGreaterThan(0)
        expect(result.rows).toEqual([])
        expect(result.totals).toBeNull()
        expect(result.truncated).toBe(false)
        expect(result.summary.length).toBeGreaterThan(0)
        for (const row of result.rows) {
          for (const column of result.columns) expect(column.key in row).toBe(true)
        }
      }
    })

    it('ignores filters a report does not use and rejects values it does not offer', async () => {
      const result = run('TAX', { staffId: 'someone', search: 'x', method: 'CASH' })
      expect(result.filters).toEqual([])
      expect(await failureCode(() => run('SALES', { method: 'BANK' }))).toBe('VALIDATION_ERROR')
      expect(await failureCode(() => run('EXPENSES', { method: 'GOLD' }))).toBe('VALIDATION_ERROR')
      expect(await failureCode(() => run('KOT', { status: 'LOST' }))).toBe('VALIDATION_ERROR')
    })
  })

  describe('sales', () => {
    it('lists each settled bill with its figures', () => {
      const bill = paidBill()
      const result = run('SALES')
      expect(result.rows).toHaveLength(1)
      const [row] = result.rows
      expect(row).toMatchObject({
        billNumber: bill.billNumber,
        orderType: 'Dine-in',
        table: 'T1',
        staff: 'Olivia Owner',
        subtotal: 44000,
        discount: 0,
        tax: 2720,
        roundOff: -20,
        total: 46700,
        refunded: 0,
        net: 46700
      })
      expect(String(row?.methods).split(', ').sort()).toEqual(['Cash', 'UPI'])
      expect(result.totals).toMatchObject({ total: 46700, net: 46700 })
      expect(result.summary).toContainEqual({ label: 'Bills', value: 1, type: 'int' })
      expect(result.summary).toContainEqual({ label: 'Net sales', value: 46700, type: 'money' })
    })

    it('leaves out bills that are unpaid or cancelled', () => {
      const unpaid = servedBill()
      const other = servedBill(spareTableId)
      app.services.bills.cancel(owner, { id: other.bill.id, reason: 'Mistake' })
      expect(unpaid.bill.id).not.toBe(other.bill.id)
      expect(run('SALES').rows).toEqual([])
    })

    it('takes refunds off the net', () => {
      const bill = paidBill()
      app.services.bills.refund(
        owner,
        refundBillInputSchema.parse({
          billId: bill.id,
          reason: 'Guest unhappy',
          lines: [{ method: 'CASH', amount: 5000 }]
        })
      )
      const result = run('SALES')
      expect(result.rows[0]).toMatchObject({ total: 46700, refunded: 5000, net: 41700 })
      expect(result.summary).toContainEqual({ label: 'Refunded', value: 5000, type: 'money' })
    })

    it('filters by method, order type and search', () => {
      const bill = paidBill()
      expect(run('SALES', { method: 'CASH' }).rows).toHaveLength(1)
      expect(run('SALES', { method: 'CARD' }).rows).toHaveLength(0)
      expect(run('SALES', { orderType: 'DELIVERY' }).rows).toHaveLength(0)
      expect(run('SALES', { orderType: 'DINE_IN' }).rows).toHaveLength(1)
      expect(run('SALES', { search: bill.billNumber.toLowerCase() }).rows).toHaveLength(1)
      expect(run('SALES', { search: 'zzz' }).rows).toHaveLength(0)
      expect(run('SALES', { staffId: owner.userId }).rows).toHaveLength(1)
      expect(run('SALES', { staffId: 'someone-else' }).rows).toHaveLength(0)
      expect(run('SALES', { method: 'CASH', orderType: 'DINE_IN' }).filters).toEqual([
        'Order type: Dine-in',
        'Method: Cash'
      ])
    })

    it('does not include a day outside the range', () => {
      paidBill()
      const tomorrow = localDateString(app.clock.now + 2 * DAY)
      expect(run('SALES', { from: tomorrow, to: tomorrow }).rows).toEqual([])
    })

    it('groups by day and by month', () => {
      const firstDay = today()
      paidBill()
      app.clock.advance(DAY)
      paidBill(spareTableId)
      const daily = runWide('DAILY_SALES')
      expect(daily.rows.map((r) => [r.date, r.bills, r.total])).toEqual([
        [firstDay, 1, 46700],
        [localDateString(app.clock.now), 1, 46700]
      ])
      expect(daily.totals).toMatchObject({ bills: 2, total: 93400 })
      const monthly = runWide('MONTHLY_SALES')
      expect(monthly.rows).toHaveLength(1)
      expect(monthly.rows[0]).toMatchObject({ month: '2026-01', bills: 2, total: 93400 })
    })
  })

  describe('items and categories', () => {
    it('ranks items by quantity', () => {
      paidBill()
      const result = run('ITEM_SALES')
      expect(result.rows.map((r) => [r.rank, r.item, r.quantity, r.net])).toEqual([
        [1, 'Butter Naan', 2, 12000],
        [2, 'Paneer Tikka', 1, 28000],
        [3, 'Soda', 1, 4000]
      ])
      expect(result.rows[0]).toMatchObject({ category: 'Food', average: 6000 })
      expect(result.rows.reduce((sum, r) => sum + Number(r.share), 0)).toBeGreaterThan(9990)
      expect(result.summary).toContainEqual({
        label: 'Best seller',
        value: 'Butter Naan',
        type: 'text'
      })
      expect(run('ITEM_SALES', { search: 'tikka' }).rows).toHaveLength(1)
      expect(run('ITEM_SALES', { categoryId: foodId }).rows).toHaveLength(3)
      expect(run('ITEM_SALES', { categoryId: 'other' }).rows).toHaveLength(0)
    })

    it('takes a bill discount off each item', () => {
      const { bill } = servedBill()
      const discounted = app.services.bills.applyDiscount(
        owner,
        applyDiscountInputSchema.parse({
          billId: bill.id,
          scope: 'BILL',
          type: 'PERCENTAGE',
          value: 1000,
          reason: 'Regular guest'
        })
      )
      app.services.bills.pay(
        owner,
        payBillInputSchema.parse({
          billId: bill.id,
          payments: [{ method: 'CASH', amount: discounted.grandTotal }]
        })
      )
      const result = run('ITEM_SALES')
      expect(result.totals).toMatchObject({ gross: 44000, discount: 4400, net: 39600 })
    })

    it('groups sales by category', () => {
      paidBill()
      const result = run('CATEGORY_SALES')
      expect(result.rows).toEqual([
        {
          category: 'Food',
          items: 3,
          quantity: 4,
          gross: 44000,
          discount: 0,
          net: 44000,
          share: 10000
        }
      ])
    })
  })

  describe('payments, tax and discounts', () => {
    it('lists payments and totals each method', () => {
      const bill = paidBill()
      const result = run('PAYMENTS')
      expect(result.rows.map((r) => [r.method, r.amount, r.reference]).sort()).toEqual([
        ['Cash', 20000, null],
        ['UPI', 26700, 'UTR 99']
      ])
      expect(result.summary).toContainEqual({ label: 'Cash received', value: 20000, type: 'money' })
      expect(result.summary).toContainEqual({ label: 'UPI received', value: 26700, type: 'money' })
      expect(result.summary).toContainEqual({ label: 'Received', value: 46700, type: 'money' })
      expect(run('PAYMENTS', { method: 'UPI' }).rows).toHaveLength(1)
      expect(run('PAYMENTS', { search: 'utr' }).rows).toHaveLength(1)
      expect(run('PAYMENTS', { search: bill.billNumber }).rows).toHaveLength(2)

      app.services.bills.refund(
        owner,
        refundBillInputSchema.parse({
          billId: bill.id,
          reason: 'Guest unhappy',
          lines: [{ method: 'CASH', amount: 5000 }]
        })
      )
      const after = run('PAYMENTS')
      expect(after.summary).toContainEqual({ label: 'Refunded', value: 5000, type: 'money' })
      expect(after.summary).toContainEqual({ label: 'Net received', value: 41700, type: 'money' })
      expect(run('PAYMENTS', { method: 'UPI' }).summary).toContainEqual({
        label: 'Refunded',
        value: 0,
        type: 'money'
      })
    })

    it('splits tax by rate', () => {
      paidBill()
      const result = run('TAX')
      expect(result.rows).toEqual([
        { rate: 500, taxable: 40000, cgst: 1000, sgst: 1000, igst: 0, tax: 2000 },
        { rate: 1800, taxable: 4000, cgst: 360, sgst: 360, igst: 0, tax: 720 }
      ])
      expect(result.totals).toMatchObject({ taxable: 44000, tax: 2720 })
    })

    it('lists discounts with who gave them and why', () => {
      const { bill } = servedBill()
      const discounted = app.services.bills.applyDiscount(
        owner,
        applyDiscountInputSchema.parse({
          billId: bill.id,
          scope: 'BILL',
          type: 'PERCENTAGE',
          value: 1000,
          reason: 'Regular guest'
        })
      )
      app.services.bills.pay(
        owner,
        payBillInputSchema.parse({
          billId: bill.id,
          payments: [{ method: 'CASH', amount: discounted.grandTotal }]
        })
      )
      const result = run('DISCOUNTS')
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({
        billNumber: bill.billNumber,
        scope: 'Whole bill',
        type: 'Percentage',
        given: '10%',
        amount: 4400,
        reason: 'Regular guest',
        staff: 'Olivia Owner'
      })
      expect(run('DISCOUNTS', { search: 'regular' }).rows).toHaveLength(1)
      expect(run('DISCOUNTS', { search: 'nothing' }).rows).toHaveLength(0)
    })
  })

  describe('staff, kitchen and cancellations', () => {
    it('adds up what each team member billed and cancelled', () => {
      paidBill()
      const second = servedBill(spareTableId)
      app.services.bills.cancel(owner, { id: second.bill.id, reason: 'Mistake' })
      const open = app.services.orders.create(
        owner,
        createOrderInputSchema.parse({
          type: 'TAKEAWAY',
          lines: [{ menuItemId: naan, quantity: 1 }]
        })
      )
      app.services.orders.cancel(
        owner,
        cancelOrderInputSchema.parse({ id: open.id, reason: 'Guest left' })
      )
      const result = runWide('STAFF_SALES')
      expect(result.rows).toEqual([
        {
          staff: 'Olivia Owner',
          bills: 1,
          total: 46700,
          discount: 0,
          refunded: 0,
          net: 46700,
          average: 46700,
          cancelledBills: 1,
          cancelledOrders: 1
        }
      ])
    })

    it('lists kitchen tickets with their items and times', () => {
      const { order } = servedBill()
      const result = runWide('KOT')
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows.reduce((sum, r) => sum + Number(r.quantity), 0)).toBe(4)
      expect(result.rows.every((r) => r.orderNumber === order.orderNumber)).toBe(true)
      expect(result.rows[0]).toMatchObject({ orderType: 'Dine-in', additional: 'No' })
      expect(runWide('KOT', { status: 'CANCELLED' }).rows).toEqual([])
      expect(runWide('KOT', { search: order.orderNumber }).rows.length).toBe(result.rows.length)
      expect(runWide('KOT', { orderType: 'DELIVERY' }).rows).toEqual([])
      expect(runWide('KOT', { status: 'NEW' }).filters).toEqual(['Status: New'])
    })

    it('lists cancelled orders and bills with the reason', () => {
      const open = newOrder()
      app.services.orders.cancel(
        owner,
        cancelOrderInputSchema.parse({ id: open.id, reason: 'Guest left' })
      )
      const withBill = servedBill(spareTableId)
      app.services.bills.cancel(owner, { id: withBill.bill.id, reason: 'Wrong table' })

      const orders = runWide('CANCELLED_ORDERS')
      expect(orders.rows).toHaveLength(1)
      expect(orders.rows[0]).toMatchObject({
        orderNumber: open.orderNumber,
        reason: 'Guest left',
        cancelledBy: 'Olivia Owner',
        table: 'T1'
      })
      expect(runWide('CANCELLED_ORDERS', { search: 'left' }).rows).toHaveLength(1)
      expect(runWide('CANCELLED_ORDERS', { search: 'wrong' }).rows).toHaveLength(0)

      const billsOut = runWide('CANCELLED_BILLS')
      expect(billsOut.rows).toHaveLength(1)
      expect(billsOut.rows[0]).toMatchObject({
        billNumber: withBill.bill.billNumber,
        total: withBill.bill.grandTotal,
        reason: 'Wrong table'
      })
      expect(runWide('CANCELLED_BILLS', { staffId: owner.userId }).rows).toHaveLength(1)
      expect(runWide('CANCELLED_BILLS', { staffId: 'x' }).rows).toHaveLength(0)
    })
  })

  describe('stock and purchasing', () => {
    it('shows stock on hand, its value and the movement in the period', () => {
      const paneer = stockItem('Paneer', {
        openingStock: 2000,
        unitCost: 30000,
        reorderLevel: 1000
      })
      app.services.inventory.stockIn(
        owner,
        stockInInputSchema.parse({ itemId: paneer.id, quantity: 3000, unitCost: 30000 })
      )
      app.services.inventory.wastage(
        owner,
        wastageInputSchema.parse({ itemId: paneer.id, quantity: 500, reason: 'Spoiled' })
      )
      stockItem('Salt', { openingStock: 0, reorderLevel: 500 })
      stockItem('Oil', { openingStock: 800, reorderLevel: 1000 })

      const result = runWide('INVENTORY')
      const byName = Object.fromEntries(result.rows.map((r) => [String(r.name), r]))
      expect(byName.Paneer).toMatchObject({
        unit: 'kg',
        onHand: 4500,
        value: 135000,
        received: 5000,
        used: 0,
        wasted: 500,
        status: 'In stock'
      })
      expect(byName.Salt).toMatchObject({ status: 'Out of stock' })
      expect(byName.Oil).toMatchObject({ status: 'Low stock' })
      expect(result.summary).toContainEqual({ label: 'Low stock', value: 1, type: 'int' })
      expect(runWide('INVENTORY', { status: 'LOW' }).rows.map((r) => r.name)).toEqual(['Oil'])
      expect(runWide('INVENTORY', { status: 'OUT' }).rows.map((r) => r.name)).toEqual(['Salt'])
      expect(runWide('INVENTORY', { search: 'pan' }).rows).toHaveLength(1)
    })

    it('lists received purchases with what is still owed, and the suppliers behind them', () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const make = (date: string, quantity: number) =>
        app.services.purchases.create(
          owner,
          createPurchaseInputSchema.parse({
            supplierId: dairy.id,
            purchaseDate: date,
            lines: [{ inventoryItemId: paneer.id, quantity, unitCost: 30000 }]
          })
        )
      const received = make(today(), 2000)
      app.services.purchases.receive(owner, received.id)
      app.services.purchases.recordPayment(
        owner,
        recordPaymentInputSchema.parse({ purchaseId: received.id, amount: 25000, method: 'CASH' })
      )
      make(today(), 1000) // a draft

      const result = run('PURCHASES')
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({
        purchaseNumber: received.purchaseNumber,
        supplier: 'Sharma Dairy',
        status: 'Received',
        total: 60000,
        paid: 25000,
        due: 35000
      })
      expect(result.totals).toMatchObject({ total: 60000, paid: 25000, due: 35000 })
      expect(run('PURCHASES', { status: 'DRAFT' }).rows).toHaveLength(1)
      expect(run('PURCHASES', { status: 'CANCELLED' }).rows).toHaveLength(0)
      expect(run('PURCHASES', { supplierId: 'other' }).rows).toHaveLength(0)
      expect(run('PURCHASES', { search: 'sharma' }).rows).toHaveLength(1)
      expect(run('PURCHASES', { supplierId: dairy.id }).filters).toEqual(['Supplier: Sharma Dairy'])

      const suppliers = runWide('SUPPLIERS')
      expect(suppliers.rows).toEqual([
        { name: 'Sharma Dairy', phone: null, purchases: 1, bought: 60000, paid: 25000, owed: 35000 }
      ])
      supplier('Quiet Traders')
      expect(runWide('SUPPLIERS').rows).toHaveLength(1)
    })
  })

  describe('money', () => {
    it('lists expenses without the voided ones', () => {
      const rent = expenseCategory('Rent')
      const gas = expenseCategory('Gas')
      expense(rent.id, 7000, { payee: 'Landlord' })
      expense(gas.id, 9000, { method: 'UPI', payee: 'Gas Agency', reference: 'UTR 7' })
      const wrong = expense(gas.id, 3000)
      app.services.expenses.voidExpense(owner, { id: wrong.id, reason: 'Typo' })

      const result = runWide('EXPENSES')
      expect(result.rows).toHaveLength(2)
      expect(result.totals).toMatchObject({ amount: 16000 })
      expect(result.summary).toContainEqual({ label: 'Paid in cash', value: 7000, type: 'money' })
      expect(result.summary).toContainEqual({
        label: 'Biggest category',
        value: 'Gas',
        type: 'text'
      })
      expect(runWide('EXPENSES', { method: 'UPI' }).rows).toHaveLength(1)
      expect(runWide('EXPENSES', { expenseCategoryId: rent.id }).rows).toHaveLength(1)
      expect(runWide('EXPENSES', { search: 'agency' }).rows).toHaveLength(1)
      expect(runWide('EXPENSES', { search: 'utr 7' }).rows).toHaveLength(1)
      expect(runWide('EXPENSES', { expenseCategoryId: gas.id }).filters).toEqual(['Category: Gas'])
    })

    it('lists day closings, marking the reopened ones', () => {
      const closing = app.services.dayClosing.close(
        owner,
        closeDayInputSchema.parse({ date: today(), countedCash: 0 })
      )
      const closed = run('DAY_CLOSINGS')
      expect(closed.rows).toHaveLength(1)
      expect(closed.rows[0]).toMatchObject({
        businessDate: today(),
        status: 'In force',
        expectedCash: 0,
        countedCash: 0,
        variance: 0,
        closedBy: 'Olivia Owner'
      })

      app.services.dayClosing.reopen(
        owner,
        reopenDayInputSchema.parse({ id: closing.id, reason: 'Missed a bill' })
      )
      const reopened = run('DAY_CLOSINGS')
      expect(reopened.rows[0]).toMatchObject({ status: 'Reopened', reopenReason: 'Missed a bill' })
      expect(run('DAY_CLOSINGS', { status: 'STANDING' }).rows).toHaveLength(0)
      expect(run('DAY_CLOSINGS', { status: 'REOPENED' }).rows).toHaveLength(1)
    })
  })

  describe('files and pages', () => {
    it('writes a spreadsheet-safe CSV', () => {
      const rent = expenseCategory('Rent')
      expense(rent.id, 123456, { payee: '=HYPERLINK("x")', notes: 'a, "b"\nc' })
      const file = app.services.reports.exportCsv(
        reportFilterSchema.parse({ kind: 'EXPENSES', ...wide() })
      )
      expect(file.filename).toMatch(/^expense-report_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/)
      expect(file.content.startsWith('\uFEFF')).toBe(true)
      const lines = file.content.slice(1).split('\r\n')
      expect(lines[0]).toBe(
        'Spent at,Number,Category,Payee,Paid by,Reference,Amount,Notes,Recorded by'
      )
      // The newline in the notes keeps the row open, so look at the whole body.
      const body = file.content
      expect(body).toContain("'=HYPERLINK(")
      expect(body).toContain('"a, ""b""\nc"')
      expect(body).toContain(',1234.56,')
      expect(body.trimEnd().split('\r\n').at(-1)).toBe('Total,,,,,,1234.56,,')
    })

    it('writes plain decimals for quantities and percentages', () => {
      paidBill()
      const csv = reportToCsv(run('ITEM_SALES'))
      expect(csv).toContain('1,Butter Naan,,Food,2,120.00,0.00,120.00,')
      expect(csv).toContain(',27.27,')
    })

    it('draws a printable page that escapes what it shows', () => {
      const rent = expenseCategory('Rent')
      expense(rent.id, 150000, { payee: '<script>alert(1)</script>' })
      const result = runWide('EXPENSES')
      const html = reportToHtml(result, 'Tandoori & Co')
      expect(html).toContain('<h1>Tandoori &amp; Co</h1>')
      expect(html).toContain('Expense report')
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(html).not.toContain('<script>')
      expect(html).toContain('\u20B91,500.00')
      expect(html).toContain('<tfoot>')

      const page = app.services.reports.renderPage(
        reportFilterSchema.parse({ kind: 'EXPENSES', ...wide() })
      )
      expect(page.html).toContain('Test Kitchen')
      expect(page.stem).toMatch(/^expense-report_/)
    })

    it('says so when there is nothing to show', () => {
      const page = app.services.reports.renderPage(
        reportFilterSchema.parse({ kind: 'SALES', from: today(), to: today() })
      )
      expect(page.html).toContain('Nothing to show for this period.')
      expect(page.html).not.toContain('<tfoot>')
    })
  })

  describe('options', () => {
    it('lists what the filters choose from', () => {
      expenseCategory('Rent')
      supplier()
      const options = app.services.reports.options()
      expect(options.staff.map((s) => s.name)).toContain('Olivia Owner')
      expect(options.categories.map((c) => c.name)).toEqual(['Food'])
      expect(options.expenseCategories.map((c) => c.name)).toEqual(['Rent'])
      expect(options.suppliers.map((s) => s.name)).toEqual(['Sharma Dairy'])
    })
  })
})
