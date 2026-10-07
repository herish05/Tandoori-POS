import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import type { DbExecutor } from '../db/client'
import { diningTables, markModified, orderItems, orders } from '../db/schema'
import { AppError } from '../ipc/errors'
import { TABLE_STATUS_FOR_ORDER, type OrderStatus } from '@shared/orders'

export type OrderRow = typeof orders.$inferSelect

/**
 * Changes an order's status and makes its table show the matching state. The update is guarded
 * by the status the caller saw, so two terminals can never both move the same order.
 *
 * Shared by the order service and the kitchen ticket service, which moves an order along as its
 * tickets progress.
 */
export function moveOrderStatus(
  tx: DbExecutor,
  order: Pick<OrderRow, 'id' | 'status' | 'tableId'>,
  status: OrderStatus,
  extra: Partial<typeof orders.$inferInsert> = {}
): void {
  const result = tx
    .update(orders)
    .set({ ...extra, status, ...markModified(orders) })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
    .run()
  if (result.changes !== 1) {
    throw new AppError('CONFLICT', 'This order was just changed somewhere else. Reopen it.')
  }
  if (!order.tableId) return

  const target = TABLE_STATUS_FOR_ORDER[status]
  tx.update(diningTables)
    .set({
      status: target,
      ...(target === 'AVAILABLE' ? { openedAt: null, openedBy: null, guestCount: null } : {}),
      ...markModified(diningTables)
    })
    .where(eq(diningTables.id, order.tableId))
    .run()
}

/** Re-adds the live lines into the order's subtotal and bumps its version. */
export function refreshOrderSubtotal(tx: DbExecutor, orderId: string): number {
  const sum = tx
    .select({ total: sql<number>`coalesce(sum(${orderItems.lineTotal}), 0)` })
    .from(orderItems)
    .where(
      and(
        eq(orderItems.orderId, orderId),
        isNull(orderItems.deletedAt),
        ne(orderItems.status, 'CANCELLED')
      )
    )
    .get()
  const subtotal = sum?.total ?? 0
  tx.update(orders)
    .set({ subtotal, ...markModified(orders) })
    .where(eq(orders.id, orderId))
    .run()
  return subtotal
}
