import { ORDER_TYPE_LABELS } from '@shared/orders'
import {
  BILL_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type BillDetail,
  type BillItem,
  type TaxComponent
} from '@shared/billing'
import { formatTicketTime, type TicketLine } from './kot-template'

/**
 * The bill or receipt as a printed page. The same page is handed over before payment (a bill)
 * and after it (a receipt); the title follows the bill's status. Like the kitchen ticket it is
 * built as `TicketLine`s, so the preview and every printer show the same thing.
 */

export interface ReceiptRestaurant {
  name: string
  legalName: string | null
  address: string
  city: string
  state: string
  phone: string
  gstin: string | null
  footer: string | null
}

export interface ReceiptInput {
  restaurant: ReceiptRestaurant
  timezone: string
  bill: BillDetail
  /** 0 for the original; 1 and up are duplicates and say so on the paper. */
  copyNumber: number
}

/** 123456 paise -> "1,234.56": Indian digit grouping (12,34,567.89), no currency symbol. */
export function formatPrintAmount(paise: number): string {
  const negative = paise < 0
  const abs = Math.abs(paise)
  const whole = String(Math.floor(abs / 100))
  const fraction = String(abs % 100).padStart(2, '0')
  const head = whole.length > 3 ? whole.slice(0, -3) : ''
  const tail = whole.slice(-3)
  const grouped = head.length > 0 ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail
  return `${negative ? '-' : ''}${grouped}.${fraction}`
}

/** 250 bps -> "2.5", 1800 bps -> "18". */
const formatPercent = (bps: number): string =>
  String(bps / 100)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')

const TITLES: Record<BillDetail['status'], string> = {
  PENDING: 'BILL',
  PARTIAL: 'BILL - PART PAID',
  PAID: 'RECEIPT',
  REFUNDED: 'RECEIPT - REFUNDED',
  CANCELLED: '*** CANCELLED BILL ***'
}

const dishName = (item: BillItem): string =>
  item.variantName ? `${item.name} (${item.variantName})` : item.name

const money = (label: string, paise: number, bold = false): TicketLine => ({
  text: label,
  right: formatPrintAmount(paise),
  bold
})

const COMPONENT_LABELS: Record<TaxComponent, string> = {
  CGST: 'CGST',
  SGST: 'SGST',
  IGST: 'IGST'
}

function describePlace(bill: BillDetail): string {
  if (bill.orderType === 'DINE_IN') return `Table ${bill.tableNumber ?? '?'}`
  return ORDER_TYPE_LABELS[bill.orderType]
}

/** What the bill's state was at the time of printing; used to tell duplicates apart. */
export function receiptState(bill: BillDetail): string {
  return `${bill.status}|${String(bill.grandTotal)}|${String(bill.paidTotal)}|${String(bill.refundedTotal)}`
}

export function describeReceiptState(state: string): string {
  const status = state.split('|')[0]
  const found = Object.entries(BILL_STATUS_LABELS).find(([code]) => code === status)
  return found ? found[1] : 'Unknown'
}

export function buildReceipt(input: ReceiptInput): TicketLine[] {
  const { bill, restaurant } = input
  const lines: TicketLine[] = [{ text: restaurant.name, align: 'center', bold: true, large: true }]
  if (restaurant.legalName && restaurant.legalName !== restaurant.name) {
    lines.push({ text: restaurant.legalName, align: 'center' })
  }
  lines.push({ text: restaurant.address, align: 'center' })
  lines.push({ text: `${restaurant.city}, ${restaurant.state}`, align: 'center' })
  lines.push({ text: `Ph: ${restaurant.phone}`, align: 'center' })
  if (restaurant.gstin) lines.push({ text: `GSTIN: ${restaurant.gstin}`, align: 'center' })
  lines.push({ text: '', rule: true })

  lines.push({ text: TITLES[bill.status], align: 'center', bold: true })
  if (restaurant.gstin && bill.status !== 'CANCELLED') {
    lines.push({ text: 'TAX INVOICE', align: 'center' })
  }
  if (input.copyNumber > 0) {
    lines.push({
      text: `** DUPLICATE COPY ${String(input.copyNumber)} **`,
      align: 'center',
      bold: true
    })
  }
  lines.push({ text: '', rule: true })

  lines.push({ label: 'Bill', text: bill.billNumber })
  lines.push({ label: 'Order', text: bill.orderNumber })
  lines.push({ label: 'For', text: describePlace(bill) })
  if (bill.customerName) lines.push({ label: 'Customer', text: bill.customerName })
  lines.push({ label: 'Date', text: formatTicketTime(bill.createdAt, input.timezone) })
  lines.push({ label: 'Cashier', text: bill.createdByName })
  lines.push({ text: '', rule: true })

  lines.push({ text: 'Item', right: 'Amount', bold: true })
  for (const item of bill.items) {
    lines.push({
      text: `${String(item.quantity)} x ${dishName(item)}`,
      right: formatPrintAmount(item.gross),
      hang: 4
    })
    if (item.quantity > 1) {
      lines.push({ text: `@ ${formatPrintAmount(item.unitPrice)} each`, indent: 4 })
    }
  }
  lines.push({ text: '', rule: true })

  lines.push(money('Subtotal', bill.subtotal))
  const discounts = bill.itemDiscountTotal + bill.billDiscountTotal
  if (discounts > 0) lines.push(money('Discount', -discounts))
  if (bill.serviceCharge > 0) {
    lines.push(money(`Service charge ${formatPercent(bill.serviceChargeBps)}%`, bill.serviceCharge))
  }
  for (const tax of bill.taxes) {
    const shown = tax.component === 'IGST' ? tax.rateBps : tax.rateBps / 2
    lines.push(money(`${COMPONENT_LABELS[tax.component]} ${formatPercent(shown)}%`, tax.taxAmount))
  }
  if (bill.roundOff !== 0) lines.push(money('Round off', bill.roundOff))
  lines.push({ text: '', rule: true, heavy: true })
  lines.push({
    text: 'TOTAL',
    right: formatPrintAmount(bill.grandTotal),
    bold: true,
    large: false
  })
  lines.push({ text: '', rule: true, heavy: true })

  if (bill.payments.length > 0) {
    lines.push({ text: 'Paid by', bold: true })
    for (const payment of bill.payments) {
      const label = PAYMENT_METHOD_LABELS[payment.method]
      lines.push(
        money(payment.reference ? `${label} (${payment.reference})` : label, payment.amount)
      )
    }
    const change = bill.payments.reduce((sum, payment) => sum + payment.change, 0)
    if (change > 0) lines.push(money('Change given', change))
  }
  if (bill.refunds.length > 0) {
    lines.push({ text: '', rule: true })
    lines.push({ text: 'Refunds', bold: true })
    for (const refund of bill.refunds) {
      lines.push(money(refund.refundNumber, -refund.amount))
      lines.push({
        text: refund.lines.map((line) => PAYMENT_METHOD_LABELS[line.method]).join(', '),
        indent: 2,
        hang: 2
      })
    }
    lines.push(money('Net paid', bill.paidTotal - bill.refundedTotal, true))
  }
  if (bill.status === 'PARTIAL' || bill.status === 'PENDING') {
    if (bill.balance > 0) lines.push(money('BALANCE DUE', bill.balance, true))
  }
  if (bill.status === 'CANCELLED' && bill.cancelReason) {
    lines.push({ text: `Reason: ${bill.cancelReason}`, hang: 8 })
  }

  lines.push({ text: '', rule: true })
  lines.push({
    text:
      restaurant.footer && restaurant.footer.trim().length > 0
        ? restaurant.footer
        : 'Thank you. Visit again!',
    align: 'center'
  })
  return lines
}
