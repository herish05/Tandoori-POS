import type { BillStatus } from '@shared/billing'

type BadgeTone = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

/** Badge colour for each bill status. */
export const BILL_STATUS_TONE: Record<BillStatus, BadgeTone> = {
  PENDING: 'warning',
  PARTIAL: 'default',
  PAID: 'success',
  REFUNDED: 'secondary',
  CANCELLED: 'destructive'
}
