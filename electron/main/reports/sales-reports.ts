import { and, asc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm'
import {
  billDiscounts,
  billItems,
  bills,
  billTaxes,
  categories,
  diningTables,
  menuItems,
  orderItems,
  orders,
  payments,
  refundLines,
  refunds
} from '../db/schema'
import { localDateString } from '../finance/dates'
import { DISCOUNT_TYPE_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@shared/billing'
import { ORDER_TYPE_LABELS } from '@shared/orders'
import type { ReportColumn } from '@shared/reports'
import {
  col,
  groupBy,
  item,
  iso,
  matchesSearch,
  shareBps,
  sum,
  userName,
  type ReportBody,
  type ReportContext
} from './context'

const money = (paise: number): string => (paise / 100).toFixed(2)

// --- Settled bills ------------------------------------------------------------------------------

interface SettledBill {
  id: string
  billNumber: string
  orderNumber: string
  orderType: keyof typeof ORDER_TYPE_LABELS
  tableNumber: string | null
  customerName: string | null
  subtotal: number
  discount: number
  serviceCharge: number
  otherCharges: number
  tax: number
  roundOff: number
  total: number
  refunded: number
  paidAt: Date
  createdBy: string
  methods: string
}

/** Settled bills (paid, or paid and since refunded) whose payment completed in the range. */
function settledConditions(ctx: ReportContext): SQL[] {
  const { filter } = ctx
  const conditions: SQL[] = [
    isNull(bills.deletedAt),
    inArray(bills.status, ['PAID', 'REFUNDED']),
    gte(bills.paidAt, ctx.from),
    lt(bills.paidAt, ctx.to)
  ]
  if (filter.orderType) conditions.push(eq(orders.type, filter.orderType))
  if (filter.staffId) conditions.push(eq(bills.createdBy, filter.staffId))
  if (filter.method) {
    conditions.push(
      sql`${bills.id} in (select ${payments.billId} from ${payments} where ${payments.method} = ${filter.method} and ${payments.deletedAt} is null)`
    )
  }
  return conditions
}

function loadSettledBills(ctx: ReportContext, withMethods: boolean): SettledBill[] {
  const conditions = settledConditions(ctx)
  const rows = ctx.db
    .select({
      id: bills.id,
      billNumber: bills.billNumber,
      orderNumber: orders.orderNumber,
      orderType: orders.type,
      tableNumber: diningTables.tableNumber,
      customerName: orders.customerName,
      subtotal: bills.subtotal,
      itemDiscount: bills.itemDiscountTotal,
      billDiscount: bills.billDiscountTotal,
      serviceCharge: bills.serviceCharge,
      deliveryCharge: bills.deliveryCharge,
      packagingCharge: bills.packagingCharge,
      tax: bills.taxTotal,
      roundOff: bills.roundOff,
      total: bills.grandTotal,
      refunded: bills.refundedTotal,
      paidAt: bills.paidAt,
      createdBy: bills.createdBy
    })
    .from(bills)
    .innerJoin(orders, eq(orders.id, bills.orderId))
    .leftJoin(diningTables, eq(diningTables.id, orders.tableId))
    .where(and(...conditions))
    .orderBy(asc(bills.paidAt), asc(bills.billNumber))
    .all()

  const methodsByBill = new Map<string, Set<string>>()
  if (withMethods) {
    const paid = ctx.db
      .select({ billId: payments.billId, method: payments.method })
      .from(payments)
      .innerJoin(bills, eq(bills.id, payments.billId))
      .innerJoin(orders, eq(orders.id, bills.orderId))
      .where(and(isNull(payments.deletedAt), ...conditions))
      .all()
    for (const row of paid) {
      const set = methodsByBill.get(row.billId) ?? new Set<string>()
      set.add(PAYMENT_METHOD_LABELS[row.method])
      methodsByBill.set(row.billId, set)
    }
  }

  return rows.map((row) => ({
    id: row.id,
    billNumber: row.billNumber,
    orderNumber: row.orderNumber,
    orderType: row.orderType,
    tableNumber: row.tableNumber,
    customerName: row.customerName,
    subtotal: row.subtotal,
    discount: row.itemDiscount + row.billDiscount,
    serviceCharge: row.serviceCharge,
    otherCharges: row.deliveryCharge + row.packagingCharge,
    tax: row.tax,
    roundOff: row.roundOff,
    total: row.total,
    refunded: row.refunded,
    paidAt: row.paidAt ?? ctx.from,
    createdBy: row.createdBy,
    methods: [...(methodsByBill.get(row.id) ?? [])].join(', ')
  }))
}

const SALES_FIGURES: ReportColumn[] = [
  col('subtotal', 'Subtotal', 'money', true),
  col('discount', 'Discounts', 'money', true),
  col('serviceCharge', 'Service charge', 'money', true),
  col('otherCharges', 'Delivery and packaging', 'money', true),
  col('tax', 'Tax', 'money', true),
  col('roundOff', 'Round off', 'money', true),
  col('total', 'Total', 'money', true),
  col('refunded', 'Refunded', 'money', true),
  col('net', 'Net sales', 'money', true)
]

interface Figures {
  subtotal: number
  discount: number
  serviceCharge: number
  otherCharges: number
  tax: number
  roundOff: number
  total: number
  refunded: number
  net: number
}

function figures(rows: readonly SettledBill[]): Figures {
  const total = sum(rows, (r) => r.total)
  const refunded = sum(rows, (r) => r.refunded)
  return {
    subtotal: sum(rows, (r) => r.subtotal),
    discount: sum(rows, (r) => r.discount),
    serviceCharge: sum(rows, (r) => r.serviceCharge),
    otherCharges: sum(rows, (r) => r.otherCharges),
    tax: sum(rows, (r) => r.tax),
    roundOff: sum(rows, (r) => r.roundOff),
    total,
    refunded,
    net: total - refunded
  }
}

function salesSummary(rows: readonly SettledBill[]): ReportBody['summary'] {
  const f = figures(rows)
  const total = f.total
  return [
    item('Bills', rows.length, 'int'),
    item('Sales', total, 'money'),
    item('Discounts', f.discount, 'money'),
    item('Tax', f.tax, 'money'),
    item('Refunded', f.refunded, 'money'),
    item('Net sales', f.net, 'money'),
    item('Average bill', rows.length > 0 ? Math.round(total / rows.length) : 0, 'money')
  ]
}

export function salesReport(ctx: ReportContext): ReportBody {
  const all = loadSettledBills(ctx, true)
  const bills_ = all.filter((b) =>
    matchesSearch(ctx.filter.search, b.billNumber, b.orderNumber, b.customerName)
  )
  return {
    summary: salesSummary(bills_),
    columns: [
      col('paidAt', 'Paid at', 'datetime'),
      col('billNumber', 'Bill', 'text'),
      col('orderNumber', 'Order', 'text'),
      col('orderType', 'Type', 'text'),
      col('table', 'Table', 'text'),
      col('customer', 'Customer', 'text'),
      col('methods', 'Paid by', 'text'),
      col('staff', 'Billed by', 'text'),
      ...SALES_FIGURES
    ],
    rows: bills_.map((b) => ({
      paidAt: iso(b.paidAt),
      billNumber: b.billNumber,
      orderNumber: b.orderNumber,
      orderType: ORDER_TYPE_LABELS[b.orderType],
      table: b.tableNumber,
      customer: b.customerName,
      methods: b.methods,
      staff: userName(ctx, b.createdBy),
      ...figures([b])
    }))
  }
}

export function dailySalesReport(ctx: ReportContext): ReportBody {
  const all = loadSettledBills(ctx, false)
  const days = groupBy(all, (b) => localDateString(b.paidAt))
  return {
    summary: salesSummary(all),
    columns: [col('date', 'Date', 'date'), col('bills', 'Bills', 'int', true), ...SALES_FIGURES],
    rows: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rows]) => ({ date, bills: rows.length, ...figures(rows) }))
  }
}

export function monthlySalesReport(ctx: ReportContext): ReportBody {
  const all = loadSettledBills(ctx, false)
  const months = groupBy(all, (b) => localDateString(b.paidAt).slice(0, 7))
  return {
    summary: salesSummary(all),
    columns: [col('month', 'Month', 'text'), col('bills', 'Bills', 'int', true), ...SALES_FIGURES],
    rows: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, rows]) => ({ month, bills: rows.length, ...figures(rows) }))
  }
}

// --- Items and categories -----------------------------------------------------------------------

interface SoldLine {
  itemName: string
  variantName: string | null
  categoryName: string
  quantity: number
  gross: number
  discount: number
}

const UNCATEGORISED = 'Uncategorised'

function loadSoldLines(ctx: ReportContext): SoldLine[] {
  const conditions = settledConditions(ctx)
  if (ctx.filter.categoryId) conditions.push(eq(menuItems.categoryId, ctx.filter.categoryId))
  return ctx.db
    .select({
      itemName: billItems.itemName,
      variantName: billItems.variantName,
      categoryName: categories.name,
      quantity: billItems.quantity,
      gross: billItems.gross,
      itemDiscount: billItems.itemDiscount,
      billDiscountShare: billItems.billDiscountShare
    })
    .from(billItems)
    .innerJoin(bills, eq(bills.id, billItems.billId))
    .innerJoin(orders, eq(orders.id, bills.orderId))
    .leftJoin(orderItems, eq(orderItems.id, billItems.orderItemId))
    .leftJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
    .leftJoin(categories, eq(categories.id, menuItems.categoryId))
    .where(and(isNull(billItems.deletedAt), ...conditions))
    .all()
    .map((row) => ({
      itemName: row.itemName,
      variantName: row.variantName,
      categoryName: row.categoryName ?? UNCATEGORISED,
      quantity: row.quantity,
      gross: row.gross,
      discount: row.itemDiscount + row.billDiscountShare
    }))
}

export function itemSalesReport(ctx: ReportContext): ReportBody {
  const lines = loadSoldLines(ctx).filter((l) => matchesSearch(ctx.filter.search, l.itemName))
  const netTotal = sum(lines, (l) => l.gross - l.discount)
  const groups = groupBy(lines, (l) => `${l.itemName}\u0000${l.variantName ?? ''}`)
  const rows = [...groups.values()]
    .map((group) => {
      const [first] = group
      const gross = sum(group, (l) => l.gross)
      const discount = sum(group, (l) => l.discount)
      const quantity = sum(group, (l) => l.quantity)
      return {
        item: first?.itemName ?? '',
        variant: first?.variantName ?? null,
        category: first?.categoryName ?? UNCATEGORISED,
        quantity,
        gross,
        discount,
        net: gross - discount,
        share: shareBps(gross - discount, netTotal),
        average: quantity > 0 ? Math.round((gross - discount) / quantity) : 0
      }
    })
    .sort((a, b) => b.quantity - a.quantity || b.net - a.net || a.item.localeCompare(b.item))
    .map((row, index) => ({ rank: index + 1, ...row }))
  return {
    summary: [
      item('Distinct items', rows.length, 'int'),
      item(
        'Quantity sold',
        sum(rows, (r) => r.quantity),
        'int'
      ),
      item('Net sales', netTotal, 'money'),
      item('Best seller', rows[0]?.item ?? 'None', 'text')
    ],
    columns: [
      col('rank', '#', 'int'),
      col('item', 'Item', 'text'),
      col('variant', 'Variant', 'text'),
      col('category', 'Category', 'text'),
      col('quantity', 'Quantity', 'int', true),
      col('gross', 'Sales', 'money', true),
      col('discount', 'Discounts', 'money', true),
      col('net', 'Net sales', 'money', true),
      col('share', 'Share', 'percent'),
      col('average', 'Average price', 'money')
    ],
    rows
  }
}

export function categorySalesReport(ctx: ReportContext): ReportBody {
  const lines = loadSoldLines(ctx)
  const netTotal = sum(lines, (l) => l.gross - l.discount)
  const groups = groupBy(lines, (l) => l.categoryName)
  const rows = [...groups.entries()]
    .map(([category, group]) => {
      const gross = sum(group, (l) => l.gross)
      const discount = sum(group, (l) => l.discount)
      return {
        category,
        items: new Set(group.map((l) => l.itemName)).size,
        quantity: sum(group, (l) => l.quantity),
        gross,
        discount,
        net: gross - discount,
        share: shareBps(gross - discount, netTotal)
      }
    })
    .sort((a, b) => b.net - a.net || a.category.localeCompare(b.category))
  return {
    summary: [
      item('Categories', rows.length, 'int'),
      item(
        'Quantity sold',
        sum(rows, (r) => r.quantity),
        'int'
      ),
      item('Net sales', netTotal, 'money'),
      item('Top category', rows[0]?.category ?? 'None', 'text')
    ],
    columns: [
      col('category', 'Category', 'text'),
      col('items', 'Items', 'int'),
      col('quantity', 'Quantity', 'int', true),
      col('gross', 'Sales', 'money', true),
      col('discount', 'Discounts', 'money', true),
      col('net', 'Net sales', 'money', true),
      col('share', 'Share', 'percent')
    ],
    rows
  }
}

// --- Payments -----------------------------------------------------------------------------------

export function paymentsReport(ctx: ReportContext): ReportBody {
  const { filter } = ctx
  const conditions: SQL[] = [
    isNull(payments.deletedAt),
    gte(payments.receivedAt, ctx.from),
    lt(payments.receivedAt, ctx.to)
  ]
  const method = PAYMENT_METHODS.find((m) => m === filter.method)
  if (method) conditions.push(eq(payments.method, method))
  if (filter.staffId) conditions.push(eq(payments.receivedBy, filter.staffId))
  const received = ctx.db
    .select({
      receivedAt: payments.receivedAt,
      billNumber: bills.billNumber,
      method: payments.method,
      amount: payments.amount,
      tendered: payments.tendered,
      reference: payments.reference,
      receivedBy: payments.receivedBy
    })
    .from(payments)
    .innerJoin(bills, eq(bills.id, payments.billId))
    .where(and(...conditions))
    .orderBy(asc(payments.receivedAt), asc(bills.billNumber))
    .all()
    .filter((p) => matchesSearch(filter.search, p.billNumber, p.reference))

  const refundConditions: SQL[] = [
    isNull(refunds.deletedAt),
    gte(refunds.refundedAt, ctx.from),
    lt(refunds.refundedAt, ctx.to)
  ]
  if (method) refundConditions.push(eq(refundLines.method, method))
  if (filter.staffId) refundConditions.push(eq(refunds.refundedBy, filter.staffId))
  const refunded = ctx.db
    .select({ method: refundLines.method, amount: refundLines.amount })
    .from(refundLines)
    .innerJoin(refunds, eq(refunds.id, refundLines.refundId))
    .where(and(...refundConditions))
    .all()

  const receivedTotal = sum(received, (p) => p.amount)
  const refundedTotal = sum(refunded, (r) => r.amount)
  const byMethod = PAYMENT_METHODS.filter((m) => !filter.method || m === filter.method).map(
    (method) =>
      item(
        `${PAYMENT_METHOD_LABELS[method]} received`,
        sum(
          received.filter((p) => p.method === method),
          (p) => p.amount
        ),
        'money'
      )
  )
  return {
    summary: [
      item('Payments', received.length, 'int'),
      ...byMethod,
      item('Received', receivedTotal, 'money'),
      item('Refunded', refundedTotal, 'money'),
      item('Net received', receivedTotal - refundedTotal, 'money')
    ],
    columns: [
      col('receivedAt', 'Received at', 'datetime'),
      col('billNumber', 'Bill', 'text'),
      col('method', 'Method', 'text'),
      col('reference', 'Reference', 'text'),
      col('tendered', 'Tendered', 'money'),
      col('amount', 'Amount', 'money', true),
      col('staff', 'Received by', 'text')
    ],
    rows: received.map((p) => ({
      receivedAt: iso(p.receivedAt),
      billNumber: p.billNumber,
      method: PAYMENT_METHOD_LABELS[p.method],
      reference: p.reference,
      tendered: p.tendered,
      amount: p.amount,
      staff: userName(ctx, p.receivedBy)
    }))
  }
}

// --- Tax ----------------------------------------------------------------------------------------

export function taxReport(ctx: ReportContext): ReportBody {
  const conditions = settledConditions(ctx)
  const lines = ctx.db
    .select({
      component: billTaxes.component,
      rateBps: billTaxes.rateBps,
      taxable: billTaxes.taxableAmount,
      tax: billTaxes.taxAmount
    })
    .from(billTaxes)
    .innerJoin(bills, eq(bills.id, billTaxes.billId))
    .innerJoin(orders, eq(orders.id, bills.orderId))
    .where(and(...conditions))
    .all()
  const rates = groupBy(lines, (l) => String(l.rateBps))
  const rows = [...rates.entries()]
    .map(([rate, group]) => {
      const component = (name: string): number =>
        sum(
          group.filter((l) => l.component === name),
          (l) => l.tax
        )
      const cgst = component('CGST')
      const sgst = component('SGST')
      const igst = component('IGST')
      return {
        rate: Number(rate),
        // Each rate's taxable value is on both its CGST and SGST lines, so count it once.
        taxable: sum(
          group.filter((l) => l.component !== 'SGST'),
          (l) => l.taxable
        ),
        cgst,
        sgst,
        igst,
        tax: cgst + sgst + igst
      }
    })
    .sort((a, b) => a.rate - b.rate)
  return {
    summary: [
      item(
        'Taxable value',
        sum(rows, (r) => r.taxable),
        'money'
      ),
      item(
        'CGST',
        sum(rows, (r) => r.cgst),
        'money'
      ),
      item(
        'SGST',
        sum(rows, (r) => r.sgst),
        'money'
      ),
      item(
        'IGST',
        sum(rows, (r) => r.igst),
        'money'
      ),
      item(
        'Total tax',
        sum(rows, (r) => r.tax),
        'money'
      )
    ],
    columns: [
      col('rate', 'GST rate', 'percent'),
      col('taxable', 'Taxable value', 'money', true),
      col('cgst', 'CGST', 'money', true),
      col('sgst', 'SGST', 'money', true),
      col('igst', 'IGST', 'money', true),
      col('tax', 'Total tax', 'money', true)
    ],
    rows
  }
}

// --- Discounts ----------------------------------------------------------------------------------

export function discountsReport(ctx: ReportContext): ReportBody {
  const conditions = settledConditions(ctx)
  const lines = ctx.db
    .select({
      paidAt: bills.paidAt,
      billNumber: bills.billNumber,
      scope: billDiscounts.scope,
      itemName: billItems.itemName,
      type: billDiscounts.type,
      value: billDiscounts.value,
      amount: billDiscounts.amount,
      reason: billDiscounts.reason,
      appliedBy: billDiscounts.appliedBy
    })
    .from(billDiscounts)
    .innerJoin(bills, eq(bills.id, billDiscounts.billId))
    .innerJoin(orders, eq(orders.id, bills.orderId))
    .leftJoin(billItems, eq(billItems.id, billDiscounts.billItemId))
    .where(and(isNull(billDiscounts.deletedAt), ...conditions))
    .orderBy(asc(bills.paidAt), asc(bills.billNumber))
    .all()
    .filter((l) => matchesSearch(ctx.filter.search, l.billNumber, l.reason))
  const total = sum(lines, (l) => l.amount)
  return {
    summary: [
      item('Discounts given', lines.length, 'int'),
      item('Total discounted', total, 'money'),
      item('Bills discounted', new Set(lines.map((l) => l.billNumber)).size, 'int')
    ],
    columns: [
      col('paidAt', 'Paid at', 'datetime'),
      col('billNumber', 'Bill', 'text'),
      col('scope', 'Applied to', 'text'),
      col('type', 'Kind', 'text'),
      col('given', 'Given as', 'text'),
      col('amount', 'Amount', 'money', true),
      col('reason', 'Reason', 'text'),
      col('staff', 'Given by', 'text')
    ],
    rows: lines.map((l) => ({
      paidAt: iso(l.paidAt),
      billNumber: l.billNumber,
      scope: l.scope === 'ITEM' ? (l.itemName ?? 'Item') : 'Whole bill',
      type: DISCOUNT_TYPE_LABELS[l.type],
      given: l.type === 'PERCENTAGE' ? `${String(l.value / 100)}%` : money(l.value),
      amount: l.amount,
      reason: l.reason,
      staff: userName(ctx, l.appliedBy)
    }))
  }
}

// --- Staff --------------------------------------------------------------------------------------

export function staffSalesReport(ctx: ReportContext): ReportBody {
  const all = loadSettledBills(ctx, false)
  const staff = groupBy(all, (b) => b.createdBy)

  const cancelledBy = (rows: { by: string | null }[]): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (row.by) counts.set(row.by, (counts.get(row.by) ?? 0) + 1)
    }
    return counts
  }
  const cancelledBills = cancelledBy(
    ctx.db
      .select({ by: bills.cancelledBy })
      .from(bills)
      .innerJoin(orders, eq(orders.id, bills.orderId))
      .where(
        and(
          isNull(bills.deletedAt),
          eq(bills.status, 'CANCELLED'),
          gte(bills.cancelledAt, ctx.from),
          lt(bills.cancelledAt, ctx.to),
          ctx.filter.orderType ? eq(orders.type, ctx.filter.orderType) : undefined
        )
      )
      .all()
  )
  const cancelledOrders = cancelledBy(
    ctx.db
      .select({ by: orders.cancelledBy })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          eq(orders.status, 'CANCELLED'),
          gte(orders.cancelledAt, ctx.from),
          lt(orders.cancelledAt, ctx.to),
          ctx.filter.orderType ? eq(orders.type, ctx.filter.orderType) : undefined
        )
      )
      .all()
  )

  const ids = new Set([...staff.keys(), ...cancelledBills.keys(), ...cancelledOrders.keys()])
  const rows = [...ids]
    .map((id) => {
      const mine = staff.get(id) ?? []
      const f = figures(mine)
      return {
        staff: userName(ctx, id),
        bills: mine.length,
        total: f.total,
        discount: f.discount,
        refunded: f.refunded,
        net: f.net,
        average: mine.length > 0 ? Math.round(f.total / mine.length) : 0,
        cancelledBills: cancelledBills.get(id) ?? 0,
        cancelledOrders: cancelledOrders.get(id) ?? 0
      }
    })
    .sort((a, b) => b.net - a.net || String(a.staff).localeCompare(String(b.staff)))
  return {
    summary: [
      item('Team members', rows.length, 'int'),
      item('Bills', all.length, 'int'),
      item(
        'Net sales',
        sum(rows, (r) => r.net),
        'money'
      ),
      item('Top biller', rows[0]?.staff ?? 'None', 'text')
    ],
    columns: [
      col('staff', 'Team member', 'text'),
      col('bills', 'Bills', 'int', true),
      col('total', 'Sales', 'money', true),
      col('discount', 'Discounts', 'money', true),
      col('refunded', 'Refunded', 'money', true),
      col('net', 'Net sales', 'money', true),
      col('average', 'Average bill', 'money'),
      col('cancelledBills', 'Bills cancelled', 'int', true),
      col('cancelledOrders', 'Orders cancelled', 'int', true)
    ],
    rows
  }
}
