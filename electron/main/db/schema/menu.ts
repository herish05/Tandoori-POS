import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import { ADDON_KINDS, FOOD_TYPES } from '../../../shared/menu'
import { baseColumns } from './common'
import { restaurants } from './auth'

/*
 * Menu tables. Every price column holds whole paise (1 rupee = 100 paise).
 * `is_demo` marks sample rows loaded on request (see menu/demo-service.ts); a normal
 * installation never contains any.
 */

/** A place in the kitchen that prepares food (tandoor, curry counter, bar...). */
export const kitchenStations = sqliteTable(
  'kitchen_stations',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    uniqueIndex('kitchen_stations_restaurant_name_unique')
      .on(table.restaurantId, table.name)
      .where(sql`${table.deletedAt} is null`)
  ]
)

export const categories = sqliteTable(
  'categories',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    /** Default station for the items in this category. */
    stationId: text('station_id').references(() => kitchenStations.id),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    uniqueIndex('categories_restaurant_name_unique')
      .on(table.restaurantId, table.name)
      .where(sql`${table.deletedAt} is null`)
  ]
)

export const taxCategories = sqliteTable(
  'tax_categories',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    /** Basis points: 500 = 5%. */
    rateBps: integer('rate_bps').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    uniqueIndex('tax_categories_restaurant_name_unique')
      .on(table.restaurantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    check('tax_categories_rate_check', sql`${table.rateBps} between 0 and 10000`)
  ]
)

export const menuItems = sqliteTable(
  'menu_items',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    name: text('name').notNull(),
    description: text('description'),
    price: integer('price').notNull(),
    costPrice: integer('cost_price').notNull().default(0),
    foodType: text('food_type', { enum: FOOD_TYPES }).notNull(),
    /** Small picture as a data URL, kept with the record so it syncs and backs up with it. */
    image: text('image'),
    /** Quick "sold out" switch. */
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
    /** Retired items stay in the database so past orders keep making sense. */
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isBestSeller: integer('is_best_seller', { mode: 'boolean' }).notNull().default(false),
    /** Overrides the category's station when set. */
    stationId: text('station_id').references(() => kitchenStations.id),
    taxCategoryId: text('tax_category_id').references(() => taxCategories.id),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    uniqueIndex('menu_items_category_name_unique')
      .on(table.categoryId, table.name)
      .where(sql`${table.deletedAt} is null`),
    index('menu_items_category_idx').on(table.categoryId),
    check('menu_items_price_check', sql`${table.price} >= 0 and ${table.costPrice} >= 0`)
  ]
)

/** A size or portion of an item ("Half", "Full", "Large") with its own price. */
export const menuVariants = sqliteTable(
  'menu_variants',
  {
    ...baseColumns(),
    menuItemId: text('menu_item_id')
      .notNull()
      .references(() => menuItems.id),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    costPrice: integer('cost_price').notNull().default(0),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0)
  },
  (table) => [
    uniqueIndex('menu_variants_item_name_unique')
      .on(table.menuItemId, table.name)
      .where(sql`${table.deletedAt} is null`),
    // At most one default variant per item.
    uniqueIndex('menu_variants_item_default_unique')
      .on(table.menuItemId)
      .where(sql`${table.deletedAt} is null and ${table.isDefault} = 1`),
    check('menu_variants_price_check', sql`${table.price} >= 0 and ${table.costPrice} >= 0`)
  ]
)

/** A priced extra (ADDON) or a free preference (MODIFIER) that items can offer. */
export const menuAddons = sqliteTable(
  'menu_addons',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: ADDON_KINDS }).notNull(),
    price: integer('price').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    uniqueIndex('menu_addons_restaurant_name_unique')
      .on(table.restaurantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    check(
      'menu_addons_price_check',
      sql`${table.price} >= 0 and (${table.kind} <> 'MODIFIER' or ${table.price} = 0)`
    )
  ]
)

/**
 * Which add-ons an item offers. These rows are part of the item (the item's version is bumped
 * whenever they change), so they carry no sync columns of their own.
 */
export const menuItemAddons = sqliteTable(
  'menu_item_addons',
  {
    menuItemId: text('menu_item_id')
      .notNull()
      .references(() => menuItems.id),
    addonId: text('addon_id')
      .notNull()
      .references(() => menuAddons.id),
    sortOrder: integer('sort_order').notNull().default(0)
  },
  (table) => [
    primaryKey({ columns: [table.menuItemId, table.addonId] }),
    index('menu_item_addons_addon_idx').on(table.addonId)
  ]
)
