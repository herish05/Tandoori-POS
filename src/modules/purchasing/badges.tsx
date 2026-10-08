import {
  PAYMENT_STATUS_LABELS,
  PURCHASE_STATUS_LABELS,
  type PurchaseStatus,
  type PurchasePaymentStatus
} from '@shared/purchasing'
import { Badge } from '@/components/ui/badge'

/** The purchase's lifecycle state as a badge. */
export function purchaseStatusBadge(purchase: { status: PurchaseStatus }) {
  const variant =
    purchase.status === 'RECEIVED'
      ? 'success'
      : purchase.status === 'CANCELLED'
        ? 'destructive'
        : 'warning'
  return <Badge variant={variant}>{PURCHASE_STATUS_LABELS[purchase.status]}</Badge>
}

/** How much of a received purchase is paid; nothing for drafts and cancelled purchases. */
export function paymentStatusBadge(purchase: { paymentStatus: PurchasePaymentStatus }) {
  if (purchase.paymentStatus === 'NOT_DUE') return null
  const variant =
    purchase.paymentStatus === 'PAID'
      ? 'success'
      : purchase.paymentStatus === 'PARTIAL'
        ? 'warning'
        : 'destructive'
  return <Badge variant={variant}>{PAYMENT_STATUS_LABELS[purchase.paymentStatus]}</Badge>
}
