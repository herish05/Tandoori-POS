import { and, asc, eq, gte, isNull, lt, type SQL } from 'drizzle-orm'
import { bills, diningTables, kotItems, kots, orders } from '../db/schema'
import { KOT_STATUS_LABELS, KOT_STATUSES } from '@shared/kitchen'
import { ORDER_TYPE_LABELS } from '@shared/orders'
import {
  col,
  item,
  iso,
  matchesSearch,
  sum,
  userName,
  type ReportBody,
  type ReportContext
} from './context'

const MINUTE_MS = 60_000

const minutesBetween = (from: Date | null, to: Date | null): number | null =>
  from && to ? Math.max(0, Math.round((to.getTime() - from.getTime()) / MINUTE_MS)) : null

const average = (values: readonly (number | null)[]): number => {
  const present = values.filter((v): v is number => v !== null)
  return present.length > 0 ? Math.round(sum(present, (v) => v) / present.length) : 0
}

export function kotReport(ctx: ReportContext): ReportBody {
  const { filter } = ctx
  const status = KOT_STATUSES.find((s) => s === filter.status)
  const conditions: SQL[] = [
    isNull(kots.deletedAt),
    gte(kots.createdAt, ctx.from),
    lt(kots.createdAt, ctx.to)
  ]
  if (status) conditions.push(eq(kots.status, status))
  if (filter.orderType) conditions.push(eq(orders.type, filter.orderType))

  const tickets = ctx.db
    .select({
      id: kots.id,
      kotNumber: kots.kotNumber,
      orderNumber: orders.orderNumber,
      orderType: orders.type,
      stationName: kots.stationName,
      status: kots.status,
      isAdditional: kots.isAdditional,
      createdAt: kots.createdAt,
      acceptedAt: kots.acceptedAt,
      readyAt: kots.readyAt,
      servedAt: kots.servedAt,
      createdBy: kots.createdBy
    })
    .from(kots)
    .innerJoin(orders, eq(orders.id, kots.orderId))
    .where(and(...conditions))
    .orderBy(asc(kots.createdAt), asc(kots.kotNumber))
    .all()
    .filter((k) => matchesSearch(filter.search, k.kotNumber, k.orderNumber, k.stationName))

  const quantities = new Map<string, number>()
  const lines = ctx.db
    .select({ kotId: kotItems.kotId, quantity: kotItems.quantity })
    .from(kotItems)
    .innerJoin(kots, eq(kots.id, kotItems.kotId))
    .innerJoin(orders, eq(orders.id, kots.orderId))
    .where(and(isNull(kotItems.deletedAt), ...conditions))
    .all()
  for (const line of lines) {
    quantities.set(line.kotId, (quantities.get(line.kotId) ?? 0) + line.quantity)
  }

  const rows = tickets.map((k) => ({
    createdAt: iso(k.createdAt),
    kotNumber: k.kotNumber,
    orderNumber: k.orderNumber,
    orderType: ORDER_TYPE_LABELS[k.orderType],
    station: k.stationName,
    status: KOT_STATUS_LABELS[k.status],
    additional: k.isAdditional ? 'Yes' : 'No',
    quantity: quantities.get(k.id) ?? 0,
    wait: minutesBetween(k.createdAt, k.acceptedAt),
    cooking: minutesBetween(k.acceptedAt, k.readyAt),
    total: minutesBetween(k.createdAt, k.readyAt ?? k.servedAt),
    staff: userName(ctx, k.createdBy)
  }))
  return {
    summary: [
      item('Tickets', rows.length, 'int'),
      item(
        'Items sent',
        sum(rows, (r) => r.quantity),
        'int'
      ),
      item('Cancelled', tickets.filter((k) => k.status === 'CANCELLED').length, 'int'),
      item('Average wait to accept (min)', average(rows.map((r) => r.wait)), 'minutes'),
      item('Average cooking time (min)', average(rows.map((r) => r.cooking)), 'minutes')
    ],
    columns: [
      col('createdAt', 'Sent at', 'datetime'),
      col('kotNumber', 'KOT', 'text'),
      col('orderNumber', 'Order', 'text'),
      col('orderType', 'Type', 'text'),
      col('station', 'Station', 'text'),
      col('status', 'Status', 'text'),
      col('additional', 'Additional', 'text'),
      col('quantity', 'Items', 'int', true),
      col('wait', 'Wait (min)', 'minutes'),
      col('cooking', 'Cooking (min)', 'minutes'),
      col('total', 'Order to ready (min)', 'minutes'),
      col('staff', 'Sent by', 'text')
    ],
    rows
  }
}

export function cancelledOrdersReport(ctx: ReportContext): ReportBody {
  const { filter } = ctx
  const conditions: SQL[] = [
    isNull(orders.deletedAt),
    eq(orders.status, 'CANCELLED'),
    gte(orders.cancelledAt, ctx.from),
    lt(orders.cancelledAt, ctx.to)
  ]
  if (filter.orderType) conditions.push(eq(orders.type, filter.orderType))
  if (filter.staffId) conditions.push(eq(orders.cancelledBy, filter.staffId))
  const found = ctx.db
    .select({
      cancelledAt: orders.cancelledAt,
      orderNumber: orders.orderNumber,
      orderType: orders.type,
      tableNumber: diningTables.tableNumber,
      customerName: orders.customerName,
      subtotal: orders.subtotal,
      reason: orders.cancelReason,
      cancelledBy: orders.cancelledBy,
      createdBy: orders.createdBy
    })
    .from(orders)
    .leftJoin(diningTables, eq(diningTables.id, orders.tableId))
    .where(and(...conditions))
    .orderBy(asc(orders.cancelledAt), asc(orders.orderNumber))
    .all()
    .filter((o) => matchesSearch(filter.search, o.orderNumber, o.reason, o.customerName))
  return {
    summary: [
      item('Orders cancelled', found.length, 'int'),
      item(
        'Value cancelled',
        sum(found, (o) => o.subtotal),
        'money'
      )
    ],
    columns: [
      col('cancelledAt', 'Cancelled at', 'datetime'),
      col('orderNumber', 'Order', 'text'),
      col('orderType', 'Type', 'text'),
      col('table', 'Table', 'text'),
      col('customer', 'Customer', 'text'),
      col('subtotal', 'Order value', 'money', true),
      col('reason', 'Reason', 'text'),
      col('cancelledBy', 'Cancelled by', 'text'),
      col('createdBy', 'Taken by', 'text')
    ],
    rows: found.map((o) => ({
      cancelledAt: iso(o.cancelledAt),
      orderNumber: o.orderNumber,
      orderType: ORDER_TYPE_LABELS[o.orderType],
      table: o.tableNumber,
      customer: o.customerName,
      subtotal: o.subtotal,
      reason: o.reason,
      cancelledBy: userName(ctx, o.cancelledBy),
      createdBy: userName(ctx, o.createdBy)
    }))
  }
}

export function cancelledBillsReport(ctx: ReportContext): ReportBody {
  const { filter } = ctx
  const conditions: SQL[] = [
    isNull(bills.deletedAt),
    eq(bills.status, 'CANCELLED'),
    gte(bills.cancelledAt, ctx.from),
    lt(bills.cancelledAt, ctx.to)
  ]
  if (filter.orderType) conditions.push(eq(orders.type, filter.orderType))
  if (filter.staffId) conditions.push(eq(bills.cancelledBy, filter.staffId))
  const found = ctx.db
    .select({
      cancelledAt: bills.cancelledAt,
      billNumber: bills.billNumber,
      orderNumber: orders.orderNumber,
      orderType: orders.type,
      total: bills.grandTotal,
      reason: bills.cancelReason,
      cancelledBy: bills.cancelledBy,
      createdBy: bills.createdBy
    })
    .from(bills)
    .innerJoin(orders, eq(orders.id, bills.orderId))
    .where(and(...conditions))
    .orderBy(asc(bills.cancelledAt), asc(bills.billNumber))
    .all()
    .filter((b) => matchesSearch(filter.search, b.billNumber, b.orderNumber, b.reason))
  return {
    summary: [
      item('Bills cancelled', found.length, 'int'),
      item(
        'Value cancelled',
        sum(found, (b) => b.total),
        'money'
      )
    ],
    columns: [
      col('cancelledAt', 'Cancelled at', 'datetime'),
      col('billNumber', 'Bill', 'text'),
      col('orderNumber', 'Order', 'text'),
      col('orderType', 'Type', 'text'),
      col('total', 'Bill total', 'money', true),
      col('reason', 'Reason', 'text'),
      col('cancelledBy', 'Cancelled by', 'text'),
      col('createdBy', 'Billed by', 'text')
    ],
    rows: found.map((b) => ({
      cancelledAt: iso(b.cancelledAt),
      billNumber: b.billNumber,
      orderNumber: b.orderNumber,
      orderType: ORDER_TYPE_LABELS[b.orderType],
      total: b.total,
      reason: b.reason,
      cancelledBy: userName(ctx, b.cancelledBy),
      createdBy: userName(ctx, b.createdBy)
    }))
  }
}
