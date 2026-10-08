import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createInventoryItemInputSchema,
  movementFilterSchema,
  updateInventoryItemInputSchema,
  type InventoryItem
} from '@shared/inventory'
import {
  cancelPurchaseInputSchema,
  createPurchaseInputSchema,
  createSupplierInputSchema,
  paymentStatusOf,
  purchaseFilterSchema,
  recordPaymentInputSchema,
  supplierFilterSchema,
  updatePurchaseInputSchema,
  updateSupplierInputSchema,
  voidPaymentInputSchema,
  type CreateSupplierInput,
  type Purchase,
  type Supplier
} from '@shared/purchasing'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, supplierPayments } from '@main/db/schema'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

describe('suppliers and purchases', () => {
  let app: TestApp
  let owner: AuthContext

  const supplier = (extra: Partial<CreateSupplierInput> = {}): Supplier =>
    app.services.suppliers.create(
      owner,
      createSupplierInputSchema.parse({ name: 'Sharma Dairy', ...extra })
    )
  const stockItem = (
    name: string,
    unit = 'KG',
    extra: Record<string, unknown> = {}
  ): InventoryItem =>
    app.services.inventory.create(
      owner,
      createInventoryItemInputSchema.parse({ name, unit, ...extra })
    )
  const draft = (
    supplierId: string,
    lines: { inventoryItemId: string; quantity: number; unitCost: number }[],
    extra: Record<string, unknown> = {}
  ): Purchase =>
    app.services.purchases.create(
      owner,
      createPurchaseInputSchema.parse({ supplierId, purchaseDate: '2026-01-05', lines, ...extra })
    )
  const pay = (purchaseId: string, amount: number, extra: Record<string, unknown> = {}) =>
    app.services.purchases.recordPayment(
      owner,
      recordPaymentInputSchema.parse({ purchaseId, amount, method: 'CASH', ...extra })
    )
  const ledger = (itemId: string) =>
    app.services.inventory.movements(movementFilterSchema.parse({ itemId }))
  const auditActions = (): string[] =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .all()
      .map((row) => row.action)
      .filter((action) => action.startsWith('supplier.') || action.startsWith('purchase.'))
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

  describe('suppliers', () => {
    it('keeps contact details tidy', () => {
      const created = supplier({
        phone: '+91 98765-43210',
        gstin: '03abcde1234f1z5',
        contactPerson: ' Mr Sharma ',
        email: ' a@b.in '
      })
      expect(created).toMatchObject({
        name: 'Sharma Dairy',
        phone: '9876543210',
        gstin: '03ABCDE1234F1Z5',
        contactPerson: 'Mr Sharma',
        email: 'a@b.in',
        isActive: true,
        purchaseCount: 0,
        totalPurchased: 0,
        amountDue: 0,
        lastPurchaseDate: null
      })
      expect(supplier({ name: 'Plain Co' })).toMatchObject({
        phone: null,
        gstin: null,
        email: null
      })
    })

    it('refuses bad input', () => {
      const bad = [
        { name: '' },
        { name: 'X', phone: 'abc' },
        { name: 'X', phone: '12' },
        { name: 'X', gstin: '12345' },
        { name: 'X', email: 'not-an-email' }
      ]
      for (const input of bad) {
        expect(createSupplierInputSchema.safeParse(input).success).toBe(false)
      }
    })

    it('does not allow two suppliers with the same name, whatever the case', async () => {
      const first = supplier()
      expect(await failureCode(() => supplier({ name: 'sharma dairy' }))).toBe('CONFLICT')
      const other = supplier({ name: 'Gupta Spices' })
      expect(
        await failureCode(() =>
          app.services.suppliers.update(
            owner,
            updateSupplierInputSchema.parse({ id: other.id, name: 'SHARMA DAIRY' })
          )
        )
      ).toBe('CONFLICT')
      // Keeping its own name is fine.
      expect(
        app.services.suppliers.update(
          owner,
          updateSupplierInputSchema.parse({ id: first.id, name: 'Sharma Dairy', notes: 'Weekly' })
        ).notes
      ).toBe('Weekly')
    })

    it('hides deactivated suppliers unless asked, and filters by name or phone', () => {
      const dairy = supplier({ phone: '9876543210' })
      supplier({ name: 'Gupta Spices', phone: '9111122222' })
      app.services.suppliers.setActive(owner, { id: dairy.id, isActive: false })
      const list = (filter: object) =>
        app.services.suppliers.list(supplierFilterSchema.parse(filter)).map((row) => row.name)
      expect(list({})).toEqual(['Gupta Spices'])
      expect(list({ includeInactive: true })).toEqual(['Gupta Spices', 'Sharma Dairy'])
      expect(list({ search: 'gupta' })).toEqual(['Gupta Spices'])
      expect(list({ search: '91111', includeInactive: true })).toEqual(['Gupta Spices'])
      expect(list({ search: '98765', includeInactive: true })).toEqual(['Sharma Dairy'])
      expect(list({ search: '%' })).toEqual([])
    })

    it('deletes a supplier with no purchases and frees its name', () => {
      const created = supplier()
      expect(app.services.suppliers.delete(owner, created.id)).toBeNull()
      expect(app.services.suppliers.list({ includeInactive: true })).toEqual([])
      expect(supplier().name).toBe('Sharma Dairy')
    })

    it('refuses to delete a supplier that has purchases', async () => {
      const created = supplier()
      const paneer = stockItem('Paneer')
      draft(created.id, [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 30000 }])
      expect(await failureCode(() => app.services.suppliers.delete(owner, created.id))).toBe(
        'CONFLICT'
      )
    })

    it('refuses to buy from a deactivated supplier', async () => {
      const created = supplier()
      const paneer = stockItem('Paneer')
      app.services.suppliers.setActive(owner, { id: created.id, isActive: false })
      expect(
        await failureCode(() =>
          draft(created.id, [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 30000 }])
        )
      ).toBe('VALIDATION_ERROR')
    })

    it('audits supplier changes', () => {
      const created = supplier()
      app.services.suppliers.update(
        owner,
        updateSupplierInputSchema.parse({ id: created.id, name: 'Sharma Dairy Ltd' })
      )
      app.services.suppliers.setActive(owner, { id: created.id, isActive: false })
      app.services.suppliers.setActive(owner, { id: created.id, isActive: false })
      app.services.suppliers.setActive(owner, { id: created.id, isActive: true })
      app.services.suppliers.delete(owner, created.id)
      expect(auditActions()).toEqual([
        'supplier.activated',
        'supplier.created',
        'supplier.deactivated',
        'supplier.deleted',
        'supplier.updated'
      ])
    })
  })

  describe('purchase drafts', () => {
    it('works out the totals and numbers purchases in order', () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const oil = stockItem('Oil', 'L')
      const first = draft(
        dairy.id,
        [
          { inventoryItemId: paneer.id, quantity: 2500, unitCost: 12000 },
          { inventoryItemId: oil.id, quantity: 4000, unitCost: 15000 }
        ],
        { discount: 1000, tax: 1500, invoiceNumber: ' INV-77 ' }
      )
      expect(first).toMatchObject({
        status: 'DRAFT',
        paymentStatus: 'NOT_DUE',
        supplierName: 'Sharma Dairy',
        invoiceNumber: 'INV-77',
        lineCount: 2,
        subtotal: 90000,
        discount: 1000,
        tax: 1500,
        total: 90500,
        amountPaid: 0,
        amountDue: 0,
        receivedAt: null
      })
      expect(first.lines.map((line) => [line.itemName, line.unit, line.lineTotal])).toEqual([
        ['Paneer', 'KG', 30000],
        ['Oil', 'L', 60000]
      ])
      expect(first.purchaseNumber).toMatch(/^[A-Z0-9]+-PUR-000001$/)
      const second = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 100 }
      ])
      expect(second.purchaseNumber).toMatch(/^[A-Z0-9]+-PUR-000002$/)
      // A draft changes nothing in stock.
      expect(app.services.inventory.get(paneer.id).onHand).toBe(0)
    })

    it('rounds line totals to the nearest paisa', () => {
      const dairy = supplier()
      const spice = stockItem('Cumin')
      // 0.333 kg at 1.01 rupees/kg = 33.633 paise
      const bought = draft(dairy.id, [{ inventoryItemId: spice.id, quantity: 333, unitCost: 101 }])
      expect(bought.lines[0]?.lineTotal).toBe(34)
      expect(bought.total).toBe(34)
    })

    it('refuses bad drafts', async () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const line = { inventoryItemId: paneer.id, quantity: 1000, unitCost: 10000 }
      const parse = (input: object) =>
        createPurchaseInputSchema.safeParse({
          supplierId: dairy.id,
          purchaseDate: '2026-01-05',
          ...input
        }).success
      expect(parse({ lines: [] })).toBe(false)
      expect(parse({ lines: [line, line] })).toBe(false)
      expect(parse({ lines: [{ ...line, quantity: 0 }] })).toBe(false)
      expect(parse({ lines: [{ ...line, unitCost: -1 }] })).toBe(false)
      expect(parse({ lines: [{ ...line, unitCost: 1.5 }] })).toBe(false)
      expect(parse({ lines: [line], purchaseDate: '05-01-2026' })).toBe(false)
      expect(parse({ lines: [line], purchaseDate: '2026-02-30' })).toBe(false)
      expect(parse({ lines: [line], tax: -1 })).toBe(false)
      expect(parse({ lines: [line] })).toBe(true)
      // The discount cannot exceed the items.
      expect(await failureCode(() => draft(dairy.id, [line], { discount: 10001 }))).toBe(
        'VALIDATION_ERROR'
      )
      expect(draft(dairy.id, [line], { discount: 10000 }).total).toBe(0)
    })

    it('refuses retired or missing stock items and suppliers', async () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const retired = stockItem('Old spice')
      app.services.inventory.setActive(owner, { id: retired.id, isActive: false })
      expect(
        await failureCode(() =>
          draft(dairy.id, [{ inventoryItemId: retired.id, quantity: 1000, unitCost: 100 }])
        )
      ).toBe('VALIDATION_ERROR')
      expect(
        await failureCode(() =>
          draft(dairy.id, [
            {
              inventoryItemId: '00000000-0000-4000-8000-000000000000',
              quantity: 1000,
              unitCost: 100
            }
          ])
        )
      ).toBe('NOT_FOUND')
      expect(
        await failureCode(() =>
          draft('00000000-0000-4000-8000-000000000000', [
            { inventoryItemId: paneer.id, quantity: 1000, unitCost: 100 }
          ])
        )
      ).toBe('NOT_FOUND')
    })

    it('edits a draft: new lines replace the old and totals follow', () => {
      const dairy = supplier()
      const gupta = supplier({ name: 'Gupta Spices' })
      const paneer = stockItem('Paneer')
      const oil = stockItem('Oil', 'L')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 30000 }
      ])
      const edited = app.services.purchases.update(
        owner,
        updatePurchaseInputSchema.parse({
          id: created.id,
          supplierId: gupta.id,
          purchaseDate: '2026-01-04',
          notes: 'Changed',
          tax: 500,
          lines: [{ inventoryItemId: oil.id, quantity: 2000, unitCost: 15000 }]
        })
      )
      expect(edited).toMatchObject({
        purchaseNumber: created.purchaseNumber,
        supplierName: 'Gupta Spices',
        purchaseDate: '2026-01-04',
        notes: 'Changed',
        subtotal: 30000,
        tax: 500,
        total: 30500,
        lineCount: 1
      })
      expect(edited.lines.map((line) => line.itemName)).toEqual(['Oil'])
    })

    it('cancels a draft with a reason, after which it is closed', async () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 100 }
      ])
      expect(cancelPurchaseInputSchema.safeParse({ id: created.id, reason: ' ' }).success).toBe(
        false
      )
      const cancelled = app.services.purchases.cancel(
        owner,
        cancelPurchaseInputSchema.parse({ id: created.id, reason: 'Ordered elsewhere' })
      )
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'NOT_DUE',
        cancelReason: 'Ordered elsewhere'
      })
      expect(cancelled.cancelledAt).not.toBeNull()
      expect(await failureCode(() => app.services.purchases.receive(owner, created.id))).toBe(
        'CONFLICT'
      )
      expect(
        await failureCode(() =>
          app.services.purchases.update(
            owner,
            updatePurchaseInputSchema.parse({
              id: created.id,
              supplierId: dairy.id,
              purchaseDate: '2026-01-05',
              lines: [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 100 }]
            })
          )
        )
      ).toBe('CONFLICT')
      expect(
        await failureCode(() =>
          app.services.purchases.cancel(
            owner,
            cancelPurchaseInputSchema.parse({ id: created.id, reason: 'Again' })
          )
        )
      ).toBe('CONFLICT')
    })
  })

  describe('receiving', () => {
    it('puts every line into stock at the price paid', () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer', 'KG', { openingStock: 1000, unitCost: 25000 })
      const oil = stockItem('Oil', 'L')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 2500, unitCost: 30000 },
        { inventoryItemId: oil.id, quantity: 4000, unitCost: 15000 }
      ])
      const received = app.services.purchases.receive(owner, created.id)
      expect(received).toMatchObject({
        status: 'RECEIVED',
        paymentStatus: 'UNPAID',
        amountDue: 135000,
        total: 135000
      })
      expect(received.receivedAt).not.toBeNull()
      expect(received.receivedBy).toBe('Olivia Owner')

      expect(app.services.inventory.get(paneer.id)).toMatchObject({ onHand: 3500, unitCost: 30000 })
      expect(app.services.inventory.get(oil.id)).toMatchObject({ onHand: 4000, unitCost: 15000 })
      expect(ledger(paneer.id)[0]).toMatchObject({
        type: 'STOCK_IN',
        quantity: 2500,
        balanceAfter: 3500,
        unitCost: 30000,
        reason: `Purchase ${created.purchaseNumber}`
      })
      expect(ledger(oil.id)).toHaveLength(1)
    })

    it('cannot be received twice or changed afterwards', async () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 30000 }
      ])
      app.services.purchases.receive(owner, created.id)
      expect(await failureCode(() => app.services.purchases.receive(owner, created.id))).toBe(
        'CONFLICT'
      )
      expect(
        await failureCode(() =>
          app.services.purchases.cancel(
            owner,
            cancelPurchaseInputSchema.parse({ id: created.id, reason: 'Oops' })
          )
        )
      ).toBe('CONFLICT')
      expect(
        await failureCode(() =>
          app.services.purchases.update(
            owner,
            updatePurchaseInputSchema.parse({
              id: created.id,
              supplierId: dairy.id,
              purchaseDate: '2026-01-05',
              lines: [{ inventoryItemId: paneer.id, quantity: 5000, unitCost: 30000 }]
            })
          )
        )
      ).toBe('CONFLICT')
      expect(app.services.inventory.get(paneer.id).onHand).toBe(1000)
      expect(ledger(paneer.id)).toHaveLength(1)
    })

    it('receives nothing at all when one line cannot be received', async () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const oil = stockItem('Oil', 'L')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 30000 },
        { inventoryItemId: oil.id, quantity: 1000, unitCost: 15000 }
      ])
      app.services.inventory.setActive(owner, { id: oil.id, isActive: false })
      expect(await failureCode(() => app.services.purchases.receive(owner, created.id))).toBe(
        'CONFLICT'
      )
      expect(app.services.purchases.get(created.id).status).toBe('DRAFT')
      expect(app.services.inventory.get(paneer.id).onHand).toBe(0)
      expect(ledger(paneer.id)).toEqual([])
      // Once the item is back, it goes through.
      app.services.inventory.setActive(owner, { id: oil.id, isActive: true })
      expect(app.services.purchases.receive(owner, created.id).status).toBe('RECEIVED')
    })

    it('refuses to receive when the unit of an item changed after drafting', async () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 30000 }
      ])
      app.services.inventory.update(
        owner,
        updateInventoryItemInputSchema.parse({ id: paneer.id, name: 'Paneer', unit: 'G' })
      )
      expect(await failureCode(() => app.services.purchases.receive(owner, created.id))).toBe(
        'CONFLICT'
      )
      expect(app.services.purchases.get(created.id).status).toBe('DRAFT')
      expect(app.services.inventory.get(paneer.id).onHand).toBe(0)
    })

    it('shows the name and unit as they were on the invoice', () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 30000 }
      ])
      app.services.purchases.receive(owner, created.id)
      app.services.inventory.update(
        owner,
        updateInventoryItemInputSchema.parse({ id: paneer.id, name: 'Cottage cheese', unit: 'KG' })
      )
      expect(app.services.purchases.get(created.id).lines[0]).toMatchObject({
        itemName: 'Paneer',
        unit: 'KG'
      })
    })
  })

  describe('payments', () => {
    const received = (total = 100000): { purchase: Purchase; supplier: Supplier } => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: total }
      ])
      return { purchase: app.services.purchases.receive(owner, created.id), supplier: dairy }
    }

    it('tracks part and full payment', () => {
      const { purchase, supplier: dairy } = received()
      const part = pay(purchase.id, 40000, { method: 'UPI', reference: 'UTR123' })
      expect(part).toMatchObject({ amountPaid: 40000, amountDue: 60000, paymentStatus: 'PARTIAL' })
      expect(part.payments).toHaveLength(1)
      expect(part.payments[0]).toMatchObject({
        amount: 40000,
        method: 'UPI',
        reference: 'UTR123',
        recordedBy: 'Olivia Owner',
        voidedAt: null
      })
      expect(app.services.suppliers.get(dairy.id)).toMatchObject({
        purchaseCount: 1,
        totalPurchased: 100000,
        amountDue: 60000,
        lastPurchaseDate: '2026-01-05'
      })
      expect(app.services.purchases.summary()).toMatchObject({
        unpaidCount: 1,
        totalDue: 60000,
        purchasedThisMonth: 100000
      })
      const full = pay(purchase.id, 60000)
      expect(full).toMatchObject({ amountPaid: 100000, amountDue: 0, paymentStatus: 'PAID' })
      expect(app.services.suppliers.get(dairy.id).amountDue).toBe(0)
      expect(app.services.purchases.summary()).toMatchObject({ unpaidCount: 0, totalDue: 0 })
    })

    it('refuses paying more than is owed, nothing, or against a draft', async () => {
      const { purchase } = received()
      expect(await failureCode(() => pay(purchase.id, 100001))).toBe('VALIDATION_ERROR')
      pay(purchase.id, 100000)
      expect(await failureCode(() => pay(purchase.id, 1))).toBe('VALIDATION_ERROR')
      expect(
        recordPaymentInputSchema.safeParse({ purchaseId: purchase.id, amount: 0, method: 'CASH' })
          .success
      ).toBe(false)
      expect(
        recordPaymentInputSchema.safeParse({ purchaseId: purchase.id, amount: 5, method: 'BARTER' })
          .success
      ).toBe(false)
      const dairy = supplier({ name: 'Other' })
      const paneer = stockItem('Cheese')
      const unreceived = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 100 }
      ])
      expect(await failureCode(() => pay(unreceived.id, 50))).toBe('CONFLICT')
    })

    it('voids a wrong payment: the amount is owed again and the payment stays on record', async () => {
      const { purchase } = received()
      const paid = pay(purchase.id, 100000)
      const payment = paid.payments[0]
      expect(payment).toBeDefined()
      const paymentId = payment?.id ?? ''
      expect(voidPaymentInputSchema.safeParse({ id: paymentId, reason: '' }).success).toBe(false)
      const voided = app.services.purchases.voidPayment(
        owner,
        voidPaymentInputSchema.parse({ id: paymentId, reason: 'Wrong purchase' })
      )
      expect(voided).toMatchObject({ amountPaid: 0, amountDue: 100000, paymentStatus: 'UNPAID' })
      expect(voided.payments[0]).toMatchObject({ voidReason: 'Wrong purchase' })
      expect(voided.payments[0]?.voidedAt).not.toBeNull()
      expect(
        await failureCode(() =>
          app.services.purchases.voidPayment(
            owner,
            voidPaymentInputSchema.parse({ id: paymentId, reason: 'Again' })
          )
        )
      ).toBe('CONFLICT')
      // A voided payment no longer counts, so the full amount can be paid again.
      expect(pay(purchase.id, 100000).paymentStatus).toBe('PAID')
    })

    it('filters purchases by what is unpaid, supplier, status, date and text', () => {
      const dairy = supplier()
      const gupta = supplier({ name: 'Gupta Spices' })
      const paneer = stockItem('Paneer')
      const a = draft(dairy.id, [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 1000 }], {
        invoiceNumber: 'D-1',
        purchaseDate: '2026-01-01'
      })
      const b = draft(gupta.id, [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 2000 }], {
        invoiceNumber: 'G-9',
        purchaseDate: '2026-01-03'
      })
      const c = draft(gupta.id, [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 3000 }], {
        purchaseDate: '2026-01-04'
      })
      app.services.purchases.receive(owner, a.id)
      app.services.purchases.receive(owner, b.id)
      pay(b.id, 2000)
      const list = (filter: object) =>
        app.services.purchases.list(purchaseFilterSchema.parse(filter)).map((row) => row.id)
      // Newest purchase date first.
      expect(list({})).toEqual([c.id, b.id, a.id])
      expect(list({ status: 'DRAFT' })).toEqual([c.id])
      expect(list({ unpaidOnly: true })).toEqual([a.id])
      expect(list({ supplierId: gupta.id })).toEqual([c.id, b.id])
      expect(list({ from: '2026-01-02', to: '2026-01-03' })).toEqual([b.id])
      expect(list({ search: 'g-9' })).toEqual([b.id])
      expect(list({ search: 'sharma' })).toEqual([a.id])
      expect(list({ search: a.purchaseNumber })).toEqual([a.id])
      expect(app.services.purchases.summary()).toMatchObject({
        draftCount: 1,
        unpaidCount: 1,
        totalDue: 1000
      })
    })

    it('names the payment states', () => {
      expect(paymentStatusOf('DRAFT', 100, 0)).toBe('NOT_DUE')
      expect(paymentStatusOf('CANCELLED', 100, 0)).toBe('NOT_DUE')
      expect(paymentStatusOf('RECEIVED', 100, 0)).toBe('UNPAID')
      expect(paymentStatusOf('RECEIVED', 100, 40)).toBe('PARTIAL')
      expect(paymentStatusOf('RECEIVED', 100, 100)).toBe('PAID')
      expect(paymentStatusOf('RECEIVED', 0, 0)).toBe('PAID')
    })
  })

  describe('database guards', () => {
    it('freezes a received purchase and its lines', () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 30000 }
      ])
      // A draft can still change.
      expect(
        sqlError('update purchases set invoice_number = ? where id = ?', 'OK', created.id)
      ).toBe('')
      app.services.purchases.receive(owner, created.id)

      expect(
        sqlError('update purchases set invoice_number = ? where id = ?', 'X', created.id)
      ).toMatch(/cannot be changed/)
      expect(sqlError('update purchases set total = total + 1 where id = ?', created.id)).toMatch(
        /cannot be changed/
      )
      expect(
        sqlError('update purchases set supplier_id = supplier_id where id = ?', created.id)
      ).toMatch(/cannot be changed/)
      expect(sqlError("update purchases set status = 'DRAFT' where id = ?", created.id)).toMatch(
        /draft to received or cancelled/
      )
      expect(
        sqlError("update purchases set status = 'CANCELLED' where id = ?", created.id)
      ).toMatch(/draft to received or cancelled/)
      expect(sqlError('delete from purchases where id = ?', created.id)).toMatch(
        /cannot be deleted/
      )
      expect(
        sqlError('update purchase_lines set quantity = 5 where purchase_id = ?', created.id)
      ).toMatch(/cannot be changed/)
      expect(
        sqlError('update purchase_lines set deleted_at = 1 where purchase_id = ?', created.id)
      ).toMatch(/cannot be changed/)
      expect(sqlError('delete from purchase_lines where purchase_id = ?', created.id)).toMatch(
        /cannot be deleted/
      )
      expect(
        sqlError(
          `insert into purchase_lines (id, created_at, updated_at, purchase_id, inventory_item_id, item_name, unit, quantity, unit_cost, line_total)
           values ('x', 1, 1, ?, ?, 'Paneer', 'KG', 1, 1, 1)`,
          created.id,
          paneer.id
        )
      ).toMatch(/cannot be changed/)
    })

    it('freezes a cancelled purchase', () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 100 }
      ])
      app.services.purchases.cancel(
        owner,
        cancelPurchaseInputSchema.parse({ id: created.id, reason: 'No' })
      )
      expect(sqlError('update purchases set tax = 5 where id = ?', created.id)).toMatch(
        /cannot be changed/
      )
      expect(sqlError("update purchases set status = 'RECEIVED' where id = ?", created.id)).toMatch(
        /draft to received or cancelled/
      )
    })

    it('never lets a payment be edited or deleted, or voided twice', () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 100000 }
      ])
      app.services.purchases.receive(owner, created.id)
      const paid = pay(created.id, 50000)
      const paymentId = paid.payments[0]?.id ?? ''

      expect(sqlError('update supplier_payments set amount = 1 where id = ?', paymentId)).toMatch(
        /cannot be changed/
      )
      expect(
        sqlError("update supplier_payments set method = 'UPI' where id = ?", paymentId)
      ).toMatch(/cannot be changed/)
      expect(sqlError('delete from supplier_payments where id = ?', paymentId)).toMatch(
        /Void it instead/
      )
      app.services.purchases.voidPayment(
        owner,
        voidPaymentInputSchema.parse({ id: paymentId, reason: 'Mistake' })
      )
      expect(
        sqlError('update supplier_payments set voided_at = 5 where id = ?', paymentId)
      ).toMatch(/already voided/)
    })

    it('only takes payments against received purchases, and never more than the total', () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const created = draft(dairy.id, [
        { inventoryItemId: paneer.id, quantity: 1000, unitCost: 1000 }
      ])
      const insert = () =>
        app.handle.db
          .insert(supplierPayments)
          .values({
            restaurantId: created.id,
            purchaseId: created.id,
            supplierId: dairy.id,
            amount: 100,
            method: 'CASH',
            paidAt: new Date(),
            recordedBy: owner.userId
          })
          .run()
      expect(insert).toThrow()
      expect(sqlError('update purchases set amount_paid = 1001 where id = ?', created.id)).not.toBe(
        ''
      )
      app.services.purchases.receive(owner, created.id)
      expect(sqlError('update purchases set amount_paid = 1001 where id = ?', created.id)).not.toBe(
        ''
      )
    })
  })

  describe('audit', () => {
    it('records every purchase step', () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      const a = draft(dairy.id, [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 1000 }])
      app.services.purchases.update(
        owner,
        updatePurchaseInputSchema.parse({
          id: a.id,
          supplierId: dairy.id,
          purchaseDate: '2026-01-05',
          lines: [{ inventoryItemId: paneer.id, quantity: 2000, unitCost: 1000 }]
        })
      )
      app.services.purchases.receive(owner, a.id)
      const paid = pay(a.id, 500)
      app.services.purchases.voidPayment(
        owner,
        voidPaymentInputSchema.parse({ id: paid.payments[0]?.id ?? '', reason: 'Mistake' })
      )
      const b = draft(dairy.id, [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 1000 }])
      app.services.purchases.cancel(
        owner,
        cancelPurchaseInputSchema.parse({ id: b.id, reason: 'No' })
      )
      expect(auditActions().filter((action) => action.startsWith('purchase.'))).toEqual([
        'purchase.cancelled',
        'purchase.created',
        'purchase.created',
        'purchase.payment_recorded',
        'purchase.payment_voided',
        'purchase.received',
        'purchase.updated'
      ])
    })

    it('rolls a failed purchase back completely, including its number', async () => {
      const dairy = supplier()
      const paneer = stockItem('Paneer')
      expect(
        await failureCode(() =>
          draft(dairy.id, [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 100 }], {
            discount: 5000
          })
        )
      ).toBe('VALIDATION_ERROR')
      expect(app.services.purchases.list({})).toEqual([])
      const next = draft(dairy.id, [{ inventoryItemId: paneer.id, quantity: 1000, unitCost: 100 }])
      expect(next.purchaseNumber).toMatch(/-PUR-000001$/)
    })
  })
})
