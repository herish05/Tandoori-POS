import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { CASH_ENTRY_KINDS } from '../../../shared/cash'
import { EXPENSE_PAYMENT_METHODS } from '../../../shared/expenses'
import { baseColumns } from './common'
import { restaurants, users } from './auth'

/*
 * Expenses and the cash drawer. Money is whole paise. Expenses can be corrected while they stand,
 * but a voided one is frozen. Cash entries are never edited: a wrong one is voided. Nothing here
 * is ever deleted (database triggers). The cash book itself is not stored; it is read from bill
 * payments, refunds, expenses, supplier payments and `cash_entries`.
 */

/** A heading expenses are filed under: Rent, Gas, Salaries... Managed by the restaurant. */
export const expenseCategories = sqliteTable(
  'expense_categories',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true)
  },
  (table) => [
    uniqueIndex('expense_categories_restaurant_name_unique')
      .on(table.restaurantId, table.name)
      .where(sql`${table.deletedAt} is null`)
  ]
)

/** Money spent that is not a stock purchase. */
export const expenses = sqliteTable(
  'expenses',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    expenseNumber: text('expense_number').notNull(),
    categoryId: text('category_id')
      .notNull()
      .references(() => expenseCategories.id),
    amount: integer('amount').notNull(),
    method: text('method', { enum: EXPENSE_PAYMENT_METHODS }).notNull(),
    payee: text('payee'),
    reference: text('reference'),
    notes: text('notes'),
    spentAt: integer('spent_at', { mode: 'timestamp_ms' }).notNull(),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => users.id),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    voidedBy: text('voided_by').references(() => users.id),
    voidReason: text('void_reason')
  },
  (table) => [
    uniqueIndex('expenses_restaurant_number_unique').on(table.restaurantId, table.expenseNumber),
    index('expenses_spent_at_idx').on(table.spentAt),
    index('expenses_category_idx').on(table.categoryId),
    check('expenses_amount_check', sql`${table.amount} > 0`)
  ]
)

/** A movement of cash in or out of the drawer that no bill, expense or supplier payment explains. */
export const cashEntries = sqliteTable(
  'cash_entries',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    kind: text('kind', { enum: CASH_ENTRY_KINDS }).notNull(),
    amount: integer('amount').notNull(),
    notes: text('notes'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => users.id),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    voidedBy: text('voided_by').references(() => users.id),
    voidReason: text('void_reason')
  },
  (table) => [
    index('cash_entries_occurred_at_idx').on(table.occurredAt),
    check('cash_entries_amount_check', sql`${table.amount} > 0`)
  ]
)
