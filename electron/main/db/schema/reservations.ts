import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { RESERVATION_STATUSES } from '../../../shared/reservations'
import { baseColumns } from './common'
import { restaurants, users } from './auth'
import { customers } from './customers'
import { diningTables } from './tables'

/** A table booking. Guest name and phone are kept as typed so the booking stands on its own. */
export const reservations = sqliteTable(
  'reservations',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    customerId: text('customer_id').references(() => customers.id),
    guestName: text('guest_name').notNull(),
    guestPhone: text('guest_phone').notNull(),
    partySize: integer('party_size').notNull(),
    reservedFor: integer('reserved_for', { mode: 'timestamp_ms' }).notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(90),
    /** The table held for the booking; may be left open until the guests arrive. */
    tableId: text('table_id').references(() => diningTables.id),
    status: text('status', { enum: RESERVATION_STATUSES }).notNull().default('BOOKED'),
    notes: text('notes'),
    seatedAt: integer('seated_at', { mode: 'timestamp_ms' }),
    seatedBy: text('seated_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    cancelledBy: text('cancelled_by').references(() => users.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id)
  },
  (table) => [
    index('reservations_time_idx').on(table.reservedFor),
    index('reservations_table_idx').on(table.tableId),
    index('reservations_customer_idx').on(table.customerId),
    check('reservations_party_check', sql`${table.partySize} between 1 and 50`),
    check('reservations_duration_check', sql`${table.durationMinutes} between 30 and 360`)
  ]
)
