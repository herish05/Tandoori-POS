import { and, asc, between, eq, gte, isNull, lt, type SQL } from 'drizzle-orm'
import {
  dayClosings,
  expenseCategories,
  expenses,
  inventoryItems,
  purchases,
  stockMovements,
  supplierPayments,
  suppliers
} from '../db/schema'
import { EXPENSE_PAYMENT_LABELS, EXPENSE_PAYMENT_METHODS } from '@shared/expenses'
import { QUANTITY_SCALE, UNIT_LABELS } from '@shared/inventory'
import { PURCHASE_STATUS_LABELS, PURCHASE_STATUSES } from '@shared/purchasing'
import {
  col,
  groupBy,
  item,
  iso,
  matchesSearch,
  sum,
  userName,
  type ReportBody,
  type ReportContext
} from './context'

// --- Inventory ----------------------------------------------------------------------------------

export function inventoryReport(ctx: ReportContext): ReportBody {
  const { filter } = ctx
  const stock = ctx.db
    .select()
    .from(inventoryItems)
    .where(isNull(inventoryItems.deletedAt))
    .orderBy(asc(inventoryItems.name))
    .all()

  const movements = ctx.db
    .select({
      itemId: stockMovements.inventoryItemId,
      type: stockMovements.type,
      quantity: stockMovements.quantity
    })
    .from(stockMovements)
    .where(
      and(
        isNull(stockMovements.deletedAt),
        gte(stockMovements.createdAt, ctx.from),
        lt(stockMovements.createdAt, ctx.to)
      )
    )
    .all()
  const byItem = groupBy(movements, (m) => m.itemId)

  const rows = stock
    .filter((s) => {
      if (filter.status === 'INACTIVE') return !s.isActive
      if (!s.isActive) return false
      if (filter.status === 'OUT') return s.onHand <= 0
      if (filter.status === 'LOW') return s.onHand > 0 && s.onHand <= s.reorderLevel
      return true
    })
    .filter((s) => matchesSearch(filter.search, s.name, s.category))
    .map((s) => {
      const mine = byItem.get(s.id) ?? []
      const amount = (types: readonly string[]): number =>
        sum(
          mine.filter((m) => types.includes(m.type)),
          (m) => m.quantity
        )
      const stockStatus = !s.isActive
        ? 'Inactive'
        : s.onHand <= 0
          ? 'Out of stock'
          : s.onHand <= s.reorderLevel
            ? 'Low stock'
            : 'In stock'
      return {
        name: s.name,
        category: s.category,
        unit: UNIT_LABELS[s.unit],
        onHand: s.onHand,
        reorderLevel: s.reorderLevel,
        unitCost: s.unitCost,
        value: Math.round((Math.max(0, s.onHand) * s.unitCost) / QUANTITY_SCALE),
        received: amount(['OPENING', 'STOCK_IN']),
        // Orders take stock out (negative) and cancelled orders put it back (positive).
        used: 0 - amount(['CONSUMPTION', 'CONSUMPTION_REVERSAL']),
        wasted: 0 - amount(['WASTAGE']),
        status: stockStatus
      }
    })
  return {
    summary: [
      item('Items', rows.length, 'int'),
      item(
        'Stock value',
        sum(rows, (r) => r.value),
        'money'
      ),
      item('Low stock', rows.filter((r) => r.status === 'Low stock').length, 'int'),
      item('Out of stock', rows.filter((r) => r.status === 'Out of stock').length, 'int')
    ],
    columns: [
      col('name', 'Item', 'text'),
      col('category', 'Category', 'text'),
      col('unit', 'Unit', 'text'),
      col('onHand', 'On hand', 'quantity'),
      col('reorderLevel', 'Reorder level', 'quantity'),
      col('unitCost', 'Cost per unit', 'money'),
      col('value', 'Stock value', 'money', true),
      col('received', 'Received', 'quantity'),
      col('used', 'Used', 'quantity'),
      col('wasted', 'Wasted', 'quantity'),
      col('status', 'Status', 'text')
    ],
    rows
  }
}

// --- Purchases and suppliers --------------------------------------------------------------------

export function purchasesReport(ctx: ReportContext): ReportBody {
  const { filter } = ctx
  // Received purchases are the ones that count as money spent; drafts and cancelled ones are only
  // listed when asked for.
  const status = PURCHASE_STATUSES.find((s) => s === filter.status) ?? 'RECEIVED'
  const conditions: SQL[] = [
    isNull(purchases.deletedAt),
    between(purchases.purchaseDate, filter.from, filter.to),
    eq(purchases.status, status)
  ]
  if (filter.supplierId) conditions.push(eq(purchases.supplierId, filter.supplierId))
  const found = ctx.db
    .select({
      purchaseDate: purchases.purchaseDate,
      purchaseNumber: purchases.purchaseNumber,
      invoiceNumber: purchases.invoiceNumber,
      supplier: suppliers.name,
      subtotal: purchases.subtotal,
      discount: purchases.discount,
      tax: purchases.tax,
      total: purchases.total,
      amountPaid: purchases.amountPaid,
      createdBy: purchases.createdBy
    })
    .from(purchases)
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(and(...conditions))
    .orderBy(asc(purchases.purchaseDate), asc(purchases.purchaseNumber))
    .all()
    .filter((p) => matchesSearch(filter.search, p.purchaseNumber, p.invoiceNumber, p.supplier))
  const rows = found.map((p) => ({
    date: p.purchaseDate,
    purchaseNumber: p.purchaseNumber,
    invoiceNumber: p.invoiceNumber,
    supplier: p.supplier,
    status: PURCHASE_STATUS_LABELS[status],
    subtotal: p.subtotal,
    discount: p.discount,
    tax: p.tax,
    total: p.total,
    paid: p.amountPaid,
    due: status === 'CANCELLED' ? 0 : Math.max(0, p.total - p.amountPaid),
    staff: userName(ctx, p.createdBy)
  }))
  return {
    summary: [
      item('Purchases', rows.length, 'int'),
      item(
        'Total',
        sum(rows, (r) => r.total),
        'money'
      ),
      item(
        'Paid',
        sum(rows, (r) => r.paid),
        'money'
      ),
      item(
        'Still owed',
        sum(rows, (r) => r.due),
        'money'
      )
    ],
    columns: [
      col('date', 'Date', 'date'),
      col('purchaseNumber', 'Purchase', 'text'),
      col('invoiceNumber', 'Invoice', 'text'),
      col('supplier', 'Supplier', 'text'),
      col('status', 'Status', 'text'),
      col('subtotal', 'Subtotal', 'money', true),
      col('discount', 'Discount', 'money', true),
      col('tax', 'Tax', 'money', true),
      col('total', 'Total', 'money', true),
      col('paid', 'Paid', 'money', true),
      col('due', 'Due', 'money', true),
      col('staff', 'Entered by', 'text')
    ],
    rows
  }
}

export function suppliersReport(ctx: ReportContext): ReportBody {
  const { filter } = ctx
  const list = ctx.db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      phone: suppliers.phone,
      isActive: suppliers.isActive
    })
    .from(suppliers)
    .where(
      and(
        isNull(suppliers.deletedAt),
        filter.supplierId ? eq(suppliers.id, filter.supplierId) : undefined
      )
    )
    .orderBy(asc(suppliers.name))
    .all()
    .filter((s) => matchesSearch(filter.search, s.name))

  const received = ctx.db
    .select({
      supplierId: purchases.supplierId,
      purchaseDate: purchases.purchaseDate,
      total: purchases.total,
      amountPaid: purchases.amountPaid
    })
    .from(purchases)
    .where(and(isNull(purchases.deletedAt), eq(purchases.status, 'RECEIVED')))
    .all()
  const receivedBySupplier = groupBy(received, (p) => p.supplierId)

  const paid = ctx.db
    .select({ supplierId: supplierPayments.supplierId, amount: supplierPayments.amount })
    .from(supplierPayments)
    .where(
      and(
        isNull(supplierPayments.deletedAt),
        isNull(supplierPayments.voidedAt),
        gte(supplierPayments.paidAt, ctx.from),
        lt(supplierPayments.paidAt, ctx.to)
      )
    )
    .all()
  const paidBySupplier = groupBy(paid, (p) => p.supplierId)

  const rows = list
    .map((s) => {
      const all = receivedBySupplier.get(s.id) ?? []
      const inRange = all.filter(
        (p) => p.purchaseDate >= filter.from && p.purchaseDate <= filter.to
      )
      return {
        name: s.name,
        phone: s.phone,
        purchases: inRange.length,
        bought: sum(inRange, (p) => p.total),
        paid: sum(paidBySupplier.get(s.id) ?? [], (p) => p.amount),
        owed: sum(all, (p) => Math.max(0, p.total - p.amountPaid))
      }
    })
    .filter((r) => r.purchases > 0 || r.paid > 0 || r.owed > 0)
    .sort((a, b) => b.bought - a.bought || a.name.localeCompare(b.name))
  return {
    summary: [
      item('Suppliers', rows.length, 'int'),
      item(
        'Bought',
        sum(rows, (r) => r.bought),
        'money'
      ),
      item(
        'Paid in the period',
        sum(rows, (r) => r.paid),
        'money'
      ),
      item(
        'Owed now',
        sum(rows, (r) => r.owed),
        'money'
      )
    ],
    columns: [
      col('name', 'Supplier', 'text'),
      col('phone', 'Phone', 'text'),
      col('purchases', 'Purchases', 'int', true),
      col('bought', 'Bought', 'money', true),
      col('paid', 'Paid in the period', 'money', true),
      col('owed', 'Owed now', 'money', true)
    ],
    rows
  }
}

// --- Expenses -----------------------------------------------------------------------------------

export function expensesReport(ctx: ReportContext): ReportBody {
  const { filter } = ctx
  const method = EXPENSE_PAYMENT_METHODS.find((m) => m === filter.method)
  const conditions: SQL[] = [
    isNull(expenses.deletedAt),
    isNull(expenses.voidedAt),
    gte(expenses.spentAt, ctx.from),
    lt(expenses.spentAt, ctx.to)
  ]
  if (filter.expenseCategoryId) conditions.push(eq(expenses.categoryId, filter.expenseCategoryId))
  if (method) conditions.push(eq(expenses.method, method))
  const found = ctx.db
    .select({
      spentAt: expenses.spentAt,
      expenseNumber: expenses.expenseNumber,
      category: expenseCategories.name,
      payee: expenses.payee,
      method: expenses.method,
      reference: expenses.reference,
      amount: expenses.amount,
      notes: expenses.notes,
      recordedBy: expenses.recordedBy
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(and(...conditions))
    .orderBy(asc(expenses.spentAt), asc(expenses.expenseNumber))
    .all()
    .filter((e) => matchesSearch(filter.search, e.expenseNumber, e.payee, e.reference, e.notes))
  const byCategory = [...groupBy(found, (e) => e.category).entries()]
    .map(([name, group]) => ({ name, total: sum(group, (e) => e.amount) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  return {
    summary: [
      item('Expenses', found.length, 'int'),
      item(
        'Total spent',
        sum(found, (e) => e.amount),
        'money'
      ),
      item(
        'Paid in cash',
        sum(
          found.filter((e) => e.method === 'CASH'),
          (e) => e.amount
        ),
        'money'
      ),
      item('Biggest category', byCategory[0]?.name ?? 'None', 'text')
    ],
    columns: [
      col('spentAt', 'Spent at', 'datetime'),
      col('expenseNumber', 'Number', 'text'),
      col('category', 'Category', 'text'),
      col('payee', 'Payee', 'text'),
      col('method', 'Paid by', 'text'),
      col('reference', 'Reference', 'text'),
      col('amount', 'Amount', 'money', true),
      col('notes', 'Notes', 'text'),
      col('staff', 'Recorded by', 'text')
    ],
    rows: found.map((e) => ({
      spentAt: iso(e.spentAt),
      expenseNumber: e.expenseNumber,
      category: e.category,
      payee: e.payee,
      method: EXPENSE_PAYMENT_LABELS[e.method],
      reference: e.reference,
      amount: e.amount,
      notes: e.notes,
      staff: userName(ctx, e.recordedBy)
    }))
  }
}

// --- Day closings -------------------------------------------------------------------------------

export function dayClosingsReport(ctx: ReportContext): ReportBody {
  const { filter } = ctx
  const conditions: SQL[] = [
    isNull(dayClosings.deletedAt),
    between(dayClosings.businessDate, filter.from, filter.to)
  ]
  const found = ctx.db
    .select()
    .from(dayClosings)
    .where(and(...conditions))
    .orderBy(asc(dayClosings.businessDate), asc(dayClosings.closedAt))
    .all()
    .filter((d) => {
      if (filter.status === 'STANDING') return d.reopenedAt === null
      if (filter.status === 'REOPENED') return d.reopenedAt !== null
      return true
    })
  const standing = found.filter((d) => d.reopenedAt === null)
  return {
    summary: [
      item('Closings', found.length, 'int'),
      item(
        'Sales closed',
        sum(standing, (d) => d.salesTotal),
        'money'
      ),
      item(
        'Net cash variance',
        sum(standing, (d) => d.variance),
        'money'
      ),
      item('Reopened', found.length - standing.length, 'int')
    ],
    columns: [
      col('businessDate', 'Business date', 'date'),
      col('closingNumber', 'Closing', 'text'),
      col('billCount', 'Bills', 'int', true),
      col('salesTotal', 'Sales', 'money', true),
      col('expectedCash', 'Expected cash', 'money', true),
      col('countedCash', 'Counted cash', 'money', true),
      col('variance', 'Difference', 'money', true),
      col('closedAt', 'Closed at', 'datetime'),
      col('closedBy', 'Closed by', 'text'),
      col('status', 'Status', 'text'),
      col('reopenReason', 'Reopen reason', 'text')
    ],
    rows: found.map((d) => ({
      businessDate: d.businessDate,
      closingNumber: d.closingNumber,
      billCount: d.billCount,
      salesTotal: d.salesTotal,
      expectedCash: d.expectedCash,
      countedCash: d.countedCash,
      variance: d.variance,
      closedAt: iso(d.closedAt),
      closedBy: userName(ctx, d.closedBy),
      status: d.reopenedAt ? 'Reopened' : 'In force',
      reopenReason: d.reopenReason
    }))
  }
}
