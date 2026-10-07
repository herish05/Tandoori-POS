import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addAddressInputSchema,
  createCustomerInputSchema,
  customerLookupInputSchema,
  normalizePhone,
  updateAddressInputSchema,
  updateCustomerInputSchema
} from '@shared/customers'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import {
  createOrderInputSchema,
  dispatchOrderInputSchema,
  updateOrderInputSchema
} from '@shared/orders'
import { generateBillInputSchema, payBillInputSchema } from '@shared/billing'
import { PERMISSION_CODES } from '@shared/permissions'
import type { AuthContext } from '@main/auth/types'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

describe('customers', () => {
  let app: TestApp
  let owner: AuthContext
  let dal: string

  const make = (extra: Record<string, unknown> = {}) =>
    app.services.customers.create(
      owner,
      createCustomerInputSchema.parse({ name: 'Gurpreet', phone: '98765 43210', ...extra })
    )
  const deliver = (extra: Record<string, unknown> = {}) =>
    app.services.orders.create(
      owner,
      createOrderInputSchema.parse({
        type: 'DELIVERY',
        customerName: 'Gurpreet',
        customerPhone: '+91 98765-43210',
        deliveryAddress: 'Near Bus Stand, Rampura Phul',
        lines: [{ menuItemId: dal, quantity: 2 }],
        ...extra
      })
    )

  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
    const category = app.services.categories.create(
      owner,
      createCategoryInputSchema.parse({ name: 'Food' })
    ).id
    dal = app.services.items.create(
      owner,
      createItemInputSchema.parse({
        categoryId: category,
        name: 'Dal Makhani',
        price: 24000,
        foodType: 'VEG'
      })
    ).id
  })

  afterEach(() => {
    app.cleanup()
  })

  describe('phone numbers', () => {
    it('are normalised so every way of writing one matches', () => {
      expect(normalizePhone('98765 43210')).toBe('9876543210')
      expect(normalizePhone('+91 98765-43210')).toBe('9876543210')
      expect(normalizePhone('098765 43210')).toBe('9876543210')
      expect(normalizePhone('919876543210')).toBe('9876543210')
    })

    it('are refused when too short or not a number', () => {
      for (const phone of ['12', 'abcdefg', '']) {
        expect(createCustomerInputSchema.safeParse({ name: 'A', phone }).success).toBe(false)
      }
    })
  })

  describe('the customer list', () => {
    it('creates, edits and finds customers by name or phone', () => {
      const created = make({ email: 'g@example.com', notes: 'No onion' })
      expect(created.phone).toBe('9876543210')
      expect(created.email).toBe('g@example.com')
      expect(created.orderCount).toBe(0)

      const updated = app.services.customers.update(
        owner,
        updateCustomerInputSchema.parse({
          id: created.id,
          name: 'Gurpreet Singh',
          phone: '98765 43210'
        })
      )
      expect(updated.name).toBe('Gurpreet Singh')
      expect(updated.email).toBeNull()

      expect(app.services.customers.list({ search: 'singh' })).toHaveLength(1)
      expect(app.services.customers.list({ search: '87654' })).toHaveLength(1)
      expect(app.services.customers.list({ search: '+91 98765 43210' })).toHaveLength(1)
      expect(app.services.customers.list({ search: 'nobody' })).toHaveLength(0)
    })

    it('refuses a second customer with the same phone, even in another format', async () => {
      make()
      expect(await failureCode(() => make({ name: 'Other', phone: '+919876543210' }))).toBe(
        'CONFLICT'
      )
      const second = make({ name: 'Other', phone: '90000 11111' })
      expect(
        await failureCode(() =>
          app.services.customers.update(
            owner,
            updateCustomerInputSchema.parse({
              id: second.id,
              name: 'Other',
              phone: '9876543210'
            })
          )
        )
      ).toBe('CONFLICT')
    })

    it('deletes softly, freeing the phone number', () => {
      const created = make()
      app.services.customers.delete(owner, created.id)
      expect(app.services.customers.list()).toHaveLength(0)
      expect(() => app.services.customers.get(created.id)).toThrow(/no longer exists/)
      expect(make().id).not.toBe(created.id)
    })
  })

  describe('addresses', () => {
    it('makes the first address the default and moves the default on request', () => {
      const created = make()
      const add = (address: string, isDefault = false) =>
        app.services.customers.addAddress(
          owner,
          addAddressInputSchema.parse({ customerId: created.id, address, isDefault })
        )
      const first = add('Street 1').addresses
      expect(first.map((a) => a.isDefault)).toEqual([true])

      const second = add('Street 2').addresses
      expect(second.filter((a) => a.isDefault).map((a) => a.address)).toEqual(['Street 1'])

      const third = add('Street 3', true).addresses
      expect(third.filter((a) => a.isDefault).map((a) => a.address)).toEqual(['Street 3'])
    })

    it('promotes another address when the default is removed, and can edit one', () => {
      const created = make()
      for (const address of ['Street 1', 'Street 2']) {
        app.services.customers.addAddress(
          owner,
          addAddressInputSchema.parse({ customerId: created.id, address })
        )
      }
      const [home, other] = app.services.customers.get(created.id).addresses
      const edited = app.services.customers.updateAddress(
        owner,
        updateAddressInputSchema.parse({
          id: other?.id,
          label: 'Work',
          address: 'Office Road',
          landmark: 'Opp. bank'
        })
      )
      expect(edited.addresses.find((a) => a.id === other?.id)?.landmark).toBe('Opp. bank')

      const after = app.services.customers.removeAddress(owner, home?.id ?? '')
      expect(after.addresses).toHaveLength(1)
      expect(after.addresses[0]?.isDefault).toBe(true)
      expect(after.addresses[0]?.address).toBe('Office Road')
    })
  })

  describe('orders', () => {
    it('create the customer and remember the address the first time', () => {
      const order = deliver()
      expect(order.customerId).not.toBeNull()
      const found = app.services.customers.get(order.customerId ?? '')
      expect(found.name).toBe('Gurpreet')
      expect(found.phone).toBe('9876543210')
      expect(found.addresses.map((a) => a.address)).toEqual(['Near Bus Stand, Rampura Phul'])
      expect(found.orderCount).toBe(1)
      expect(found.recentOrders.map((o) => o.id)).toEqual([order.id])
    })

    it('reuse the customer for the same phone and add only new addresses', () => {
      const first = deliver()
      const second = deliver({ customerPhone: '9876543210', deliveryAddress: 'new road' })
      const again = deliver({ deliveryAddress: ' NEAR bus stand,  Rampura Phul ' })
      expect(second.customerId).toBe(first.customerId)
      expect(again.customerId).toBe(first.customerId)
      const found = app.services.customers.get(first.customerId ?? '')
      expect(found.addresses.map((a) => a.address)).toEqual([
        'Near Bus Stand, Rampura Phul',
        'new road'
      ])
      expect(found.orderCount).toBe(3)
      expect(app.services.customers.list()).toHaveLength(1)
      expect(app.services.orders.list({ customerId: first.customerId ?? '' })).toHaveLength(3)
    })

    it('leave the order alone when there is no phone', () => {
      const order = app.services.orders.create(
        owner,
        createOrderInputSchema.parse({
          type: 'TAKEAWAY',
          lines: [{ menuItemId: dal, quantity: 1 }]
        })
      )
      expect(order.customerId).toBeNull()
      expect(app.services.customers.list()).toHaveLength(0)
    })

    it('are linked when a phone is added later', () => {
      const order = app.services.orders.create(
        owner,
        createOrderInputSchema.parse({
          type: 'TAKEAWAY',
          lines: [{ menuItemId: dal, quantity: 1 }]
        })
      )
      const updated = app.services.orders.update(
        owner,
        updateOrderInputSchema.parse({
          id: order.id,
          customerName: 'Simran',
          customerPhone: '90000 22222'
        })
      )
      expect(updated.customerId).not.toBeNull()
      expect(app.services.customers.get(updated.customerId ?? '').name).toBe('Simran')
    })

    it('are counted, with spending only from paid bills and not cancelled orders', () => {
      const paid = deliver()
      const cancelled = deliver()
      app.services.orders.cancel(owner, { id: cancelled.id, reason: 'Customer changed mind' })

      // Serve it the way a delivery goes: kitchen, rider, handed over.
      const { kotIds } = app.services.orders.sendAndGetKots(owner, paid.id)
      for (const id of kotIds) {
        for (const next of ['ACCEPTED', 'PREPARING', 'READY'] as const) {
          app.services.kots.setStatus(owner, { id, status: next })
        }
      }
      app.services.orders.dispatch(
        owner,
        dispatchOrderInputSchema.parse({ orderId: paid.id, riderName: 'Sukhi' })
      )
      app.services.orders.setStatus(owner, { id: paid.id, status: 'SERVED' })
      const bill = app.services.bills.generate(
        owner,
        generateBillInputSchema.parse({ orderId: paid.id })
      )
      app.services.bills.pay(
        owner,
        payBillInputSchema.parse({
          billId: bill.id,
          payments: [{ method: 'CASH', amount: bill.grandTotal }]
        })
      )
      const found = app.services.customers.get(paid.customerId ?? '')
      expect(found.orderCount).toBe(1)
      expect(found.totalSpent).toBe(bill.grandTotal)
      expect(found.lastOrderAt).not.toBeNull()
    })
  })

  describe('lookup', () => {
    it('finds a customer by part of the phone or name, with addresses', () => {
      deliver()
      const byPhone = app.services.customers.lookup(
        customerLookupInputSchema.parse({ query: '43210' })
      )
      expect(byPhone).toHaveLength(1)
      expect(byPhone[0]?.addresses).toHaveLength(1)
      expect(byPhone[0]?.orderCount).toBe(1)
      expect(
        app.services.customers.lookup(customerLookupInputSchema.parse({ query: 'gurp' }))
      ).toHaveLength(1)
      expect(
        app.services.customers.lookup(customerLookupInputSchema.parse({ query: 'zzz' }))
      ).toHaveLength(0)
      expect(customerLookupInputSchema.safeParse({ query: 'g' }).success).toBe(false)
    })
  })

  it('records who changed what in the audit log', () => {
    const created = make()
    app.services.customers.delete(owner, created.id)
    const actions = app.handle.sqlite
      .prepare("select action from audit_logs where action like 'customer.%' order by rowid")
      .all() as { action: string }[]
    expect(actions.map((a) => a.action)).toEqual(['customer.created', 'customer.deleted'])
  })

  it('has its own permissions, which the owner holds', () => {
    for (const code of ['customers.view', 'customers.manage']) {
      expect(PERMISSION_CODES).toContain(code)
    }
  })
})
