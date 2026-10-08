import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { CashCount, DaySummary } from '../../../shared/day-closing'
import { baseColumns } from './common'
import { restaurants, users } from './auth'
import { cashEntries } from './expenses'

/*
 * Day closings. A closing freezes what one business day (a local calendar day, `YYYY-MM-DD`) took
 * and paid out, with the cash counted against the cash the book expected. Rows are never deleted
 * or rewritten (database triggers); reopening a day only stamps who reopened it and why, and a
 * new closing can follow. Only one closing per day may stand (not reopened) at a time.
 */
export const dayClosings = sqliteTable(
  'day_closings',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    closingNumber: text('closing_number').notNull(),
    businessDate: text('business_date').notNull(),
    /** Bills settled and what they came to, kept as columns so the history needs no parsing. */
    billCount: integer('bill_count').notNull().default(0),
    salesTotal: integer('sales_total').notNull().default(0),
    /** The whole frozen summary of the day. */
    summary: text('summary', { mode: 'json' }).$type<DaySummary>().notNull(),
    expectedCash: integer('expected_cash').notNull(),
    countedCash: integer('counted_cash').notNull(),
    /** Counted minus expected. */
    variance: integer('variance').notNull(),
    denominations: text('denominations', { mode: 'json' }).$type<CashCount[]>().notNull(),
    notes: text('notes'),
    adjustmentEntryId: text('adjustment_entry_id').references(() => cashEntries.id),
    closedAt: integer('closed_at', { mode: 'timestamp_ms' }).notNull(),
    closedBy: text('closed_by')
      .notNull()
      .references(() => users.id),
    reopenedAt: integer('reopened_at', { mode: 'timestamp_ms' }),
    reopenedBy: text('reopened_by').references(() => users.id),
    reopenReason: text('reopen_reason')
  },
  (table) => [
    uniqueIndex('day_closings_restaurant_number_unique').on(
      table.restaurantId,
      table.closingNumber
    ),
    // One standing closing per day; a reopened one makes room for the next.
    uniqueIndex('day_closings_standing_unique')
      .on(table.restaurantId, table.businessDate)
      .where(sql`${table.reopenedAt} is null and ${table.deletedAt} is null`),
    index('day_closings_date_idx').on(table.businessDate),
    check('day_closings_counted_check', sql`${table.countedCash} >= 0`),
    check(
      'day_closings_variance_check',
      sql`${table.variance} = ${table.countedCash} - ${table.expectedCash}`
    )
  ]
)
