import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { baseColumns } from './common'
import { restaurants } from './auth'

/** A person who orders from the restaurant. Phone is stored normalised (digits only). */
export const customers = sqliteTable(
  'customers',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    notes: text('notes')
  },
  (table) => [
    uniqueIndex('customers_restaurant_phone_unique')
      .on(table.restaurantId, table.phone)
      .where(sql`${table.deletedAt} is null`),
    index('customers_name_idx').on(table.name)
  ]
)

/** An address saved on a customer for deliveries. */
export const customerAddresses = sqliteTable(
  'customer_addresses',
  {
    ...baseColumns(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    label: text('label').notNull().default('Home'),
    address: text('address').notNull(),
    landmark: text('landmark'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [index('customer_addresses_customer_idx').on(table.customerId)]
)
