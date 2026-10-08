import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateBillInputSchema, payBillInputSchema, refundBillInputSchema } from '@shared/billing'
import { recordCashEntryInputSchema } from '@shared/cash'
import {
  closeDayInputSchema,
  dayClosingFilterSchema,
  reopenDayInputSchema
} from '@shared/day-closing'
import { createExpenseCategoryInputSchema, createExpenseInputSchema } from '@shared/expenses'
import { createInventoryItemInputSchema } from '@shared/inventory'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import { createTaxCategoryInputSchema } from '@shared/menu'
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
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, cashEntries, dayClosings } from '@main/db/schema'
import { localDateString } from '@main/finance/dates'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

const DAY = 24 * 60 * 60 * 1000

describe('day closing', () => {
  let app: TestApp
  let owner: AuthContext
  let tableId: string
  let spareTableId: string
  let naan: string // 60.00 at 5%
  let tikka: string // 280.00 at 5%
  let soda: string // 40.00 at 18%

  const today = () => localDateString(app.clock.now)
  const close = (input: Record<string, unknown>) =>
    app.services.dayClosing.close(owner, closeDayInputSchema.parse(input))
  const entry = (input: Record<string, unknown>) =>
    app.services.cash.recordEntry(owner, recordCashEntryInputSchema.parse(input))
  const category = () =>
    app.services.expenses.createCategory(
      owner,
      createExpenseCategoryInputSchema.parse({ name: 'Rent' })
    )
  const expense = (categoryId: string, amount: number, extra: Record<string, unknown> = {}) =>
    app.services.expenses.create(
      owner,
      createExpenseInputSchema.parse({ categoryId, amount, method: 'CASH', ...extra })
    )
  const sqlError = (statement: string, ...params: unknown[]): string => {
    try {
      app.handle.sqlite.prepare(statement).run(...params)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    return ''
  }
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
  /** Orders are stamped with real time; move one onto the test clock. */
  const openedAt = (orderId: string, at: number) =>
    app.handle.sqlite.prepare('update orders set created_at = ? where id = ?').run(at, orderId)
  /** A bill of 467.00, paid 200.00 in cash and 267.00 by UPI. */
  const paidBill = () => {
    const order = newOrder()
    app.services.orders.sendAndGetKots(owner, order.id)
    app.services.orders.setStatus(
      owner,
      setOrderStatusInputSchema.parse({ id: order.id, status: 'SERVED' })
    )
    const bill = app.services.bills.generate(
      owner,
      generateBillInputSchema.parse({ orderId: order.id })
    )
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
  const actions = (): string[] =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .all()
      .map((row) => row.action)
      .filter((action) => action.startsWith('day.'))

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
    spareTableId = app.services.tables.create(
      owner,
      createTableInputSchema.parse({ areaId: hall.id, tableNumber: 'T2', capacity: 4, type: 'AC' })
    ).id
    const food = app.services.categories.create(
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
          categoryId: food,
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

  describe('the day as it stands', () => {
    it('starts with an open, empty day that can be closed', () => {
      const overview = app.services.dayClosing.overview()
      expect(overview).toEqual({
        today: today(),
        todayClosed: false,
        lastClosed: null,
        unclosedDays: []
      })
      const status = app.services.dayClosing.status()
      expect(status).toMatchObject({
        date: today(),
        isToday: true,
        closing: null,
        blockers: [],
        canClose: true
      })
      expect(status.summary).toMatchObject({
        sales: { bills: 0, total: 0 },
        byOrderType: [],
        collections: [],
        refunds: [],
        expenses: [],
        supplierPayments: [],
        cash: { opening: 0, in: 0, out: 0, expected: 0 }
      })
    })

    it('adds up what the day took and paid out', () => {
      entry({ kind: 'OPENING_FLOAT', amount: 100000 })
      paidBill()
      app.services.bills.refund(
        owner,
        refundBillInputSchema.parse({
          billId: app.services.bills.list({})[0]?.id ?? '',
          reason: 'Guest unhappy',
          lines: [{ method: 'CASH', amount: 5000 }]
        })
      )
      const rent = category()
      expense(rent.id, 7000)
      expense(rent.id, 9000, { method: 'UPI' })
      const wrong = expense(rent.id, 3000)
      app.services.expenses.voidExpense(owner, { id: wrong.id, reason: 'Typo' })

      const { summary } = app.services.dayClosing.status()
      expect(summary.sales).toMatchObject({ bills: 1, total: 46700 })
      expect(summary.sales.subtotal).toBeGreaterThan(0)
      expect(summary.byOrderType).toEqual([{ type: 'DINE_IN', bills: 1, total: 46700 }])
      expect(summary.collections).toEqual([
        { method: 'CASH', count: 1, amount: 20000 },
        { method: 'UPI', count: 1, amount: 26700 }
      ])
      expect(summary.refunds).toEqual([{ method: 'CASH', count: 1, amount: 5000 }])
      expect(summary.expenses).toEqual([
        { method: 'CASH', count: 1, amount: 7000 },
        { method: 'UPI', count: 1, amount: 9000 }
      ])
      // 1000.00 float + 200.00 sale - 50.00 refund - 70.00 expense
      expect(summary.cash).toEqual({ opening: 0, in: 120000, out: 12000, expected: 108000 })
    })

    it('counts supplier payments', () => {
      const dairy = app.services.suppliers.create(
        owner,
        createSupplierInputSchema.parse({ name: 'Sharma Dairy' })
      )
      const paneer = app.services.inventory.create(
        owner,
        createInventoryItemInputSchema.parse({ name: 'Paneer', unit: 'KG' })
      )
      const purchase = app.services.purchases.create(
        owner,
        createPurchaseInputSchema.parse({
          supplierId: dairy.id,
          purchaseDate: today(),
          lines: [{ inventoryItemId: paneer.id, quantity: 2000, unitCost: 30000 }]
        })
      )
      app.services.purchases.receive(owner, purchase.id)
      app.services.purchases.recordPayment(
        owner,
        recordPaymentInputSchema.parse({ purchaseId: purchase.id, amount: 25000, method: 'CASH' })
      )
      const { summary } = app.services.dayClosing.status()
      expect(summary.supplierPayments).toEqual([{ method: 'CASH', count: 1, amount: 25000 }])
      expect(summary.cash.out).toBe(25000)
    })

    it('keeps an open order from being closed over', () => {
      openedAt(newOrder().id, app.clock.now)
      const status = app.services.dayClosing.status()
      expect(status.canClose).toBe(false)
      expect(status.blockers).toEqual([
        '1 order is still open. Settle or cancel it before closing the day.'
      ])
    })

    it('does not let a day be closed with an order still open', async () => {
      const order = newOrder()
      openedAt(order.id, app.clock.now)
      expect(await failureCode(() => close({ date: today(), countedCash: 0 }))).toBe('CONFLICT')
      app.services.orders.cancel(
        owner,
        cancelOrderInputSchema.parse({ id: order.id, reason: 'Guest left' })
      )
      expect(close({ date: today(), countedCash: 0 }).variance).toBe(0)
    })

    it('refuses a future day', async () => {
      const tomorrow = localDateString(app.clock.now + 2 * DAY)
      expect(await failureCode(() => close({ date: tomorrow, countedCash: 0 }))).toBe(
        'VALIDATION_ERROR'
      )
      expect(app.services.dayClosing.status({ date: tomorrow })).toMatchObject({
        canClose: false,
        blockers: ['This day has not begun yet.']
      })
    })
  })

  describe('closing', () => {
    it('freezes the day when the count matches the book', () => {
      entry({ kind: 'OPENING_FLOAT', amount: 100000 })
      paidBill()
      const status = app.services.dayClosing.status()
      const closing = close({
        date: today(),
        countedCash: 120000,
        denominations: [
          { value: 50000, count: 2 },
          { value: 20000, count: 1 }
        ],
        notes: '  End of day  '
      })
      expect(closing).toMatchObject({
        closingNumber: 'TK-DAY-000001',
        date: today(),
        expectedCash: 120000,
        countedCash: 120000,
        variance: 0,
        notes: 'End of day',
        adjustmentEntryId: null,
        closedBy: 'Olivia Owner',
        reopenedAt: null
      })
      expect(closing.denominations).toEqual([
        { value: 50000, count: 2 },
        { value: 20000, count: 1 }
      ])
      expect(closing.summary).toEqual(status.summary)
      expect(app.services.cash.listEntries({}).map((row) => row.kind)).toEqual(['OPENING_FLOAT'])

      const after = app.services.dayClosing.status()
      expect(after).toMatchObject({ canClose: false, blockers: [] })
      expect(after.closing?.id).toBe(closing.id)
      expect(app.services.dayClosing.overview()).toMatchObject({
        todayClosed: true,
        lastClosed: {
          id: closing.id,
          billCount: 1,
          salesTotal: 46700,
          countedCash: 120000,
          variance: 0
        }
      })
      expect(actions()).toEqual(['day.closed'])
    })

    it('needs a note when the cash is short and makes the book agree with the count', async () => {
      entry({ kind: 'OPENING_FLOAT', amount: 100000 })
      expect(await failureCode(() => close({ date: today(), countedCash: 99000 }))).toBe(
        'VALIDATION_ERROR'
      )
      const closing = close({ date: today(), countedCash: 99000, notes: 'Change given wrongly' })
      expect(closing).toMatchObject({ expectedCash: 100000, variance: -1000 })
      const [adjustment] = app.services.cash
        .listEntries({})
        .filter((row) => row.kind !== 'OPENING_FLOAT')
      expect(adjustment).toMatchObject({
        id: closing.adjustmentEntryId,
        kind: 'COUNT_SHORT',
        direction: 'OUT',
        amount: 1000
      })
      expect(app.services.cash.summary().balance).toBe(99000)
      expect(
        app.services.cash.book().rows.find((row) => row.source === 'ENTRY' && row.amount === 1000)
      ).toMatchObject({ direction: 'OUT' })
    })

    it('puts extra cash in the book too', () => {
      entry({ kind: 'OPENING_FLOAT', amount: 100000 })
      const closing = close({ date: today(), countedCash: 100500, notes: 'Tip left in the drawer' })
      expect(closing.variance).toBe(500)
      expect(app.services.cash.listEntries({})[0]).toMatchObject({
        kind: 'COUNT_EXCESS',
        direction: 'IN',
        amount: 500
      })
      expect(app.services.cash.summary().balance).toBe(100500)
    })

    it('closes a day that took no cash with nothing in the drawer', () => {
      expect(close({ date: today(), countedCash: 0 })).toMatchObject({ variance: 0 })
    })

    it('refuses a day that is already closed', async () => {
      close({ date: today(), countedCash: 0 })
      expect(await failureCode(() => close({ date: today(), countedCash: 0 }))).toBe('CONFLICT')
    })

    it('checks the count by note and coin adds up', () => {
      const parse = (denominations: unknown, countedCash = 70000) =>
        closeDayInputSchema.safeParse({ date: today(), countedCash, denominations })
      expect(
        parse([
          { value: 50000, count: 1 },
          { value: 20000, count: 1 }
        ]).success
      ).toBe(true)
      expect(parse([{ value: 50000, count: 1 }]).success).toBe(false)
      expect(
        parse(
          [
            { value: 50000, count: 1 },
            { value: 50000, count: 1 }
          ],
          100000
        ).success
      ).toBe(false)
      expect(parse([{ value: 100, count: 0 }], 0).success).toBe(false)
      expect(closeDayInputSchema.safeParse({ date: today(), countedCash: -1 }).success).toBe(false)
      expect(closeDayInputSchema.safeParse({ date: '2026-02-30', countedCash: 0 }).success).toBe(
        false
      )
    })

    it('keeps the count kinds for closing: they cannot be recorded by hand', () => {
      expect(
        recordCashEntryInputSchema.safeParse({ kind: 'COUNT_SHORT', amount: 100 }).success
      ).toBe(false)
      expect(
        recordCashEntryInputSchema.safeParse({ kind: 'COUNT_EXCESS', amount: 100 }).success
      ).toBe(false)
    })
  })

  describe('earlier days', () => {
    it('lists days with activity that nobody closed, and closes one in the past', () => {
      entry({ kind: 'OPENING_FLOAT', amount: 100000 })
      paidBill()
      const first = today()
      app.clock.advance(2 * DAY)
      expect(app.services.dayClosing.overview().unclosedDays).toEqual([first])

      const closing = close({ date: first, countedCash: 119000, notes: 'Short by ten' })
      expect(closing).toMatchObject({ date: first, expectedCash: 120000, variance: -1000 })
      // The adjustment belongs to the day it closed, not to today.
      const adjustment = app.handle.db
        .select()
        .from(cashEntries)
        .where(eq(cashEntries.id, closing.adjustmentEntryId ?? ''))
        .get()
      expect(localDateString(adjustment?.occurredAt ?? 0)).toBe(first)
      expect(app.services.dayClosing.overview()).toMatchObject({
        todayClosed: false,
        unclosedDays: [],
        lastClosed: { date: first }
      })
      expect(app.services.cash.book(undefined).openingBalance).toBe(119000)
    })

    it('keeps the lock on the right day', async () => {
      const rent = category()
      const first = today()
      app.clock.advance(DAY)
      close({ date: first, countedCash: 0 })
      // Today is still open.
      expect(expense(rent.id, 1000).amount).toBe(1000)
      expect(entry({ kind: 'CASH_ADDED', amount: 1000 }).amount).toBe(1000)
      // The closed day takes nothing new.
      const back = new Date(app.clock.now - DAY).toISOString()
      expect(await failureCode(() => expense(rent.id, 1000, { spentAt: back }))).toBe('CONFLICT')
      expect(
        await failureCode(() => entry({ kind: 'CASH_ADDED', amount: 1, occurredAt: back }))
      ).toBe('CONFLICT')
    })

    it('does not count an order of a later day against an earlier one', () => {
      const first = today()
      app.clock.advance(2 * DAY)
      openedAt(newOrder().id, app.clock.now)
      expect(app.services.dayClosing.status({ date: first }).canClose).toBe(true)
      // The order was opened after that day ended, so it is only in the way of closing today.
      expect(app.services.dayClosing.status().canClose).toBe(false)
    })
  })

  describe('the lock on a closed day', () => {
    it('refuses new money records while it stands', async () => {
      const rent = category()
      const paid = paidBill()
      const spent = expense(rent.id, 1000)
      const dairy = app.services.suppliers.create(
        owner,
        createSupplierInputSchema.parse({ name: 'Sharma Dairy' })
      )
      const paneer = app.services.inventory.create(
        owner,
        createInventoryItemInputSchema.parse({ name: 'Paneer', unit: 'KG' })
      )
      const purchase = app.services.purchases.create(
        owner,
        createPurchaseInputSchema.parse({
          supplierId: dairy.id,
          purchaseDate: today(),
          lines: [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 30000 }]
        })
      )
      app.services.purchases.receive(owner, purchase.id)
      const payment = app.services.purchases.recordPayment(
        owner,
        recordPaymentInputSchema.parse({ purchaseId: purchase.id, amount: 5000, method: 'CASH' })
      ).payments[0]

      close({ date: today(), countedCash: 14000 - 1000 + 2000, notes: 'Counted' })

      const refusal = async (call: () => unknown): Promise<string | null> => {
        try {
          await call()
          return null
        } catch (error) {
          return (error as Error).message
        }
      }
      const closed =
        /^Today \(\d{1,2} [A-Z][a-z]{2} \d{4}\) is closed\. Ask a manager to reopen it to /

      expect(await refusal(() => newOrder(spareTableId))).toMatch(closed)
      expect(await refusal(() => expense(rent.id, 100))).toMatch(closed)
      expect(await refusal(() => entry({ kind: 'CASH_ADDED', amount: 100 }))).toMatch(closed)
      expect(
        await refusal(() => app.services.expenses.voidExpense(owner, { id: spent.id, reason: 'x' }))
      ).toMatch(closed)
      expect(
        await refusal(() =>
          app.services.bills.refund(
            owner,
            refundBillInputSchema.parse({
              billId: paid.id,
              reason: 'Late complaint',
              lines: [{ method: 'CASH', amount: 1000 }]
            })
          )
        )
      ).toMatch(closed)
      expect(
        await refusal(() =>
          app.services.purchases.recordPayment(
            owner,
            recordPaymentInputSchema.parse({
              purchaseId: purchase.id,
              amount: 1000,
              method: 'CASH'
            })
          )
        )
      ).toMatch(closed)
      expect(
        await refusal(() =>
          app.services.purchases.voidPayment(owner, { id: payment?.id ?? '', reason: 'x' })
        )
      ).toMatch(closed)
    })

    it('refuses a payment on a bill when the day is closed', async () => {
      const order = newOrder()
      app.services.orders.sendAndGetKots(owner, order.id)
      app.services.orders.setStatus(
        owner,
        setOrderStatusInputSchema.parse({ id: order.id, status: 'SERVED' })
      )
      const bill = app.services.bills.generate(
        owner,
        generateBillInputSchema.parse({ orderId: order.id })
      )
      // An order opened after the day ends does not hold the day open.
      openedAt(order.id, app.clock.now + DAY)
      close({ date: today(), countedCash: 0 })
      expect(
        await failureCode(() =>
          app.services.bills.pay(
            owner,
            payBillInputSchema.parse({
              billId: bill.id,
              payments: [{ method: 'CASH', amount: 46700 }]
            })
          )
        )
      ).toBe('CONFLICT')
    })

    it('keeps the count entry of a closed day from being voided by hand', async () => {
      entry({ kind: 'OPENING_FLOAT', amount: 100000 })
      const closing = close({ date: today(), countedCash: 99000, notes: 'Short' })
      expect(
        await failureCode(() =>
          app.services.cash.voidEntry(owner, { id: closing.adjustmentEntryId ?? '', reason: 'x' })
        )
      ).toBe('CONFLICT')
    })
  })

  describe('reopening', () => {
    it('lifts the lock, voids the count entry and keeps the closing on record', async () => {
      entry({ kind: 'OPENING_FLOAT', amount: 100000 })
      const closing = close({ date: today(), countedCash: 99000, notes: 'Short' })
      expect(app.services.cash.summary().balance).toBe(99000)

      const reopened = app.services.dayClosing.reopen(
        owner,
        reopenDayInputSchema.parse({ id: closing.id, reason: '  Forgot an expense  ' })
      )
      expect(reopened).toMatchObject({
        id: closing.id,
        reopenedBy: 'Olivia Owner',
        reopenReason: 'Forgot an expense'
      })
      expect(reopened.reopenedAt).not.toBeNull()
      expect(app.services.cash.summary().balance).toBe(100000)
      expect(
        app.services.cash
          .listEntries({ includeVoided: true })
          .find((row) => row.kind === 'COUNT_SHORT')
      ).toMatchObject({
        voidedBy: 'Olivia Owner',
        voidReason: `Day ${today()} reopened`
      })

      expect(app.services.dayClosing.overview()).toMatchObject({
        todayClosed: false,
        lastClosed: null
      })
      expect(app.services.dayClosing.status()).toMatchObject({ closing: null, canClose: true })
      const rent = category()
      expect(expense(rent.id, 500).amount).toBe(500)

      // Close again: a new closing with its own number.
      const again = close({ date: today(), countedCash: 99500 })
      expect(again).toMatchObject({ closingNumber: 'TK-DAY-000002', variance: 0 })
      expect(again.id).not.toBe(closing.id)

      const history = (includeReopened: boolean) =>
        app.services.dayClosing.list(dayClosingFilterSchema.parse({ includeReopened }))
      expect(history(false).map((row) => row.id)).toEqual([again.id])
      expect(
        history(true)
          .map((row) => row.closingNumber)
          .sort()
      ).toEqual(['TK-DAY-000001', 'TK-DAY-000002'])
      expect(app.services.dayClosing.get(closing.id).reopenedAt).not.toBeNull()
      expect(actions().sort()).toEqual(['day.closed', 'day.closed', 'day.reopened'])

      // It cannot be reopened twice.
      expect(
        await failureCode(() =>
          app.services.dayClosing.reopen(owner, { id: closing.id, reason: 'Again' })
        )
      ).toBe('CONFLICT')
    })

    it('reopens only the latest closed day', async () => {
      const first = today()
      app.clock.advance(DAY)
      const earlier = close({ date: first, countedCash: 0 })
      const later = close({ date: today(), countedCash: 0 })
      expect(
        await failureCode(() =>
          app.services.dayClosing.reopen(owner, { id: earlier.id, reason: 'Fix it' })
        )
      ).toBe('CONFLICT')
      app.services.dayClosing.reopen(owner, { id: later.id, reason: 'Fix it' })
      expect(
        app.services.dayClosing.reopen(owner, { id: earlier.id, reason: 'Fix it' }).reopenedAt
      ).not.toBeNull()
    })

    it('says a missing closing is missing', async () => {
      expect(
        await failureCode(() =>
          app.services.dayClosing.reopen(owner, {
            id: '00000000-0000-4000-8000-000000000000',
            reason: 'x'
          })
        )
      ).toBe('NOT_FOUND')
      expect(
        await failureCode(() => app.services.dayClosing.get('00000000-0000-4000-8000-000000000000'))
      ).toBe('NOT_FOUND')
    })
  })

  describe('the history', () => {
    it('lists the newest day first and filters by date', () => {
      const first = today()
      close({ date: first, countedCash: 0 })
      app.clock.advance(DAY)
      const second = today()
      close({ date: second, countedCash: 0 })
      const all = app.services.dayClosing.list({})
      expect(all.map((row) => row.date)).toEqual([second, first])
      expect(app.services.dayClosing.list({ from: second }).map((row) => row.date)).toEqual([
        second
      ])
      expect(app.services.dayClosing.list({ to: first }).map((row) => row.date)).toEqual([first])
      expect(app.services.dayClosing.list({ limit: 1 })).toHaveLength(1)
    })
  })

  describe('the database guards', () => {
    it('never changes or deletes a closing, and lets a day be reopened once', () => {
      const closing = close({ date: today(), countedCash: 0 })
      expect(
        sqlError('update day_closings set counted_cash = 5, variance = 5 where id = ?', closing.id)
      ).toContain('cannot be changed')
      expect(
        sqlError("update day_closings set business_date = '2020-01-01' where id = ?", closing.id)
      ).toContain('cannot be changed')
      expect(sqlError("update day_closings set summary = '{}' where id = ?", closing.id)).toContain(
        'cannot be changed'
      )
      expect(sqlError('delete from day_closings where id = ?', closing.id)).toContain(
        'cannot be deleted'
      )
      app.services.dayClosing.reopen(owner, { id: closing.id, reason: 'Fix' })
      expect(
        sqlError(
          "update day_closings set reopened_at = 1, reopen_reason = 'x' where id = ?",
          closing.id
        )
      ).toContain('already reopened')
    })

    it('allows only one standing closing per day, and a count that fits the figures', () => {
      const closing = close({ date: today(), countedCash: 0 })
      const row = app.handle.db
        .select()
        .from(dayClosings)
        .where(eq(dayClosings.id, closing.id))
        .get()
      expect(row).toBeDefined()
      expect(
        sqlError(
          `insert into day_closings (id, created_at, updated_at, restaurant_id, closing_number, business_date, summary, expected_cash, counted_cash, variance, denominations, closed_at, closed_by)
           select 'x1', created_at, updated_at, restaurant_id, 'TK-DAY-999999', business_date, summary, 0, 0, 0, '[]', closed_at, closed_by from day_closings where id = ?`,
          closing.id
        )
      ).toContain('UNIQUE')
      expect(
        sqlError(
          `insert into day_closings (id, created_at, updated_at, restaurant_id, closing_number, business_date, summary, expected_cash, counted_cash, variance, denominations, closed_at, closed_by)
           select 'x2', created_at, updated_at, restaurant_id, 'TK-DAY-999998', '2020-01-01', summary, 0, 0, 5, '[]', closed_at, closed_by from day_closings where id = ?`,
          closing.id
        )
      ).toContain('CHECK')
    })
  })
})
