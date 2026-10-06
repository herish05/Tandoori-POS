import type { OrderStatus } from '@shared/orders'

type BadgeTone = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

/** Badge colour for each order status, shared by the order screen and the orders list. */
export const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  DRAFT: 'secondary',
  CONFIRMED: 'default',
  KOT_PENDING: 'warning',
  PREPARING: 'warning',
  READY: 'success',
  SERVED: 'success',
  BILL_REQUESTED: 'warning',
  COMPLETED: 'secondary',
  CANCELLED: 'destructive'
}
