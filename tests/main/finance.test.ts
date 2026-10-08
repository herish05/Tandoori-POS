import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateBillInputSchema, payBillInputSchema, refundBillInputSchema } from '@shared/billing'
import {
  cashBookFilterSchema,
  cashEntryFilterSchema,
  recordCashEntryInputSchema,
  voidCashEntryInputSchema,
  type RecordCashEntryInput
} from '@shared/cash'
import {
  createExpenseCategoryInputSchema,
  createExpenseInputSchema,
  expenseFilterSchema,
  expenseSummaryFilterSchema,
  updateExpenseCategoryInputSchema,
  updateExpenseInputSchema,
  voidExpenseInputSchema,
  type Expense,
  type ExpenseCategory
} from '@shared/expenses'
import { createInventoryItemInputSchema } from '@shared/inventory'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import { createTaxCategoryInputSchema } from '@shared/menu'
import { createOrderInputSchema, setOrderStatusInputSchema } from '@shared/orders'
import {
  createPurchaseInputSchema,
  createSupplierInputSchema,
  recordPaymentInputSchema
} from '@shared/purchasing'
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, cashEntries, expenses } from '@main/db/schema'
import { localDateString } from '@main/finance/dates'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

const DAY = 24 * 60 * 60 * 1000

describe('expenses', () => {
  let app: TestApp
  let owner: AuthContext

  const category = (name = 'Rent', description?: string): ExpenseCategory =>
    app.services.expenses.createCategory(
      owner,
      createExpenseCategoryInputSchema.parse({ name, description })
    )
  const spend = (
    categoryId: string,
    amount: number,
    extra: Record<string, unknown> = {}
  ): Expense =>
    app.services.expenses.create(
      owner,
      createExpenseInputSchema.parse({ categoryId, amount, method: 'CASH', ...extra })
    )
  const actions = (): string[] =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .all()
      .map((row) => row.action)
      .filter((action) => action.startsWith('expense'))
      .sort()
  const sqlError = (statement: string, ...params: unknown[]): string => {
    try {
      app.handle.sqlite.prepare(statement).run(...params)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    return ''
  }

  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('categories', () => {
    it('creates, renames and lists them by name', () => {
      const rent = category('Rent', ' Shop rent ')
      expect(rent).toMatchObject({
        name: 'Rent',
        description: 'Shop rent',
        isActive: true,
        expenseCount: 0
      })
      category('Gas')
      const renamed = app.services.expenses.updateCategory(
        owner,
        updateExpenseCategoryInputSchema.parse({ id: rent.id, name: 'Shop rent' })
      )
      expect(renamed).toMatchObject({ name: 'Shop rent', description: null })
      expect(app.services.expenses.listCategories({}).map((row) => row.name)).toEqual([
        'Gas',
        'Shop rent'
      ])
    })

    it('refuses a name already taken, whatever the case', async () => {
      const rent = category('Rent')
      expect(await failureCode(() => category('rent'))).toBe('CONFLICT')
      const gas = category('Gas')
      expect(
        await failureCode(() =>
          app.services.expenses.updateCategory(
            owner,
            updateExpenseCategoryInputSchema.parse({ id: gas.id, name: 'RENT' })
          )
        )
      ).toBe('CONFLICT')
      // Keeping its own name is fine.
      expect(
        app.services.expenses.updateCategory(
          owner,
          updateExpenseCategoryInputSchema.parse({ id: rent.id, name: 'Rent', description: 'x' })
        ).description
      ).toBe('x')
    })

    it('refuses bad input', () => {
      expect(createExpenseCategoryInputSchema.safeParse({ name: ' ' }).success).toBe(false)
      expect(createExpenseCategoryInputSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(
        false
      )
    })

    it('hides deactivated categories unless asked', () => {
      const rent = category('Rent')
      category('Gas')
      const off = app.services.expenses.setCategoryActive(owner, {
        id: rent.id,
        isActive: false
      })
      expect(off.isActive).toBe(false)
      expect(app.services.expenses.listCategories({}).map((row) => row.name)).toEqual(['Gas'])
      expect(
        app.services.expenses.listCategories({ includeInactive: true }).map((row) => row.name)
      ).toEqual(['Gas', 'Rent'])
      app.services.expenses.setCategoryActive(owner, { id: rent.id, isActive: true })
      expect(app.services.expenses.listCategories({})).toHaveLength(2)
    })

    it('deletes an unused category but not one with expenses', async () => {
      const used = category('Rent')
      const unused = category('Gas')
      spend(used.id, 1000)
      expect(await failureCode(() => app.services.expenses.deleteCategory(owner, used.id))).toBe(
        'CONFLICT'
      )
      expect(app.services.expenses.deleteCategory(owner, unused.id)).toBeNull()
      expect(app.services.expenses.listCategories({ includeInactive: true })).toHaveLength(1)
      expect(await failureCode(() => app.services.expenses.deleteCategory(owner, unused.id))).toBe(
        'NOT_FOUND'
      )
      // The name can be used again once the old category is gone.
      expect(category('Gas').name).toBe('Gas')
    })

    it('counts the expenses in each category', () => {
      const rent = category('Rent')
      spend(rent.id, 1000)
      const second = spend(rent.id, 2000)
      app.services.expenses.voidExpense(
        owner,
        voidExpenseInputSchema.parse({ id: second.id, reason: 'Duplicate' })
      )
      expect(app.services.expenses.listCategories({})[0]?.expenseCount).toBe(2)
    })
  })

  describe('recording expenses', () => {
    it('records an expense with its number, author and tidy text', () => {
      const rent = category('Rent')
      const created = spend(rent.id, 1500000, {
        method: 'BANK',
        payee: ' Mr Gupta ',
        reference: 'NEFT 123',
        notes: ''
      })
      expect(created).toMatchObject({
        expenseNumber: 'TK-EXP-000001',
        categoryName: 'Rent',
        amount: 1500000,
        method: 'BANK',
        payee: 'Mr Gupta',
        reference: 'NEFT 123',
        notes: null,
        recordedBy: 'Olivia Owner',
        voidedAt: null
      })
      expect(new Date(created.spentAt).getTime()).toBe(app.clock.now)
      expect(spend(rent.id, 100).expenseNumber).toBe('TK-EXP-000002')
    })

    it('refuses bad amounts, methods and dates', async () => {
      const rent = category('Rent')
      const bad = [
        { amount: 0 },
        { amount: -5 },
        { amount: 10.5 },
        { amount: 1_000_000_001 },
        { amount: 100, method: 'BARTER' },
        { amount: 100, categoryId: 'nope' }
      ]
      for (const extra of bad) {
        expect(
          createExpenseInputSchema.safeParse({
            categoryId: rent.id,
            method: 'CASH',
            ...extra
          }).success
        ).toBe(false)
      }
      expect(
        await failureCode(() =>
          spend(rent.id, 100, { spentAt: new Date(app.clock.now + DAY).toISOString() })
        )
      ).toBe('VALIDATION_ERROR')
      // A few minutes of clock drift is tolerated.
      expect(
        spend(rent.id, 100, { spentAt: new Date(app.clock.now + 60_000).toISOString() }).amount
      ).toBe(100)
    })

    it('refuses a deactivated or missing category', async () => {
      const rent = category('Rent')
      app.services.expenses.setCategoryActive(owner, { id: rent.id, isActive: false })
      expect(await failureCode(() => spend(rent.id, 100))).toBe('VALIDATION_ERROR')
      expect(await failureCode(() => spend('00000000-0000-4000-8000-000000000000', 100))).toBe(
        'NOT_FOUND'
      )
    })

    it('corrects an expense and keeps its number', async () => {
      const rent = category('Rent')
      const gas = category('Gas')
      const created = spend(rent.id, 1000)
      const updated = app.services.expenses.update(
        owner,
        updateExpenseInputSchema.parse({
          id: created.id,
          categoryId: gas.id,
          amount: 2500,
          method: 'UPI',
          payee: 'Indane'
        })
      )
      expect(updated).toMatchObject({
        expenseNumber: created.expenseNumber,
        categoryName: 'Gas',
        amount: 2500,
        method: 'UPI',
        payee: 'Indane',
        spentAt: created.spentAt
      })
      // It may stay in a category that has since been switched off.
      app.services.expenses.setCategoryActive(owner, { id: gas.id, isActive: false })
      expect(
        app.services.expenses.update(
          owner,
          updateExpenseInputSchema.parse({
            id: created.id,
            categoryId: gas.id,
            amount: 2600,
            method: 'UPI'
          })
        ).amount
      ).toBe(2600)
      expect(
        await failureCode(() =>
          app.services.expenses.update(
            owner,
            updateExpenseInputSchema.parse({
              id: created.id,
              categoryId: rent.id,
              amount: 1,
              method: 'CASH',
              spentAt: new Date(app.clock.now + 2 * DAY).toISOString()
            })
          )
        )
      ).toBe('VALIDATION_ERROR')
    })

    it('voids with a reason, keeps the record and freezes it', async () => {
      const rent = category('Rent')
      const created = spend(rent.id, 1000)
      const voided = app.services.expenses.voidExpense(
        owner,
        voidExpenseInputSchema.parse({ id: created.id, reason: ' Entered twice ' })
      )
      expect(voided).toMatchObject({
        voidReason: 'Entered twice',
        voidedBy: 'Olivia Owner'
      })
      expect(voided.voidedAt).not.toBeNull()
      expect(app.services.expenses.list({})).toHaveLength(0)
      expect(app.services.expenses.list({ includeVoided: true })).toHaveLength(1)
      expect(
        await failureCode(() =>
          app.services.expenses.voidExpense(owner, { id: created.id, reason: 'Again' })
        )
      ).toBe('CONFLICT')
      expect(
        await failureCode(() =>
          app.services.expenses.update(
            owner,
            updateExpenseInputSchema.parse({
              id: created.id,
              categoryId: rent.id,
              amount: 5,
              method: 'CASH'
            })
          )
        )
      ).toBe('CONFLICT')
      expect(voidExpenseInputSchema.safeParse({ id: created.id, reason: ' ' }).success).toBe(false)
    })

    it('does not find an expense that is not there', async () => {
      expect(
        await failureCode(() => app.services.expenses.get('00000000-0000-4000-8000-000000000000'))
      ).toBe('NOT_FOUND')
    })
  })

  describe('listing and summary', () => {
    it('filters by category, method, text and dates', () => {
      const rent = category('Rent')
      const gas = category('Gas')
      spend(rent.id, 1000, { method: 'BANK', payee: 'Gupta' })
      app.clock.advance(60_000)
      spend(gas.id, 2000, { payee: 'Indane', notes: '100% safe_cylinder' })
      app.clock.advance(3 * DAY)
      spend(gas.id, 3000, { method: 'UPI' })
      const day1 = localDateString(app.clock.now - 3 * DAY)

      const list = (filter: Record<string, unknown>) =>
        app.services.expenses.list(expenseFilterSchema.parse(filter)).map((row) => row.amount)
      expect(list({})).toEqual([3000, 2000, 1000])
      expect(list({ categoryId: gas.id })).toEqual([3000, 2000])
      expect(list({ method: 'BANK' })).toEqual([1000])
      expect(list({ search: 'indane' })).toEqual([2000])
      expect(list({ search: 'TK-EXP-000001' })).toEqual([1000])
      expect(list({ search: 'rent' })).toEqual([1000])
      expect(list({ search: '100%' })).toEqual([2000])
      expect(list({ search: '%' })).toEqual([2000])
      expect(list({ to: day1 })).toEqual([2000, 1000])
      expect(list({ from: localDateString(app.clock.now) })).toEqual([3000])
      expect(list({ limit: 1 })).toEqual([3000])
      expect(expenseFilterSchema.safeParse({ from: '2026-02-30' }).success).toBe(false)
    })

    it('adds up by category and method, leaving out voided ones', () => {
      const rent = category('Rent')
      const gas = category('Gas')
      spend(rent.id, 100000, { method: 'BANK' })
      spend(gas.id, 4000)
      spend(gas.id, 6000, { method: 'UPI' })
      const wrong = spend(gas.id, 99999)
      app.services.expenses.voidExpense(
        owner,
        voidExpenseInputSchema.parse({ id: wrong.id, reason: 'Typo' })
      )
      const summary = app.services.expenses.summary(expenseSummaryFilterSchema.parse({}))
      expect(summary.total).toBe(110000)
      expect(summary.count).toBe(3)
      expect(summary.byCategory).toMatchObject([
        { name: 'Rent', total: 100000, count: 1 },
        { name: 'Gas', total: 10000, count: 2 }
      ])
      expect(summary.byMethod).toMatchObject([
        { method: 'BANK', total: 100000, count: 1 },
        { method: 'UPI', total: 6000, count: 1 },
        { method: 'CASH', total: 4000, count: 1 }
      ])
    })

    it('defaults to the current month and honours a range', () => {
      const rent = category('Rent')
      spend(rent.id, 1000)
      const month = app.services.expenses.summary({})
      expect(month.from <= localDateString(app.clock.now)).toBe(true)
      expect(month.to >= localDateString(app.clock.now)).toBe(true)
      expect(month.total).toBe(1000)
      const elsewhere = app.services.expenses.summary({ from: '2020-01-01', to: '2020-01-31' })
      expect(elsewhere).toMatchObject({ total: 0, count: 0, byCategory: [], byMethod: [] })
    })
  })

  describe('the database guards', () => {
    it('never deletes an expense and keeps its number and author', () => {
      const rent = category('Rent')
      const created = spend(rent.id, 1000)
      expect(sqlError('delete from expenses where id = ?', created.id)).toContain('Void it')
      expect(
        sqlError("update expenses set expense_number = 'X-1' where id = ?", created.id)
      ).toContain('cannot be changed')
      expect(sqlError("update expenses set recorded_by = 'x' where id = ?", created.id)).toContain(
        'cannot be changed'
      )
    })

    it('freezes a voided expense and voids only once', () => {
      const rent = category('Rent')
      const created = spend(rent.id, 1000)
      app.services.expenses.voidExpense(owner, { id: created.id, reason: 'Typo' })
      expect(sqlError('update expenses set amount = 5 where id = ?', created.id)).toContain(
        'voided'
      )
      expect(
        sqlError('update expenses set voided_at = voided_at + 1 where id = ?', created.id)
      ).not.toBe('')
      const row = app.handle.db.select().from(expenses).where(eq(expenses.id, created.id)).get()
      expect(row?.amount).toBe(1000)
    })
  })

  it('writes an audit row for each change', () => {
    const rent = category('Rent')
    app.services.expenses.setCategoryActive(owner, { id: rent.id, isActive: false })
    app.services.expenses.setCategoryActive(owner, { id: rent.id, isActive: true })
    app.services.expenses.updateCategory(
      owner,
      updateExpenseCategoryInputSchema.parse({ id: rent.id, name: 'Shop rent' })
    )
    const created = spend(rent.id, 1000)
    app.services.expenses.update(
      owner,
      updateExpenseInputSchema.parse({
        id: created.id,
        categoryId: rent.id,
        amount: 2000,
        method: 'CASH'
      })
    )
    app.services.expenses.voidExpense(owner, { id: created.id, reason: 'Typo' })
    app.services.expenses.deleteCategory(owner, category('Gas').id)
    expect(actions()).toEqual([
      'expense.recorded',
      'expense.updated',
      'expense.voided',
      'expense_category.activated',
      'expense_category.created',
      'expense_category.created',
      'expense_category.deactivated',
      'expense_category.deleted',
      'expense_category.updated'
    ])
  })
})

describe('the cash drawer', () => {
  let app: TestApp
  let owner: AuthContext
  let tableId: string
  let naan: string // 60.00 at 5%
  let tikka: string // 280.00 at 5%
  let soda: string // 40.00 at 18%

  const entry = (input: RecordCashEntryInput) =>
    app.services.cash.recordEntry(owner, recordCashEntryInputSchema.parse(input))
  const book = (from?: string, to?: string) =>
    app.services.cash.book(cashBookFilterSchema.parse({ from, to }))
  const today = () => localDateString(app.clock.now)
  const category = () =>
    app.services.expenses.createCategory(
      owner,
      createExpenseCategoryInputSchema.parse({ name: 'Rent' })
    )
  const sqlError = (statement: string, ...params: unknown[]): string => {
    try {
      app.handle.sqlite.prepare(statement).run(...params)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    return ''
  }
  /** A bill of 467.00, paid 200.00 in cash and 267.00 by UPI. */
  const paidBill = () => {
    const order = app.services.orders.create(
      owner,
      createOrderInputSchema.parse({
        type: 'DINE_IN',
        tableId,
        lines: [
          { menuItemId: naan, quantity: 2 },
          { menuItemId: tikka, quantity: 1 },
          { menuItemId: soda, quantity: 1 }
        ]
      })
    )
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

  it('starts empty', () => {
    expect(app.services.cash.summary()).toEqual({
      balance: 0,
      todayIn: 0,
      todayOut: 0,
      lastFloatAt: null
    })
    expect(book()).toMatchObject({
      openingBalance: 0,
      totalIn: 0,
      totalOut: 0,
      closingBalance: 0,
      rows: []
    })
  })

  describe('drawer entries', () => {
    it('records each kind with its direction', () => {
      const float = entry({ kind: 'OPENING_FLOAT', amount: 200000, notes: ' Morning ' })
      expect(float).toMatchObject({
        kind: 'OPENING_FLOAT',
        direction: 'IN',
        amount: 200000,
        notes: 'Morning',
        recordedBy: 'Olivia Owner',
        voidedAt: null
      })
      expect(entry({ kind: 'CASH_ADDED', amount: 1 }).direction).toBe('IN')
      expect(entry({ kind: 'BANK_DEPOSIT', amount: 1 }).direction).toBe('OUT')
      expect(entry({ kind: 'OWNER_WITHDRAWAL', amount: 1 }).direction).toBe('OUT')
      expect(entry({ kind: 'CASH_REMOVED', amount: 1 }).direction).toBe('OUT')
    })

    it('refuses bad input and future dates', async () => {
      for (const bad of [
        { kind: 'OPENING_FLOAT', amount: 0 },
        { kind: 'OPENING_FLOAT', amount: -1 },
        { kind: 'OPENING_FLOAT', amount: 1.5 },
        { kind: 'OPENING_FLOAT', amount: 1_000_000_001 },
        { kind: 'TIP', amount: 100 },
        { kind: 'CASH_ADDED', amount: 100, notes: 'x'.repeat(201) }
      ]) {
        expect(recordCashEntryInputSchema.safeParse(bad).success).toBe(false)
      }
      expect(
        await failureCode(() =>
          entry({
            kind: 'CASH_ADDED',
            amount: 100,
            occurredAt: new Date(app.clock.now + DAY).toISOString()
          })
        )
      ).toBe('VALIDATION_ERROR')
    })

    it('lists newest first and hides voided entries unless asked', () => {
      const first = entry({ kind: 'OPENING_FLOAT', amount: 1000 })
      app.clock.advance(60_000)
      entry({ kind: 'CASH_ADDED', amount: 2000 })
      app.services.cash.voidEntry(
        owner,
        voidCashEntryInputSchema.parse({ id: first.id, reason: 'Wrong float' })
      )
      const list = (filter: Record<string, unknown> = {}) =>
        app.services.cash.listEntries(cashEntryFilterSchema.parse(filter)).map((row) => row.amount)
      expect(list()).toEqual([2000])
      expect(list({ includeVoided: true })).toEqual([2000, 1000])
      expect(list({ from: '2020-01-01', to: '2020-01-02' })).toEqual([])
      expect(list({ limit: 1, includeVoided: true })).toEqual([2000])
    })

    it('voids once with a reason and the drawer forgets it', async () => {
      const added = entry({ kind: 'CASH_ADDED', amount: 5000 })
      expect(app.services.cash.summary().balance).toBe(5000)
      const voided = app.services.cash.voidEntry(
        owner,
        voidCashEntryInputSchema.parse({ id: added.id, reason: ' Miscount ' })
      )
      expect(voided).toMatchObject({ voidReason: 'Miscount', voidedBy: 'Olivia Owner' })
      expect(app.services.cash.summary().balance).toBe(0)
      expect(
        await failureCode(() => app.services.cash.voidEntry(owner, { id: added.id, reason: 'x' }))
      ).toBe('CONFLICT')
      expect(
        await failureCode(() =>
          app.services.cash.voidEntry(owner, {
            id: '00000000-0000-4000-8000-000000000000',
            reason: 'x'
          })
        )
      ).toBe('NOT_FOUND')
      expect(voidCashEntryInputSchema.safeParse({ id: added.id, reason: '' }).success).toBe(false)
    })

    it('tracks the last opening float', () => {
      entry({ kind: 'OPENING_FLOAT', amount: 1000 })
      expect(app.services.cash.summary().lastFloatAt).toBe(new Date(app.clock.now).toISOString())
      app.clock.advance(60_000)
      const later = entry({ kind: 'OPENING_FLOAT', amount: 2000 })
      expect(app.services.cash.summary().lastFloatAt).toBe(later.occurredAt)
      app.services.cash.voidEntry(owner, { id: later.id, reason: 'Oops' })
      expect(app.services.cash.summary().lastFloatAt).not.toBe(later.occurredAt)
    })

    it('is protected by the database: no edits, no deletes, one void', () => {
      const added = entry({ kind: 'CASH_ADDED', amount: 5000 })
      expect(sqlError('update cash_entries set amount = 1 where id = ?', added.id)).toContain(
        'cannot be changed'
      )
      expect(sqlError('delete from cash_entries where id = ?', added.id)).toContain('Void it')
      app.services.cash.voidEntry(owner, { id: added.id, reason: 'Oops' })
      expect(
        sqlError('update cash_entries set voided_at = voided_at + 1 where id = ?', added.id)
      ).not.toBe('')
      const row = app.handle.db.select().from(cashEntries).where(eq(cashEntries.id, added.id)).get()
      expect(row?.amount).toBe(5000)
    })
  })

  describe('the cash book', () => {
    it('counts only the cash taken on a bill', () => {
      const bill = paidBill()
      const summary = book()
      expect(summary.totalIn).toBe(20000)
      expect(summary.rows).toHaveLength(1)
      expect(summary.rows[0]).toMatchObject({
        source: 'SALE',
        direction: 'IN',
        amount: 20000,
        reference: bill.billNumber
      })
      expect(app.services.cash.summary()).toMatchObject({
        balance: 20000,
        todayIn: 20000,
        todayOut: 0
      })
    })

    it('takes cash refunds out', () => {
      const bill = paidBill()
      const refund = app.services.bills.refund(
        owner,
        refundBillInputSchema.parse({
          billId: bill.id,
          reason: 'Guest unhappy',
          lines: [{ method: 'CASH', amount: 5000 }]
        })
      )
      const result = book()
      expect(result).toMatchObject({ totalIn: 20000, totalOut: 5000, closingBalance: 15000 })
      expect(result.rows.find((row) => row.source === 'REFUND')).toMatchObject({
        direction: 'OUT',
        amount: 5000,
        reference: refund.refund.refundNumber
      })
    })

    it('takes cash expenses out and ignores other methods and voided ones', () => {
      const rent = category()
      const cashExpense = app.services.expenses.create(
        owner,
        createExpenseInputSchema.parse({
          categoryId: rent.id,
          amount: 7000,
          method: 'CASH',
          payee: 'Gupta'
        })
      )
      app.services.expenses.create(
        owner,
        createExpenseInputSchema.parse({ categoryId: rent.id, amount: 9000, method: 'UPI' })
      )
      const wrong = app.services.expenses.create(
        owner,
        createExpenseInputSchema.parse({ categoryId: rent.id, amount: 3000, method: 'CASH' })
      )
      app.services.expenses.voidExpense(owner, { id: wrong.id, reason: 'Typo' })
      const result = book()
      expect(result.totalOut).toBe(7000)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({
        source: 'EXPENSE',
        direction: 'OUT',
        description: 'Rent: Gupta',
        reference: cashExpense.expenseNumber
      })
    })

    it('takes cash paid to suppliers out, and puts a voided payment back', () => {
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
      const paid = app.services.purchases.recordPayment(
        owner,
        recordPaymentInputSchema.parse({
          purchaseId: purchase.id,
          amount: 25000,
          method: 'CASH'
        })
      )
      app.services.purchases.recordPayment(
        owner,
        recordPaymentInputSchema.parse({
          purchaseId: purchase.id,
          amount: 10000,
          method: 'UPI'
        })
      )
      const result = book()
      expect(result.totalOut).toBe(25000)
      expect(result.rows[0]).toMatchObject({
        source: 'SUPPLIER_PAYMENT',
        direction: 'OUT',
        amount: 25000,
        reference: purchase.purchaseNumber
      })
      const paymentId = paid.payments[0]?.id ?? ''
      app.services.purchases.voidPayment(owner, { id: paymentId, reason: 'Wrong supplier' })
      expect(book().totalOut).toBe(0)
    })

    it('carries the balance from day to day', () => {
      entry({ kind: 'OPENING_FLOAT', amount: 100000 })
      const rent = category()
      app.services.expenses.create(
        owner,
        createExpenseInputSchema.parse({ categoryId: rent.id, amount: 30000, method: 'CASH' })
      )
      const day1 = today()
      app.clock.advance(DAY)
      entry({ kind: 'CASH_ADDED', amount: 5000 })
      entry({ kind: 'BANK_DEPOSIT', amount: 20000 })
      const day2 = today()
      expect(day2).not.toBe(day1)

      expect(book(day1, day1)).toMatchObject({
        openingBalance: 0,
        totalIn: 100000,
        totalOut: 30000,
        closingBalance: 70000
      })
      expect(book(day2, day2)).toMatchObject({
        openingBalance: 70000,
        totalIn: 5000,
        totalOut: 20000,
        closingBalance: 55000
      })
      expect(book(day1, day2)).toMatchObject({
        openingBalance: 0,
        totalIn: 105000,
        totalOut: 50000,
        closingBalance: 55000
      })
      expect(book()).toMatchObject({ from: day2, to: day2 })
      expect(app.services.cash.summary()).toMatchObject({
        balance: 55000,
        todayIn: 5000,
        todayOut: 20000
      })
    })

    it('lists the movements oldest first', () => {
      entry({ kind: 'OPENING_FLOAT', amount: 100000 })
      app.clock.advance(60_000)
      entry({ kind: 'OWNER_WITHDRAWAL', amount: 10000, notes: 'Home' })
      const rows = book().rows
      expect(rows.map((row) => [row.source, row.direction, row.amount])).toEqual([
        ['ENTRY', 'IN', 100000],
        ['ENTRY', 'OUT', 10000]
      ])
      expect(rows[0]?.description).toBe('Opening float')
      expect(rows[1]?.description).toContain('Owner withdrawal')
      expect(rows[1]?.description).toContain('Home')
      expect(new Set(rows.map((row) => row.key)).size).toBe(2)
    })

    it('shows a negative balance rather than hiding it', () => {
      const rent = category()
      app.services.expenses.create(
        owner,
        createExpenseInputSchema.parse({ categoryId: rent.id, amount: 5000, method: 'CASH' })
      )
      expect(app.services.cash.summary().balance).toBe(-5000)
      expect(book().closingBalance).toBe(-5000)
    })

    it('refuses a range that ends before it starts, and bad dates', async () => {
      expect(await failureCode(() => book('2026-02-10', '2026-02-01'))).toBe('VALIDATION_ERROR')
      expect(cashBookFilterSchema.safeParse({ from: 'yesterday' }).success).toBe(false)
      expect(cashBookFilterSchema.safeParse({ from: '2026-13-01' }).success).toBe(false)
    })
  })

  it('writes an audit row for each entry and void', () => {
    const added = entry({ kind: 'CASH_ADDED', amount: 5000 })
    app.services.cash.voidEntry(owner, { id: added.id, reason: 'Oops' })
    const rows = app.handle.db
      .select({ action: auditLogs.action, entityType: auditLogs.entityType })
      .from(auditLogs)
      .all()
      .filter((row) => row.action.startsWith('cash.'))
    expect(rows.map((row) => row.action).sort()).toEqual([
      'cash.entry_recorded',
      'cash.entry_voided'
    ])
    expect(rows.every((row) => row.entityType === 'cash_entry')).toBe(true)
  })
})
