import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import {
  createAddonInputSchema,
  createCategoryInputSchema,
  createItemInputSchema,
  createStationInputSchema,
  createTaxCategoryInputSchema,
  itemFilterSchema,
  updateItemInputSchema,
  type CreateItemInput,
  type ItemFilterInput,
  type MenuItem
} from '@shared/menu'
import { withImpliedPermissions, type PermissionCode } from '@shared/permissions'
import type { AuthContext } from '@main/auth/types'
import { menuItems, menuVariants } from '@main/db/schema'
import { DEMO_ITEMS } from '@main/menu/demo-data'
import { createServices } from '@main/services'
import {
  completeSetup,
  createTestApp,
  failureCode,
  loginAsOwner,
  silentLogger,
  type TestApp
} from './helpers'

const STAFF_PASSWORD = 'Biryani-2026'

describe('menu management', () => {
  let app: TestApp
  let owner: AuthContext

  const makeStation = (name: string) =>
    app.services.stations.create(owner, createStationInputSchema.parse({ name }))
  const makeCategory = (name: string, extra: Record<string, unknown> = {}) =>
    app.services.categories.create(owner, createCategoryInputSchema.parse({ name, ...extra }))
  const makeTax = (name: string, rateBps: number) =>
    app.services.taxCategories.create(owner, createTaxCategoryInputSchema.parse({ name, rateBps }))
  const makeAddon = (name: string, kind: 'ADDON' | 'MODIFIER' = 'ADDON', price = 0) =>
    app.services.addons.create(owner, createAddonInputSchema.parse({ name, kind, price }))
  const makeItem = (categoryId: string, name: string, extra: Partial<CreateItemInput> = {}) =>
    app.services.items.create(
      owner,
      createItemInputSchema.parse({
        categoryId,
        name,
        price: 25000,
        foodType: 'VEG',
        ...extra
      })
    )
  const find = (filter: ItemFilterInput): string[] =>
    app.services.items.list(itemFilterSchema.parse(filter)).map((item) => item.name)
  const names = (items: MenuItem[]) => items.map((item) => item.name)

  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('validation', () => {
    const base = { categoryId: crypto.randomUUID(), name: 'Dal', price: 1000, foodType: 'VEG' }

    it('rejects bad prices, food types, names and variant sets', () => {
      expect(createItemInputSchema.safeParse(base).success).toBe(true)
      for (const patch of [
        { price: -1 },
        { price: 10.5 },
        { price: 10_000_001 },
        { price: Number.NaN },
        { foodType: 'VEGAN' },
        { name: '   ' },
        { image: 'http://example.com/x.png' },
        { image: 'data:text/html;base64,AAAA' },
        {
          variants: [
            { name: 'Half', price: 100 },
            { name: 'half', price: 200 }
          ]
        },
        {
          variants: [
            { name: 'Half', price: 100, isDefault: true },
            { name: 'Full', price: 200, isDefault: true }
          ]
        },
        { addonIds: [base.categoryId, base.categoryId] }
      ]) {
        expect(createItemInputSchema.safeParse({ ...base, ...patch }).success).toBe(false)
      }
    })

    it('fills in the defaults and blanks optional text', () => {
      const parsed = createItemInputSchema.parse({ ...base, description: '  ' })
      expect(parsed).toMatchObject({
        description: null,
        costPrice: 0,
        isAvailable: true,
        isBestSeller: false,
        stationId: null,
        taxCategoryId: null,
        image: null,
        variants: [],
        addonIds: []
      })
    })

    it('keeps modifiers free and bounds tax rates', () => {
      expect(
        createAddonInputSchema.safeParse({ name: 'Less spicy', kind: 'MODIFIER', price: 500 })
          .success
      ).toBe(false)
      expect(
        createAddonInputSchema.safeParse({ name: 'Cheese', kind: 'ADDON', price: 500 }).success
      ).toBe(true)
      expect(createTaxCategoryInputSchema.safeParse({ name: 'X', rateBps: 10_001 }).success).toBe(
        false
      )
      expect(createTaxCategoryInputSchema.safeParse({ name: 'X', rateBps: 12.5 }).success).toBe(
        false
      )
      expect(createTaxCategoryInputSchema.safeParse({ name: 'X', rateBps: 0 }).success).toBe(true)
    })
  })

  describe('stations, categories, taxes and add-ons', () => {
    it('starts with nothing: no data is hard-coded', () => {
      expect(app.services.stations.list()).toEqual([])
      expect(app.services.categories.list()).toEqual([])
      expect(app.services.taxCategories.list()).toEqual([])
      expect(app.services.addons.list()).toEqual([])
      expect(app.services.items.list()).toEqual([])
      expect(app.services.demoMenu.status()).toMatchObject({ loaded: false, itemCount: 0 })
    })

    it('creates, edits and lists each kind, refusing duplicate names ignoring case', async () => {
      const station = makeStation('Tandoor')
      const category = makeCategory('Starters', { stationId: station.id, sortOrder: 2 })
      const tax = makeTax('Food 5%', 500)
      const addon = makeAddon('Extra cheese', 'ADDON', 3000)

      expect(category).toMatchObject({
        stationId: station.id,
        stationName: 'Tandoor',
        itemCount: 0
      })
      expect(tax.rateBps).toBe(500)
      expect(addon).toMatchObject({ kind: 'ADDON', price: 3000 })

      expect(await failureCode(() => makeStation('tandoor'))).toBe('CONFLICT')
      expect(await failureCode(() => makeCategory('STARTERS'))).toBe('CONFLICT')
      expect(await failureCode(() => makeTax('food 5%', 600))).toBe('CONFLICT')
      expect(await failureCode(() => makeAddon('extra CHEESE'))).toBe('CONFLICT')

      const renamed = app.services.categories.update(owner, {
        id: category.id,
        name: 'Tandoori starters',
        description: null,
        sortOrder: 1,
        stationId: null
      })
      expect(renamed).toMatchObject({ name: 'Tandoori starters', stationId: null, sortOrder: 1 })
      // The same name is fine once its old owner has been renamed.
      expect(makeCategory('Starters').name).toBe('Starters')

      const updatedAddon = app.services.addons.update(owner, {
        id: addon.id,
        name: 'Extra cheese',
        kind: 'ADDON',
        price: 3500
      })
      expect(updatedAddon.price).toBe(3500)
    })

    it('turns an add-on into a free modifier only when the price is zero', async () => {
      const addon = makeAddon('Spice', 'ADDON', 1000)
      expect(
        createAddonInputSchema.safeParse({ name: 'Spice', kind: 'MODIFIER', price: 1000 }).success
      ).toBe(false)
      const modifier = app.services.addons.update(owner, {
        id: addon.id,
        name: 'Spice',
        kind: 'MODIFIER',
        price: 0
      })
      expect(modifier).toMatchObject({ kind: 'MODIFIER', price: 0 })
      expect(
        await failureCode(() =>
          app.services.addons.setActive(owner, { id: crypto.randomUUID(), isActive: false })
        )
      ).toBe('NOT_FOUND')
    })

    it('protects stations that are in use and categories that hold items', async () => {
      const station = makeStation('Bar')
      const category = makeCategory('Drinks', { stationId: station.id })
      expect(app.services.stations.list()[0]?.usageCount).toBe(1)

      expect(
        await failureCode(() =>
          app.services.stations.setActive(owner, { id: station.id, isActive: false })
        )
      ).toBe('CONFLICT')
      expect(
        await failureCode(() => {
          app.services.stations.delete(owner, station.id)
        })
      ).toBe('CONFLICT')

      makeItem(category.id, 'Coke')
      expect(
        await failureCode(() => {
          app.services.categories.delete(owner, category.id)
        })
      ).toBe('CONFLICT')
      // Deactivating the category is allowed and keeps its items.
      expect(
        app.services.categories.setActive(owner, { id: category.id, isActive: false }).itemCount
      ).toBe(1)
      // An inactive station cannot be chosen for new work.
      const empty = makeStation('Spare')
      app.services.stations.setActive(owner, { id: empty.id, isActive: false })
      expect(await failureCode(() => makeCategory('More', { stationId: empty.id }))).toBe(
        'CONFLICT'
      )

      // Once nothing uses it, the station can go.
      app.services.categories.update(owner, {
        id: category.id,
        name: 'Drinks',
        description: null,
        sortOrder: 0,
        stationId: null
      })
      app.services.stations.delete(owner, station.id)
      expect(app.services.stations.list().map((s) => s.name)).toEqual(['Spare'])
    })

    it('protects tax categories that items use', async () => {
      const tax = makeTax('Food 5%', 500)
      const category = makeCategory('Main')
      makeItem(category.id, 'Dal', { taxCategoryId: tax.id })
      expect(app.services.taxCategories.list()[0]?.itemCount).toBe(1)
      expect(
        await failureCode(() => {
          app.services.taxCategories.delete(owner, tax.id)
        })
      ).toBe('CONFLICT')
      const off = app.services.taxCategories.setActive(owner, { id: tax.id, isActive: false })
      expect(off.isActive).toBe(false)
      // The item keeps its tax; new items cannot pick an inactive one.
      expect(app.services.items.list()[0]?.taxCategoryName).toBe('Food 5%')
      expect(
        await failureCode(() => makeItem(category.id, 'Raita', { taxCategoryId: tax.id }))
      ).toBe('CONFLICT')
    })
  })

  describe('items', () => {
    it('creates an item with all its fields and resolves the station from its category', () => {
      const tandoor = makeStation('Tandoor')
      const bar = makeStation('Bar')
      const tax = makeTax('Food 5%', 500)
      const category = makeCategory('Starters', { stationId: tandoor.id })
      const cheese = makeAddon('Extra cheese', 'ADDON', 3000)
      const spicy = makeAddon('Less spicy', 'MODIFIER')

      const tikka = makeItem(category.id, 'Paneer Tikka', {
        description: 'Grilled cottage cheese',
        price: 26000,
        costPrice: 11000,
        foodType: 'VEG',
        isBestSeller: true,
        taxCategoryId: tax.id,
        addonIds: [spicy.id, cheese.id]
      })
      expect(tikka).toMatchObject({
        name: 'Paneer Tikka',
        categoryName: 'Starters',
        price: 26000,
        costPrice: 11000,
        isAvailable: true,
        isActive: true,
        isBestSeller: true,
        stationId: null,
        effectiveStationId: tandoor.id,
        effectiveStationName: 'Tandoor',
        taxCategoryName: 'Food 5%',
        taxRateBps: 500
      })
      // Add-ons keep the order they were chosen in.
      expect(tikka.addons.map((a) => a.name)).toEqual(['Less spicy', 'Extra cheese'])

      const mocktail = makeItem(category.id, 'Mocktail', { stationId: bar.id, foodType: 'VEG' })
      expect(mocktail).toMatchObject({ stationId: bar.id, effectiveStationName: 'Bar' })

      const loose = makeItem(makeCategory('Misc').id, 'Papad')
      expect(loose.effectiveStationId).toBeNull()
      expect(app.services.categories.list().find((c) => c.id === category.id)?.itemCount).toBe(2)
    })

    it('supports veg, non-veg and egg, and refuses duplicates within a category only', async () => {
      const starters = makeCategory('Starters')
      const mains = makeCategory('Main course')
      makeItem(starters.id, 'Tikka', { foodType: 'NON_VEG' })
      makeItem(mains.id, 'Curry', { foodType: 'EGG' })
      expect(await failureCode(() => makeItem(starters.id, 'tikka'))).toBe('CONFLICT')
      expect(makeItem(mains.id, 'Tikka').categoryName).toBe('Main course')
      expect(
        app.services.items
          .list()
          .map((i) => i.foodType)
          .sort()
      ).toEqual(['EGG', 'NON_VEG', 'VEG'])
    })

    it('uses the default variant for the item price', () => {
      const category = makeCategory('Main')
      const item = makeItem(category.id, 'Butter Chicken', {
        price: 1,
        variants: [
          { name: 'Half', price: 28000, costPrice: 12000 },
          { name: 'Full', price: 48000, costPrice: 21000, isDefault: true }
        ]
      })
      expect(item.price).toBe(48000)
      expect(item.costPrice).toBe(21000)
      expect(item.variants.map((v) => [v.name, v.isDefault])).toEqual([
        ['Half', false],
        ['Full', true]
      ])

      // No explicit default: the first variant becomes it.
      const other = makeItem(category.id, 'Dal', {
        variants: [
          { name: 'Small', price: 10000 },
          { name: 'Large', price: 15000 }
        ]
      })
      expect(other.price).toBe(10000)
      expect(other.variants[0]?.isDefault).toBe(true)
    })

    it('rejects an inactive category and unknown references', async () => {
      const category = makeCategory('Main')
      app.services.categories.setActive(owner, { id: category.id, isActive: false })
      expect(await failureCode(() => makeItem(category.id, 'Dal'))).toBe('CONFLICT')
      const fresh = makeCategory('Fresh')
      expect(
        await failureCode(() => makeItem(fresh.id, 'Dal', { stationId: crypto.randomUUID() }))
      ).toBe('NOT_FOUND')
      expect(
        await failureCode(() => makeItem(fresh.id, 'Dal', { addonIds: [crypto.randomUUID()] }))
      ).toBe('NOT_FOUND')
      expect(await failureCode(() => makeItem(crypto.randomUUID(), 'Dal'))).toBe('NOT_FOUND')
    })

    it('edits an item, keeps variant identity, and swaps names and defaults safely', () => {
      const category = makeCategory('Main')
      const cheese = makeAddon('Extra cheese', 'ADDON', 3000)
      const item = makeItem(category.id, 'Dal Makhani', {
        variants: [
          { name: 'Half', price: 16000, isDefault: true },
          { name: 'Full', price: 22000 }
        ]
      })
      const [half, full] = item.variants
      if (!half || !full) throw new Error('variants missing')

      const swapped = app.services.items.update(
        owner,
        updateItemInputSchema.parse({
          id: item.id,
          categoryId: category.id,
          name: 'Dal Makhani',
          price: 0,
          foodType: 'VEG',
          addonIds: [cheese.id],
          // Names swap and the default moves, in one save.
          variants: [
            { id: half.id, name: 'Full', price: 22000, isDefault: false },
            { id: full.id, name: 'Half', price: 16000, isDefault: true },
            { name: 'Quarter', price: 9000 }
          ]
        })
      )
      expect(swapped.variants.map((v) => [v.id === half.id, v.name, v.isDefault])).toEqual([
        [true, 'Full', false],
        [false, 'Half', true],
        [false, 'Quarter', false]
      ])
      expect(swapped.price).toBe(16000)
      expect(swapped.addons.map((a) => a.name)).toEqual(['Extra cheese'])

      // Dropping variants retires them and falls back to the item's own price.
      const plain = app.services.items.update(
        owner,
        updateItemInputSchema.parse({
          id: item.id,
          categoryId: category.id,
          name: 'Dal Makhani',
          price: 20000,
          foodType: 'VEG',
          addonIds: [],
          variants: []
        })
      )
      expect(plain.variants).toEqual([])
      expect(plain.addons).toEqual([])
      expect(plain.price).toBe(20000)
      const stored = app.handle.db
        .select()
        .from(menuVariants)
        .where(eq(menuVariants.menuItemId, item.id))
        .all()
      expect(stored).toHaveLength(3)
      expect(stored.every((row) => row.deletedAt !== null && !row.isDefault)).toBe(true)
    })

    it('refuses variants that belong to another item and bumps the version only on change', async () => {
      const category = makeCategory('Main')
      const a = makeItem(category.id, 'A', { variants: [{ name: 'S', price: 100 }] })
      const b = makeItem(category.id, 'B')
      const stolen = a.variants[0]
      if (!stolen) throw new Error('variant missing')
      expect(
        await failureCode(() =>
          app.services.items.update(
            owner,
            updateItemInputSchema.parse({
              id: b.id,
              categoryId: category.id,
              name: 'B',
              price: 25000,
              foodType: 'VEG',
              variants: [{ id: stolen.id, name: 'S', price: 100 }]
            })
          )
        )
      ).toBe('NOT_FOUND')

      const version = () =>
        app.handle.db.select().from(menuItems).where(eq(menuItems.id, b.id)).get()?.version
      const before = version()
      const same = updateItemInputSchema.parse({
        id: b.id,
        categoryId: category.id,
        name: 'B',
        price: 25000,
        foodType: 'VEG'
      })
      app.services.items.update(owner, same)
      expect(version()).toBe(before)
      app.services.items.update(owner, { ...same, price: 26000 })
      expect(version()).toBe((before ?? 0) + 1)
    })

    it('moves an item to another category, refusing a name clash there', async () => {
      const starters = makeCategory('Starters')
      const mains = makeCategory('Main')
      const item = makeItem(starters.id, 'Tikka')
      makeItem(mains.id, 'Tikka')
      const move = updateItemInputSchema.parse({
        id: item.id,
        categoryId: mains.id,
        name: 'Tikka',
        price: 25000,
        foodType: 'VEG'
      })
      expect(await failureCode(() => app.services.items.update(owner, move))).toBe('CONFLICT')
      expect(
        app.services.items.update(owner, { ...move, name: 'Tikka platter' }).categoryName
      ).toBe('Main')
    })

    it('toggles availability and activity independently, then deletes softly', () => {
      const category = makeCategory('Main')
      const item = makeItem(category.id, 'Dal')
      expect(
        app.services.items.setAvailability(owner, { id: item.id, isAvailable: false })
      ).toMatchObject({ isAvailable: false, isActive: true })
      expect(app.services.items.setActive(owner, { id: item.id, isActive: false })).toMatchObject({
        isAvailable: false,
        isActive: false
      })
      app.services.items.delete(owner, item.id)
      expect(app.services.items.list()).toEqual([])
      const row = app.handle.db.select().from(menuItems).where(eq(menuItems.id, item.id)).get()
      expect(row?.deletedAt).not.toBeNull()
      // The name is free again.
      expect(makeItem(category.id, 'Dal').name).toBe('Dal')
    })

    it('removes a deleted add-on from every item that offered it', () => {
      const category = makeCategory('Main')
      const addon = makeAddon('Extra butter', 'ADDON', 2000)
      const keep = makeAddon('Less spicy', 'MODIFIER')
      const item = makeItem(category.id, 'Dal', { addonIds: [addon.id, keep.id] })
      expect(app.services.addons.list().find((a) => a.id === addon.id)?.itemCount).toBe(1)
      app.services.addons.delete(owner, addon.id)
      expect(
        app.services.items
          .list()
          .find((i) => i.id === item.id)
          ?.addons.map((a) => a.name)
      ).toEqual(['Less spicy'])
    })
  })

  describe('search and filters', () => {
    beforeEach(() => {
      const starters = makeCategory('Starters', { sortOrder: 1 })
      const mains = makeCategory('Main course', { sortOrder: 2 })
      const drinks = makeCategory('Beverages', { sortOrder: 3 })
      makeItem(starters.id, 'Paneer Tikka', { foodType: 'VEG', isBestSeller: true })
      makeItem(starters.id, 'Chicken Tikka', { foodType: 'NON_VEG', description: 'Smoky' })
      makeItem(mains.id, 'Egg Curry', { foodType: 'EGG' })
      makeItem(mains.id, '100% Pure Ghee Dal', { foodType: 'VEG' })
      const coke = makeItem(drinks.id, 'Coke', { foodType: 'VEG' })
      app.services.items.setAvailability(owner, { id: coke.id, isAvailable: false })
      const old = makeItem(drinks.id, 'Old Soda', { foodType: 'VEG' })
      app.services.items.setActive(owner, { id: old.id, isActive: false })
    })

    it('lists in menu order: category order, then name', () => {
      expect(find({})).toEqual([
        'Chicken Tikka',
        'Paneer Tikka',
        '100% Pure Ghee Dal',
        'Egg Curry',
        'Coke',
        'Old Soda'
      ])
    })

    it('searches names, descriptions and category names, ignoring case', () => {
      expect(find({ search: 'tikka' })).toEqual(['Chicken Tikka', 'Paneer Tikka'])
      expect(find({ search: 'SMOKY' })).toEqual(['Chicken Tikka'])
      expect(find({ search: 'beverages' })).toEqual(['Coke', 'Old Soda'])
      expect(find({ search: 'nothing here' })).toEqual([])
    })

    it('treats % and _ in the search as plain characters', () => {
      expect(find({ search: '100%' })).toEqual(['100% Pure Ghee Dal'])
      expect(find({ search: '%' })).toEqual(['100% Pure Ghee Dal'])
      expect(find({ search: '_' })).toEqual([])
    })

    it('filters by category, food type, availability, status and best seller, and combines them', () => {
      const starters = app.services.categories.list().find((c) => c.name === 'Starters')
      expect(find({ categoryId: starters?.id })).toEqual(['Chicken Tikka', 'Paneer Tikka'])
      expect(find({ foodType: 'EGG' })).toEqual(['Egg Curry'])
      expect(find({ foodType: 'NON_VEG' })).toEqual(['Chicken Tikka'])
      expect(find({ availability: 'UNAVAILABLE' })).toEqual(['Coke'])
      expect(find({ availability: 'AVAILABLE' })).toHaveLength(5)
      expect(find({ status: 'INACTIVE' })).toEqual(['Old Soda'])
      expect(find({ status: 'ACTIVE' })).toHaveLength(5)
      expect(find({ bestSellerOnly: true })).toEqual(['Paneer Tikka'])
      expect(find({ categoryId: starters?.id, foodType: 'VEG', search: 'tikka' })).toEqual([
        'Paneer Tikka'
      ])
    })
  })

  describe('sample menu', () => {
    it('loads a flagged sample menu on request, with variants, add-ons and stations', () => {
      const status = app.services.demoMenu.load(owner)
      expect(status).toMatchObject({ available: true, loaded: true, itemCount: DEMO_ITEMS.length })

      const items = app.services.items.list()
      expect(items.every((item) => item.isDemo)).toBe(true)
      expect(names(items)).toEqual(
        expect.arrayContaining(['Butter Chicken', 'Paneer Tikka', 'Coke'])
      )
      const butter = items.find((item) => item.name === 'Butter Chicken')
      expect(butter?.variants.map((v) => v.name)).toEqual(['Half', 'Full'])
      expect(butter?.effectiveStationName).toBe('Curry counter')
      expect(butter?.addons.map((a) => a.kind)).toContain('MODIFIER')
      expect(new Set(items.map((item) => item.foodType))).toEqual(
        new Set(['VEG', 'NON_VEG', 'EGG'])
      )
      expect(app.services.stations.list().every((s) => s.isDemo)).toBe(true)
    })

    it('refuses to load twice, or into a menu that already has real data', async () => {
      app.services.demoMenu.load(owner)
      expect(await failureCode(() => app.services.demoMenu.load(owner))).toBe('CONFLICT')
      app.services.demoMenu.remove(owner)

      makeCategory('Our own category')
      expect(await failureCode(() => app.services.demoMenu.load(owner))).toBe('CONFLICT')
    })

    it('removes only the sample rows and keeps real data built on them', () => {
      app.services.demoMenu.load(owner)
      const mains = app.services.categories.list().find((c) => c.name === 'Main course')
      if (!mains) throw new Error('sample category missing')
      const own = makeItem(mains.id, 'House Special', { stationId: mains.stationId })

      const result = app.services.demoMenu.remove(owner)
      expect(result.removedItems).toBe(DEMO_ITEMS.length)
      // "Main course" (and its station) now hold a real item, so they stay as real data.
      expect(result.keptAsReal).toBeGreaterThanOrEqual(2)
      expect(names(app.services.items.list())).toEqual([own.name])
      expect(app.services.categories.list().map((c) => [c.name, c.isDemo])).toEqual([
        ['Main course', false]
      ])
      expect(app.services.stations.list().every((s) => !s.isDemo)).toBe(true)
      expect(app.services.addons.list()).toEqual([])
      expect(app.services.taxCategories.list()).toEqual([])
      expect(app.services.demoMenu.status().itemCount).toBe(0)
    })

    it('removes everything when nothing real depends on it, so the menu is empty again', () => {
      app.services.demoMenu.load(owner)
      app.services.demoMenu.remove(owner)
      expect(app.services.items.list()).toEqual([])
      expect(app.services.categories.list()).toEqual([])
      expect(app.services.stations.list()).toEqual([])
      expect(app.services.demoMenu.status().loaded).toBe(false)
      // And it can be loaded again.
      expect(app.services.demoMenu.load(owner).loaded).toBe(true)
    })

    it('is never available in a production build', async () => {
      const production = createServices({
        db: app.handle.db,
        deviceId: 'test-device',
        logger: silentLogger,
        securityLogger: silentLogger,
        allowDemoData: false
      })
      expect(production.demoMenu.status()).toMatchObject({ available: false, loaded: false })
      expect(await failureCode(() => production.demoMenu.load(owner))).toBe('NOT_AVAILABLE')
      expect(await failureCode(() => production.demoMenu.remove(owner))).toBe('NOT_AVAILABLE')
      expect(production.items.list()).toEqual([])
    })
  })

  describe('persistence and audit', () => {
    it('survives a restart', () => {
      const station = makeStation('Tandoor')
      const category = makeCategory('Starters', { stationId: station.id })
      const addon = makeAddon('Extra cheese', 'ADDON', 3000)
      makeItem(category.id, 'Paneer Tikka', {
        variants: [
          { name: 'Half', price: 15000 },
          { name: 'Full', price: 26000, isDefault: true }
        ],
        addonIds: [addon.id]
      })
      const restarted = app.restart()
      const [item] = restarted.items.list()
      expect(item).toMatchObject({
        name: 'Paneer Tikka',
        price: 26000,
        effectiveStationName: 'Tandoor'
      })
      expect(item?.variants).toHaveLength(2)
      expect(item?.addons.map((a) => a.name)).toEqual(['Extra cheese'])
    })

    it('records who changed the menu, without storing the picture', () => {
      const category = makeCategory('Main')
      const item = makeItem(category.id, 'Dal', { price: 10000 })
      const png =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      app.services.items.update(owner, {
        ...updateItemInputSchema.parse({
          id: item.id,
          categoryId: category.id,
          name: 'Dal',
          price: 12000,
          foodType: 'VEG',
          image: png
        })
      })
      app.services.items.setAvailability(owner, { id: item.id, isAvailable: false })

      const page = app.services.audit.list({ page: 1, pageSize: 50, actionPrefix: 'menu.' })
      const actions = page.items.map((entry) => entry.action)
      expect(actions).toEqual(
        expect.arrayContaining([
          'menu.category.created',
          'menu.item.created',
          'menu.item.updated',
          'menu.item.sold_out'
        ])
      )
      const updated = page.items.find((entry) => entry.action === 'menu.item.updated')
      expect(updated?.details).toMatchObject({ changedFields: ['price', 'image'] })
      expect(JSON.stringify(page.items)).not.toContain('iVBOR')
    })
  })

  describe('permissions', () => {
    const makeRole = (name: string, permissions: PermissionCode[]) =>
      app.services.roles.create(owner, createRoleInputSchema.parse({ name, permissions }))

    const signInAs = async (username: string, roleIds: string[]): Promise<void> => {
      await app.services.users.create(
        owner,
        createStaffInputSchema.parse({
          username,
          password: STAFF_PASSWORD,
          fullName: `Staff ${username}`,
          roleIds
        })
      )
      app.services.auth.logout()
      await app.services.auth.login({ username, password: STAFF_PASSWORD })
      const ctx = app.services.auth.authorize([], { allowPasswordChange: true })
      await app.services.auth.changePassword(ctx, {
        currentPassword: STAFF_PASSWORD,
        newPassword: 'Fresh-Password-9',
        confirmPassword: 'Fresh-Password-9'
      })
    }

    it('gives the OWNER the menu permissions; manage implies view and operate', () => {
      const ownerRole = app.services.roles.list().find((r) => r.name === 'OWNER')
      expect(ownerRole?.permissions).toEqual(
        expect.arrayContaining(['menu.view', 'menu.manage', 'menu.operate'])
      )
      expect(withImpliedPermissions(['menu.manage'])).toEqual([
        'menu.view',
        'menu.manage',
        'menu.operate'
      ])
      expect(withImpliedPermissions(['menu.operate'])).toEqual(['menu.view', 'menu.operate'])
      expect(makeRole('Menu editor', ['menu.manage']).permissions).toEqual([
        'menu.view',
        'menu.manage',
        'menu.operate'
      ])
    })

    it('lets a cashier mark items sold out but not edit the menu; a viewer can only look', async () => {
      const cashier = makeRole('Cashier', ['pos.access', 'menu.operate'])
      const viewer = makeRole('Viewer', ['pos.access', 'menu.view'])

      await signInAs('cashier1', [cashier.id])
      expect(app.services.auth.authorize(['menu.operate']).username).toBe('cashier1')
      expect(app.services.auth.authorize(['menu.view']).username).toBe('cashier1')
      expect(await failureCode(() => app.services.auth.authorize(['menu.manage']))).toBe(
        'FORBIDDEN'
      )

      await signInAs('viewer1', [viewer.id])
      expect(app.services.auth.authorize(['menu.view']).username).toBe('viewer1')
      expect(await failureCode(() => app.services.auth.authorize(['menu.operate']))).toBe(
        'FORBIDDEN'
      )
      expect(await failureCode(() => app.services.auth.authorize(['menu.manage']))).toBe(
        'FORBIDDEN'
      )
    })
  })
})
