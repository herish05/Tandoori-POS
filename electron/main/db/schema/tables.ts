import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { TABLE_STATUSES, TABLE_TYPES } from '../../../shared/tables'
import { baseColumns } from './common'
import { restaurants, users } from './auth'

/** A dining room, floor, terrace or other zone that groups tables. */
export const areas = sqliteTable(
  'areas',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    floor: text('floor'),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true)
  },
  (table) => [
    uniqueIndex('areas_restaurant_name_unique')
      .on(table.restaurantId, table.name)
      .where(sql`${table.deletedAt} is null`)
  ]
)

export const diningTables = sqliteTable(
  'dining_tables',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    areaId: text('area_id')
      .notNull()
      .references(() => areas.id),
    tableNumber: text('table_number').notNull(),
    displayName: text('display_name').notNull(),
    capacity: integer('capacity').notNull(),
    type: text('type', { enum: TABLE_TYPES }).notNull(),
    status: text('status', { enum: TABLE_STATUSES }).notNull().default('AVAILABLE'),
    /** Grid cell in the area's floor plan (0,0 is top-left). */
    positionX: integer('position_x').notNull().default(0),
    positionY: integer('position_y').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    /** Set while guests are seated. */
    openedAt: integer('opened_at', { mode: 'timestamp_ms' }),
    openedBy: text('opened_by').references(() => users.id),
    guestCount: integer('guest_count')
  },
  (table) => [
    uniqueIndex('dining_tables_restaurant_number_unique')
      .on(table.restaurantId, table.tableNumber)
      .where(sql`${table.deletedAt} is null`),
    // One table per cell, among the tables that are in use.
    uniqueIndex('dining_tables_cell_unique')
      .on(table.areaId, table.positionX, table.positionY)
      .where(sql`${table.deletedAt} is null and ${table.isActive} = 1`),
    index('dining_tables_area_idx').on(table.areaId),
    check('dining_tables_capacity_check', sql`${table.capacity} between 1 and 50`)
  ]
)
