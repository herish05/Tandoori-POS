import { TABLE_STATUSES, type TableStatus } from '@shared/tables'

export { TABLE_STATUSES, type TableStatus }

interface TableStatusMeta {
  label: string
  /** Full class names (not interpolated) so Tailwind can detect them. */
  swatch: string
  card: string
}

/** Visual language for table states, shared by the table card, legend and layout editor. */
export const TABLE_STATUS_META: Record<TableStatus, TableStatusMeta> = {
  AVAILABLE: {
    label: 'Available',
    swatch: 'bg-table-available ring-1 ring-table-available-ink/40',
    card: 'bg-table-available text-table-available-ink border-dashed border-table-available-ink/40'
  },
  RESERVED: {
    label: 'Reserved',
    swatch: 'bg-table-reserved',
    card: 'bg-table-reserved text-table-reserved-ink'
  },
  OCCUPIED: {
    label: 'Occupied',
    swatch: 'bg-table-occupied',
    card: 'bg-table-occupied text-table-occupied-ink'
  },
  KOT_PENDING: {
    label: 'KOT pending',
    swatch: 'bg-table-kot',
    card: 'bg-table-kot text-table-kot-ink'
  },
  PREPARING: {
    label: 'Preparing',
    swatch: 'bg-table-preparing',
    card: 'bg-table-preparing text-table-preparing-ink'
  },
  READY: {
    label: 'Ready',
    swatch: 'bg-table-ready',
    card: 'bg-table-ready text-table-ready-ink'
  },
  BILL_REQUESTED: {
    label: 'Bill requested',
    swatch: 'bg-table-bill',
    card: 'bg-table-bill text-table-bill-ink'
  },
  PAYMENT_PENDING: {
    label: 'Payment pending',
    swatch: 'bg-table-payment',
    card: 'bg-table-payment text-table-payment-ink'
  },
  PAID: {
    label: 'Paid',
    swatch: 'bg-table-paid',
    card: 'bg-table-paid text-table-paid-ink'
  },
  BLOCKED: {
    label: 'Blocked',
    swatch: 'bg-table-blocked',
    card: 'bg-table-blocked text-table-blocked-ink'
  }
}
