import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cancelKotInputSchema, setKotStatusInputSchema } from '@shared/kitchen'
import {
  createInventoryItemInputSchema,
  formatQuantity,
  movementFilterSchema,
  parseQuantity,
  setRecipeInputSchema,
  stockCountInputSchema,
  stockInInputSchema,
  updateInventoryItemInputSchema,
  wastageInputSchema,
  type CreateInventoryItemInput,
  type InventoryItem,
  type StockMovement
} from '@shared/inventory'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import {
  addItemsInputSchema,
  cancelLineInputSchema,
  cancelOrderInputSchema,
  createOrderInputSchema,
  type OrderLineInput
} from '@shared/orders'
import { PERMISSION_CODES } from '@shared/permissions'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, inventoryItems, stockMovements } from '@main/db/schema'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

describe('inventory', () => {
  let app: TestApp
  let owner: AuthContext
  let categoryId: string

  const make = (extra: Partial<CreateInventoryItemInput> = {}): InventoryItem =>
    app.services.inventory.create(
      owner,
      createInventoryItemInputSchema.parse({ name: 'Paneer', unit: 'KG', ...extra })
    )
  const stockIn = (itemId: string, quantity: number, unitCost?: number) =>
    app.services.inventory.stockIn(owner, stockInInputSchema.parse({ itemId, quantity, unitCost }))
  const item = (id: string) => app.services.inventory.get(id)
  const menuItem = (name: string, extra: Record<string, unknown> = {}) =>
    app.services.items.create(
      owner,
      createItemInputSchema.parse({ categoryId, name, price: 24000, foodType: 'VEG', ...extra })
    )
  const recipe = (
    menuItemId: string,
    lines: { inventoryItemId: string; quantity: number }[],
    variantId: string | null = null
  ) => app.services.recipes.set(owner, setRecipeInputSchema.parse({ menuItemId, variantId, lines }))
  const line = (menuItemId: string, extra: Partial<OrderLineInput> = {}): OrderLineInput => ({
    menuItemId,
    quantity: 1,
    ...extra
  })
  const takeaway = (lines: OrderLineInput[]) =>
    app.services.orders.create(owner, createOrderInputSchema.parse({ type: 'TAKEAWAY', lines }))
  const ledger = (itemId?: string): StockMovement[] =>
    app.services.inventory.movements(movementFilterSchema.parse({ itemId }))
  const kitchenStep = (orderId: string, status: 'ACCEPTED' | 'PREPARING') => {
    for (const kot of app.services.kots.list({ orderId, openOnly: true })) {
      app.services.kots.setStatus(owner, setKotStatusInputSchema.parse({ id: kot.id, status }))
    }
  }
  const auditActions = (): string[] =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .all()
      .map((row) => row.action)
      .filter((action) => action.startsWith('inventory.'))

  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
    categoryId = app.services.categories.create(
      owner,
      createCategoryInputSchema.parse({ name: 'Food' })
    ).id
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('quantities', () => {
    it('reads and shows thousandths without drift', () => {
      expect(parseQuantity('2')).toBe(2000)
      expect(parseQuantity('2.5')).toBe(2500)
      expect(parseQuantity('0.125')).toBe(125)
      expect(parseQuantity(' 10.050 ')).toBe(10050)
      for (const bad of ['', 'abc', '1.2345', '-1', '1,5', '.5']) {
        expect(parseQuantity(bad)).toBeNull()
      }
      expect(formatQuantity(2500)).toBe('2.5')
      expect(formatQuantity(125)).toBe('0.125')
      expect(formatQuantity(3000)).toBe('3')
      expect(formatQuantity(-1500)).toBe('-1.5')
      expect(formatQuantity(0)).toBe('0')
    })

    it('refuses bad input', () => {
      const bad = [
        { name: '', unit: 'KG' },
        { name: 'X', unit: 'TONNE' },
        { name: 'X', unit: 'KG', reorderLevel: -1 },
        { name: 'X', unit: 'KG', openingStock: 1.5 },
        { name: 'X', unit: 'KG', unitCost: -5 }
      ]
      for (const input of bad) {
        expect(createInventoryItemInputSchema.safeParse(input).success).toBe(false)
      }
      const id = crypto.randomUUID()
      expect(stockInInputSchema.safeParse({ itemId: id, quantity: 0 }).success).toBe(false)
      expect(wastageInputSchema.safeParse({ itemId: id, quantity: 5 }).success).toBe(false)
      expect(stockCountInputSchema.safeParse({ itemId: id, counted: -1 }).success).toBe(false)
      expect(
        setRecipeInputSchema.safeParse({
          menuItemId: id,
          variantId: null,
          lines: [
            { inventoryItemId: id, quantity: 100 },
            { inventoryItemId: id, quantity: 200 }
          ]
        }).success
      ).toBe(false)
    })
  })

  describe('stock items', () => {
    it('creates an item with opening stock and a ledger entry for it', () => {
      const created = make({
        category: 'Dairy',
        reorderLevel: 2000,
        unitCost: 32000,
        openingStock: 5000
      })
      expect(created).toMatchObject({
        name: 'Paneer',
        unit: 'KG',
        category: 'Dairy',
        onHand: 5000,
        reorderLevel: 2000,
        unitCost: 32000,
        stockValue: 160000,
        isActive: true,
        isLow: false,
        usedInRecipes: 0
      })
      expect(ledger(created.id)).toMatchObject([
        { type: 'OPENING', quantity: 5000, balanceAfter: 5000 }
      ])
    })

    it('adds no ledger entry when there is no opening stock', () => {
      const created = make()
      expect(created.onHand).toBe(0)
      expect(ledger()).toHaveLength(0)
    })

    it('refuses a second item with the same name, whatever the case', async () => {
      make()
      expect(await failureCode(() => make({ name: 'paneer' }))).toBe('CONFLICT')
      const other = make({ name: 'Butter' })
      expect(
        await failureCode(() =>
          app.services.inventory.update(
            owner,
            updateInventoryItemInputSchema.parse({ id: other.id, name: 'PANEER', unit: 'KG' })
          )
        )
      ).toBe('CONFLICT')
    })

    it('edits an item, and locks the unit once stock has been recorded', async () => {
      const created = make({ name: 'Cream', unit: 'L' })
      const renamed = app.services.inventory.update(
        owner,
        updateInventoryItemInputSchema.parse({
          id: created.id,
          name: 'Fresh cream',
          unit: 'ML',
          reorderLevel: 500,
          unitCost: 20
        })
      )
      expect(renamed).toMatchObject({ name: 'Fresh cream', unit: 'ML', reorderLevel: 500 })
      stockIn(created.id, 1000)
      expect(
        await failureCode(() =>
          app.services.inventory.update(
            owner,
            updateInventoryItemInputSchema.parse({
              id: created.id,
              name: 'Fresh cream',
              unit: 'L'
            })
          )
        )
      ).toBe('CONFLICT')
    })

    it('lists with search, low-stock and inactive filters', () => {
      const paneer = make({ reorderLevel: 3000, openingStock: 2000 })
      make({ name: 'Basmati rice', category: 'Grains', openingStock: 50000 })
      const old = make({ name: 'Old spice' })
      app.services.inventory.setActive(owner, { id: old.id, isActive: false })

      expect(app.services.inventory.list().map((i) => i.name)).toEqual(['Basmati rice', 'Paneer'])
      expect(app.services.inventory.list({ includeInactive: true })).toHaveLength(3)
      expect(app.services.inventory.list({ search: 'grain' }).map((i) => i.name)).toEqual([
        'Basmati rice'
      ])
      expect(app.services.inventory.list({ lowOnly: true }).map((i) => i.id)).toEqual([paneer.id])
    })

    it('deletes an item with no history, and keeps one that has any', async () => {
      const fresh = make({ name: 'Fresh' })
      app.services.inventory.delete(owner, fresh.id)
      expect(app.services.inventory.list()).toHaveLength(0)
      expect(await failureCode(() => Promise.resolve(item(fresh.id)))).toBe('NOT_FOUND')
      make({ name: 'Fresh' })

      const used = make({ name: 'Used', openingStock: 1000 })
      expect(await failureCode(() => app.services.inventory.delete(owner, used.id))).toBe(
        'CONFLICT'
      )
    })

    it('summarises stock, low items and its value', () => {
      make({ name: 'A', openingStock: 1000, unitCost: 10000, reorderLevel: 1000 })
      make({ name: 'B', openingStock: 4000, unitCost: 5000 })
      make({ name: 'C' })
      expect(app.services.inventory.summary()).toEqual({
        activeItems: 3,
        lowItems: 1,
        outOfStockItems: 1,
        stockValue: 30000
      })
    })
  })

  describe('stock changes', () => {
    it('adds stock and takes the delivery price as the new cost', () => {
      const paneer = make({ openingStock: 1000, unitCost: 30000 })
      const after = stockIn(paneer.id, 2500, 33000)
      expect(after).toMatchObject({ onHand: 3500, unitCost: 33000 })
      const [latest] = ledger(paneer.id)
      expect(latest).toMatchObject({
        type: 'STOCK_IN',
        quantity: 2500,
        balanceAfter: 3500,
        unitCost: 33000,
        createdBy: 'Olivia Owner'
      })
      expect(stockIn(paneer.id, 500).unitCost).toBe(33000)
    })

    it('records wastage with a reason and never takes out more than is there', async () => {
      const paneer = make({ openingStock: 2000 })
      const after = app.services.inventory.wastage(
        owner,
        wastageInputSchema.parse({ itemId: paneer.id, quantity: 750, reason: 'Spoiled' })
      )
      expect(after.onHand).toBe(1250)
      expect(ledger(paneer.id)[0]).toMatchObject({
        type: 'WASTAGE',
        quantity: -750,
        reason: 'Spoiled'
      })
      expect(
        await failureCode(() =>
          app.services.inventory.wastage(
            owner,
            wastageInputSchema.parse({ itemId: paneer.id, quantity: 2000, reason: 'Dropped' })
          )
        )
      ).toBe('CONFLICT')
      expect(item(paneer.id).onHand).toBe(1250)
    })

    it('books the difference of a stock count, and nothing when it matches', () => {
      const paneer = make({ openingStock: 5000 })
      const count = (counted: number) =>
        app.services.inventory.count(
          owner,
          stockCountInputSchema.parse({ itemId: paneer.id, counted })
        )
      expect(count(4200).onHand).toBe(4200)
      expect(ledger(paneer.id)[0]).toMatchObject({ type: 'ADJUSTMENT', quantity: -800 })
      expect(count(6000).onHand).toBe(6000)
      expect(ledger(paneer.id)[0]).toMatchObject({ type: 'ADJUSTMENT', quantity: 1800 })
      const before = ledger(paneer.id).length
      count(6000)
      expect(ledger(paneer.id)).toHaveLength(before)
    })

    it('keeps the ledger and the running total in agreement', () => {
      const paneer = make({ openingStock: 3000 })
      stockIn(paneer.id, 1250)
      app.services.inventory.wastage(
        owner,
        wastageInputSchema.parse({ itemId: paneer.id, quantity: 400, reason: 'Expired' })
      )
      app.services.inventory.count(owner, { itemId: paneer.id, counted: 3500, reason: null })
      const rows = ledger(paneer.id)
      expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(item(paneer.id).onHand)
      expect(rows[0]?.balanceAfter).toBe(item(paneer.id).onHand)
      // Oldest first, every balance follows the one before it.
      let running = 0
      for (const row of [...rows].reverse()) {
        running += row.quantity
        expect(row.balanceAfter).toBe(running)
      }
    })

    it('filters the ledger by item, type and time', () => {
      const a = make({ name: 'A', openingStock: 1000 })
      const b = make({ name: 'B', openingStock: 1000 })
      app.clock.advance(60_000)
      stockIn(a.id, 100)
      expect(ledger()).toHaveLength(3)
      expect(ledger(b.id)).toHaveLength(1)
      expect(
        app.services.inventory.movements(movementFilterSchema.parse({ types: ['STOCK_IN'] }))
      ).toHaveLength(1)
      const from = new Date(app.clock.now - 30_000).toISOString()
      expect(app.services.inventory.movements(movementFilterSchema.parse({ from }))).toHaveLength(1)
    })

    it('can never edit or delete a ledger row', () => {
      const paneer = make({ openingStock: 1000 })
      const row = app.handle.db.select().from(stockMovements).get()
      expect(row?.inventoryItemId).toBe(paneer.id)
      expect(() =>
        app.handle.db
          .update(stockMovements)
          .set({ quantity: 999999 })
          .where(eq(stockMovements.id, row?.id ?? ''))
          .run()
      ).toThrow(/cannot be changed/)
      expect(() => app.handle.db.delete(stockMovements).run()).toThrow(/cannot be deleted/)
      expect(app.handle.db.select().from(stockMovements).all()).toHaveLength(1)
    })

    it('writes every change to the audit log', () => {
      const paneer = make({ openingStock: 1000 })
      stockIn(paneer.id, 100)
      app.services.inventory.wastage(
        owner,
        wastageInputSchema.parse({ itemId: paneer.id, quantity: 50, reason: 'Spoiled' })
      )
      app.services.inventory.count(owner, { itemId: paneer.id, counted: 900, reason: null })
      app.services.inventory.setActive(owner, { id: paneer.id, isActive: false })
      expect(auditActions().sort()).toEqual([
        'inventory.item_created',
        'inventory.item_deactivated',
        'inventory.stock_counted',
        'inventory.stock_in',
        'inventory.wastage'
      ])
    })
  })

  describe('recipes', () => {
    it('sets, changes and clears the recipe of a menu item', () => {
      const paneer = make({ unitCost: 32000 })
      const cream = make({ name: 'Cream', unit: 'L', unitCost: 20000 })
      const dish = menuItem('Paneer Butter Masala')

      const first = recipe(dish.id, [
        { inventoryItemId: paneer.id, quantity: 150 },
        { inventoryItemId: cream.id, quantity: 50 }
      ])
      expect(first.scopes).toHaveLength(1)
      expect(first.scopes[0]).toMatchObject({ variantId: null, price: 24000, cost: 5800 })
      expect(first.scopes[0]?.lines.map((l) => [l.itemName, l.quantity, l.cost])).toEqual([
        ['Cream', 50, 1000],
        ['Paneer', 150, 4800]
      ])
      expect(item(paneer.id).usedInRecipes).toBe(1)

      const changed = recipe(dish.id, [{ inventoryItemId: paneer.id, quantity: 200 }])
      expect(changed.scopes[0]?.lines).toHaveLength(1)
      expect(changed.scopes[0]?.cost).toBe(6400)
      expect(item(cream.id).usedInRecipes).toBe(0)

      expect(recipe(dish.id, []).scopes[0]?.lines).toHaveLength(0)
      expect(auditActions().filter((a) => a === 'inventory.recipe_updated')).toHaveLength(3)
    })

    it('does not write an audit entry when nothing changed', () => {
      const paneer = make()
      const dish = menuItem('Tikka')
      recipe(dish.id, [{ inventoryItemId: paneer.id, quantity: 100 }])
      recipe(dish.id, [{ inventoryItemId: paneer.id, quantity: 100 }])
      expect(auditActions().filter((a) => a === 'inventory.recipe_updated')).toHaveLength(1)
    })

    it('keeps a recipe per size next to the shared one', () => {
      const chicken = make({ name: 'Chicken', unitCost: 20000 })
      const dish = menuItem('Chicken Biryani', {
        price: 18000,
        variants: [
          { name: 'Half', price: 18000, isDefault: true },
          { name: 'Full', price: 32000 }
        ]
      })
      const variants = app.services.items.list().find((i) => i.id === dish.id)?.variants ?? []
      const full = variants.find((v) => v.name === 'Full')
      const result = recipe(dish.id, [{ inventoryItemId: chicken.id, quantity: 400 }], full?.id)
      expect(result.scopes.map((s) => [s.variantName, s.lines.length])).toEqual([
        [null, 0],
        ['Half', 0],
        ['Full', 1]
      ])
      expect(result.scopes[2]).toMatchObject({ price: 32000, cost: 8000 })
    })

    it('refuses sizes of another item and unknown ingredients or items', async () => {
      const paneer = make()
      const dish = menuItem('Dish')
      const other = menuItem('Other', {
        variants: [{ name: 'Large', price: 30000, isDefault: true }]
      })
      const foreignVariant = app.services.items.list().find((i) => i.id === other.id)
        ?.variants[0]?.id
      expect(
        await failureCode(() =>
          Promise.resolve(
            recipe(dish.id, [{ inventoryItemId: paneer.id, quantity: 100 }], foreignVariant)
          )
        )
      ).toBe('NOT_FOUND')
      expect(
        await failureCode(() =>
          Promise.resolve(
            recipe(dish.id, [{ inventoryItemId: crypto.randomUUID(), quantity: 100 }])
          )
        )
      ).toBe('NOT_FOUND')
      expect(
        await failureCode(() =>
          Promise.resolve(
            recipe(crypto.randomUUID(), [{ inventoryItemId: paneer.id, quantity: 1 }])
          )
        )
      ).toBe('NOT_FOUND')
    })

    it('refuses to retire or delete an ingredient that a recipe still uses', async () => {
      const paneer = make()
      const dish = menuItem('Dish')
      recipe(dish.id, [{ inventoryItemId: paneer.id, quantity: 100 }])
      expect(
        await failureCode(() =>
          Promise.resolve(
            app.services.inventory.setActive(owner, { id: paneer.id, isActive: false })
          )
        )
      ).toBe('CONFLICT')
      expect(await failureCode(() => app.services.inventory.delete(owner, paneer.id))).toBe(
        'CONFLICT'
      )
      recipe(dish.id, [])
      expect(
        app.services.inventory.setActive(owner, { id: paneer.id, isActive: false }).isActive
      ).toBe(false)
      expect(
        await failureCode(() =>
          Promise.resolve(recipe(dish.id, [{ inventoryItemId: paneer.id, quantity: 100 }]))
        )
      ).toBe('CONFLICT')
    })

    it('lists every menu item with how many ingredients it has', () => {
      const paneer = make()
      const withRecipe = menuItem('Paneer Tikka')
      menuItem('Plain Naan')
      recipe(withRecipe.id, [{ inventoryItemId: paneer.id, quantity: 100 }])
      expect(
        app.services.recipes
          .coverage()
          .map((row) => [row.itemName, row.lineCount, row.categoryName])
      ).toEqual([
        ['Paneer Tikka', 1, 'Food'],
        ['Plain Naan', 0, 'Food']
      ])
    })
  })

  describe('using stock when food is sold', () => {
    let paneer: InventoryItem
    let cream: InventoryItem
    let dish: string

    beforeEach(() => {
      paneer = make({ openingStock: 10000, unitCost: 32000 })
      cream = make({ name: 'Cream', unit: 'L', openingStock: 2000, unitCost: 20000 })
      dish = menuItem('Paneer Butter Masala').id
      recipe(dish, [
        { inventoryItemId: paneer.id, quantity: 150 },
        { inventoryItemId: cream.id, quantity: 50 }
      ])
    })

    it('takes nothing out until the order is sent to the kitchen', () => {
      takeaway([line(dish, { quantity: 2 })])
      expect(item(paneer.id).onHand).toBe(10000)
    })

    it('takes out the recipe times the quantity when the order is sent', () => {
      const order = takeaway([line(dish, { quantity: 3 })])
      app.services.orders.send(owner, order.id)
      expect(item(paneer.id).onHand).toBe(10000 - 450)
      expect(item(cream.id).onHand).toBe(2000 - 150)
      expect(ledger(paneer.id)[0]).toMatchObject({
        type: 'CONSUMPTION',
        quantity: -450,
        unitCost: 32000,
        orderId: order.id,
        orderNumber: order.orderNumber
      })
    })

    it('uses stock only for the lines sent, each time they are sent', () => {
      const order = takeaway([line(dish)])
      app.services.orders.send(owner, order.id)
      app.services.orders.addItems(
        owner,
        addItemsInputSchema.parse({ orderId: order.id, lines: [line(dish, { quantity: 2 })] })
      )
      expect(item(paneer.id).onHand).toBe(10000 - 150)
      app.services.orders.send(owner, order.id)
      expect(item(paneer.id).onHand).toBe(10000 - 150 - 300)
    })

    it('uses the size recipe when there is one and the shared recipe otherwise', () => {
      const chicken = make({ name: 'Chicken', openingStock: 20000 })
      const rice = make({ name: 'Rice', openingStock: 20000 })
      const biryani = menuItem('Biryani', {
        price: 18000,
        variants: [
          { name: 'Half', price: 18000, isDefault: true },
          { name: 'Full', price: 32000 }
        ]
      })
      const variants = app.services.items.list().find((i) => i.id === biryani.id)?.variants ?? []
      const half = variants.find((v) => v.name === 'Half')
      const full = variants.find((v) => v.name === 'Full')
      recipe(biryani.id, [
        { inventoryItemId: chicken.id, quantity: 200 },
        { inventoryItemId: rice.id, quantity: 150 }
      ])
      recipe(biryani.id, [{ inventoryItemId: chicken.id, quantity: 450 }], full?.id)

      const order = takeaway([
        line(biryani.id, { variantId: half?.id }),
        line(biryani.id, { variantId: full?.id })
      ])
      app.services.orders.send(owner, order.id)
      // Half: shared recipe (200 chicken, 150 rice). Full: its own (450 chicken, no rice).
      expect(item(chicken.id).onHand).toBe(20000 - 200 - 450)
      expect(item(rice.id).onHand).toBe(20000 - 150)
    })

    it('uses no stock for a menu item without a recipe', () => {
      const naan = menuItem('Naan').id
      const order = takeaway([line(naan, { quantity: 4 })])
      app.services.orders.send(owner, order.id)
      expect(ledger().filter((row) => row.type === 'CONSUMPTION')).toHaveLength(0)
    })

    it('lets stock go below zero instead of blocking a sale, and flags it', () => {
      const order = takeaway([line(dish, { quantity: 20 })])
      const sent = app.services.orders.send(owner, order.id)
      expect(sent.status).toBe('CONFIRMED')
      expect(item(cream.id).onHand).toBe(2000 - 1000)
      const heavy = takeaway([line(dish, { quantity: 40 })])
      app.services.orders.send(owner, heavy.id)
      expect(item(cream.id).onHand).toBe(2000 - 1000 - 2000)
      expect(app.services.inventory.list({ lowOnly: true }).map((i) => i.id)).toContain(cream.id)
      expect(app.services.inventory.summary().outOfStockItems).toBe(1)
    })

    it('puts the stock back when a line is cancelled before cooking starts', () => {
      const order = takeaway([line(dish, { quantity: 2 }), line(menuItem('Naan').id)])
      const sent = app.services.orders.send(owner, order.id)
      expect(item(paneer.id).onHand).toBe(10000 - 300)
      app.services.orders.cancelLine(
        owner,
        cancelLineInputSchema.parse({
          orderId: order.id,
          lineId: sent.lines[0]?.id,
          reason: 'Guest changed mind'
        })
      )
      expect(item(paneer.id).onHand).toBe(10000)
      expect(item(cream.id).onHand).toBe(2000)
      expect(ledger(paneer.id)[0]).toMatchObject({
        type: 'CONSUMPTION_REVERSAL',
        quantity: 300
      })
    })

    it('does not put stock back once the cook has started', () => {
      const order = takeaway([line(dish, { quantity: 2 })])
      const sent = app.services.orders.send(owner, order.id)
      kitchenStep(order.id, 'ACCEPTED')
      kitchenStep(order.id, 'PREPARING')
      app.services.orders.cancelLine(
        owner,
        cancelLineInputSchema.parse({
          orderId: order.id,
          lineId: sent.lines[0]?.id,
          reason: 'Guest left'
        })
      )
      expect(item(paneer.id).onHand).toBe(10000 - 300)
      expect(ledger(paneer.id).filter((r) => r.type === 'CONSUMPTION_REVERSAL')).toHaveLength(0)
    })

    it('puts the stock back when the whole order is cancelled before cooking', () => {
      const order = takeaway([line(dish, { quantity: 2 })])
      app.services.orders.send(owner, order.id)
      app.services.orders.cancel(
        owner,
        cancelOrderInputSchema.parse({ id: order.id, reason: 'Customer called' })
      )
      expect(item(paneer.id).onHand).toBe(10000)
      expect(item(cream.id).onHand).toBe(2000)
    })

    it('keeps the stock used when an order is cancelled mid-cooking', () => {
      const order = takeaway([line(dish, { quantity: 2 })])
      app.services.orders.send(owner, order.id)
      kitchenStep(order.id, 'ACCEPTED')
      kitchenStep(order.id, 'PREPARING')
      app.services.orders.cancel(
        owner,
        cancelOrderInputSchema.parse({ id: order.id, reason: 'Customer called' })
      )
      expect(item(paneer.id).onHand).toBe(10000 - 300)
    })

    it('puts the stock back when a whole ticket is cancelled, once', () => {
      const order = takeaway([line(dish, { quantity: 2 })])
      app.services.orders.send(owner, order.id)
      const [kot] = app.services.kots.list({ orderId: order.id })
      app.services.kots.cancel(
        owner,
        cancelKotInputSchema.parse({ id: kot?.id, reason: 'Wrong table' })
      )
      expect(item(paneer.id).onHand).toBe(10000)
      // Cancelling the (already cancelled) order afterwards must not return it again.
      app.services.orders.cancel(
        owner,
        cancelOrderInputSchema.parse({ id: order.id, reason: 'Customer called' })
      )
      expect(item(paneer.id).onHand).toBe(10000)
      expect(ledger(paneer.id).filter((r) => r.type === 'CONSUMPTION_REVERSAL')).toHaveLength(1)
    })

    it('leaves the ledger and the totals in agreement through all of it', () => {
      const first = takeaway([line(dish, { quantity: 2 })])
      const second = takeaway([line(dish, { quantity: 5 })])
      app.services.orders.send(owner, first.id)
      app.services.orders.send(owner, second.id)
      app.services.orders.cancel(
        owner,
        cancelOrderInputSchema.parse({ id: first.id, reason: 'Customer called' })
      )
      for (const stock of [paneer, cream]) {
        const total = app.handle.db
          .select()
          .from(stockMovements)
          .where(eq(stockMovements.inventoryItemId, stock.id))
          .all()
          .reduce((sum, row) => sum + row.quantity, 0)
        const stored = app.handle.db
          .select()
          .from(inventoryItems)
          .where(eq(inventoryItems.id, stock.id))
          .get()
        expect(stored?.onHand).toBe(total)
      }
      expect(item(paneer.id).onHand).toBe(10000 - 750)
    })
  })

  describe('permissions', () => {
    it('adds the inventory permissions to the catalogue', () => {
      expect(PERMISSION_CODES).toEqual(
        expect.arrayContaining(['inventory.view', 'inventory.manage', 'inventory.operate'])
      )
    })
  })
})
