import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { TABLE_OPERATION_KINDS } from '../../../shared/table-ops'
import { baseColumns } from './common'
import { restaurants, users } from './auth'
import { orders } from './orders'
import { diningTables } from './tables'

/*
 * The record of table operations. A row is written once, in the same transaction as the move,
 * and never changed or deleted (triggers in drizzle/0008 enforce that). A MERGE row is also the
 * permission slip that lets the kitchen tickets of the closed order be re-pointed at the order
 * that carries on: no other change of a ticket's order is allowed.
 */
export const tableOperations = sqliteTable(
  'table_operations',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    kind: text('kind', { enum: TABLE_OPERATION_KINDS }).notNull(),
    /** The order that carries on: the shifted order, or the one the other was merged into. */
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    /** MERGE only: the order that was folded in and closed. */
    sourceOrderId: text('source_order_id').references(() => orders.id),
    fromTableId: text('from_table_id')
      .notNull()
      .references(() => diningTables.id),
    toTableId: text('to_table_id')
      .notNull()
      .references(() => diningTables.id),
    movedLines: integer('moved_lines').notNull().default(0),
    movedTickets: integer('moved_tickets').notNull().default(0),
    performedBy: text('performed_by')
      .notNull()
      .references(() => users.id),
    performedAt: integer('performed_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [
    index('table_operations_order_idx').on(table.orderId),
    index('table_operations_source_idx').on(table.sourceOrderId),
    check(
      'table_operations_kind_check',
      sql`(${table.kind} = 'MERGE') = (${table.sourceOrderId} is not null)`
    )
  ]
)
