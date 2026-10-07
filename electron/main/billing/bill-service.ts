import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext, Clock } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import {
  billDiscounts,
  billItems,
  bills,
  billTaxes,
  diningTables,
  markModified,
  orderItems,
  orders,
  payments,
  refundLines,
  refunds,
  users
} from '../db/schema'
import { AppError } from '../ipc/errors'
import { nextDocumentNumber } from '../orders/numbering'
import { moveOrderStatus, type OrderRow } from '../orders/order-state'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import {
  allocatePayments,
  BillCalculationError,
  calculateBill,
  type BillCalculation,
  type DiscountSpec
} from './calculator'
import type { BillingSettingsService } from './settings-service'
import {
  BILL_STATUS_LABELS,
  BILLABLE_ORDER_STATUSES,
  CHANGEABLE_BILL_STATUSES,
  PAYABLE_BILL_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  REFUNDABLE_BILL_STATUSES,
  type ApplyDiscountData,
  type BillDetail,
  type BillDiscount,
  type BillFilterData,
  type BillItem,
  type BillPayment,
  type BillRefund,
  type BillSummary,
  type BillTaxLine,
  type PayBillData,
  type PayBillResult,
  type PaymentMethod,
  type RefundableAmount,
  type RefundBillData,
  type RefundBillResult,
  type RoundOffUnit
} from '@shared/billing'
import { CLOSED_ORDER_STATUSES, ORDER_STATUS_LABELS } from '@shared/orders'

type BillRow = typeof bills.$inferSelect
type BillItemRow = typeof billItems.$inferSelect
type DiscountRow = typeof billDiscounts.$inferSelect

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (match) => `\\${match}`)
const iso = (value: Date | null): string | null => (value ? value.toISOString() : null)

/** 12345 -> "123.45", for messages (integer maths only). */
const rupees = (paise: number): string =>
  `${String(Math.floor(paise / 100))}.${String(paise % 100).padStart(2, '0')}`

/** Runs a calculation and turns its refusals into a message staff can read. */
function calculate<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (error instanceof BillCalculationError) {
      throw new AppError('VALIDATION_ERROR', error.message)
    }
    throw error
  }
}

/**
 * Bills and payments. A bill is made from a served order. Every figure on it is worked out here
 * by the calculator from the order's line snapshots, the discounts and the billing settings the
 * bill was made with; nothing the screen sends is trusted. The bill can take discounts while
 * nothing is paid; after that its amounts are locked (also by database triggers).
 */
export class BillService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly settings: BillingSettingsService
  ) {}

  // --- Reads -----------------------------------------------------------------------------

  list(filter: BillFilterData = {}): BillSummary[] {
    const conditions: SQL[] = []
    if (filter.orderId) conditions.push(eq(bills.orderId, filter.orderId))
    if (filter.statuses && filter.statuses.length > 0) {
      conditions.push(inArray(bills.status, filter.statuses))
    }
    if (filter.search) {
      const like = `%${escapeLike(filter.search)}%`
      conditions.push(
        sql`(${bills.billNumber} like ${like} escape '\\' or ${orders.orderNumber} like ${like} escape '\\')`
      )
    }
    return this.loadSummaries(this.db, conditions, filter.limit ?? 200)
  }

  get(id: string): BillDetail {
    return this.loadDetail(this.db, id)
  }

  // --- Making a bill ---------------------------------------------------------------------

  /** Makes the bill for an order that has been served, and marks the order "bill requested". */
  generate(auth: AuthContext, input: { orderId: string }): BillDetail {
    const id = this.db.transaction((tx) => {
      const order = this.requireOrder(tx, input.orderId)
      this.assertBillable(tx, order)

      const lines = tx
        .select()
        .from(orderItems)
        .where(
          and(
            eq(orderItems.orderId, order.id),
            isNull(orderItems.deletedAt),
            ne(orderItems.status, 'CANCELLED')
          )
        )
        .orderBy(asc(orderItems.createdAt), sql`rowid`)
        .all()
      if (lines.length === 0) {
        throw new AppError('CONFLICT', 'There is nothing to bill on this order.')
      }
      if (lines.some((line) => line.status === 'NEW')) {
        throw new AppError('CONFLICT', 'Send the new items to the kitchen before billing.')
      }

      const settings = this.settings.get(tx)
      const restaurantId = requireRestaurantId(tx)
      const chargeApplies = !settings.serviceChargeDineInOnly || order.type === 'DINE_IN'
      const bill = tx
        .insert(bills)
        .values({
          restaurantId,
          billNumber: nextDocumentNumber(tx, restaurantId, 'BILL'),
          orderId: order.id,
          taxMode: settings.taxMode,
          serviceChargeBps: chargeApplies ? settings.serviceChargeBps : 0,
          serviceChargeTaxable: settings.serviceChargeTaxable,
          roundOffUnit: settings.roundOffUnit,
          subtotal: 0,
          grandTotal: 0,
          createdBy: auth.userId
        })
        .returning()
        .get()
      for (const line of lines) {
        const unitPrice = line.unitPrice + line.addonTotal
        tx.insert(billItems)
          .values({
            billId: bill.id,
            orderItemId: line.id,
            itemName: line.itemName,
            variantName: line.variantName,
            foodType: line.foodType,
            quantity: line.quantity,
            unitPrice,
            gross: unitPrice * line.quantity,
            taxableValue: 0,
            taxName: line.taxName,
            taxRateBps: line.taxRateBps ?? 0
          })
          .run()
      }
      const worked = this.recalculate(tx, bill)

      if (order.status === 'SERVED') moveOrderStatus(tx, order, 'BILL_REQUESTED')
      this.record(tx, auth, 'bill.generated', bill, order, {
        items: lines.length,
        subtotal: worked.subtotal,
        taxTotal: worked.taxTotal,
        grandTotal: worked.grandTotal
      })
      return bill.id
    })
    return this.get(id)
  }

  // --- Discounts -------------------------------------------------------------------------

  applyDiscount(auth: AuthContext, input: ApplyDiscountData): BillDetail {
    this.db.transaction((tx) => {
      const { bill, order } = this.requireBill(tx, input.billId)
      this.assertChangeable(bill)

      let itemName: string | null = null
      if (input.scope === 'ITEM') {
        const item = tx
          .select()
          .from(billItems)
          .where(and(eq(billItems.id, input.billItemId ?? ''), eq(billItems.billId, bill.id)))
          .get()
        if (!item) throw new AppError('NOT_FOUND', 'That item is not on this bill.')
        itemName = item.itemName
      }
      const existing = this.activeDiscounts(tx, bill.id).find(
        (row) => row.scope === input.scope && row.billItemId === input.billItemId
      )
      if (existing) {
        throw new AppError(
          'CONFLICT',
          input.scope === 'BILL'
            ? 'This bill already has a discount. Remove it before giving another.'
            : 'This item already has a discount. Remove it before giving another.'
        )
      }

      const row = tx
        .insert(billDiscounts)
        .values({
          billId: bill.id,
          scope: input.scope,
          billItemId: input.billItemId,
          type: input.type,
          value: input.value,
          reason: input.reason,
          appliedBy: auth.userId
        })
        .returning()
        .get()
      const worked = this.recalculate(tx, bill)
      const amount =
        tx.select().from(billDiscounts).where(eq(billDiscounts.id, row.id)).get()?.amount ?? 0
      this.record(tx, auth, 'bill.discount_applied', bill, order, {
        scope: input.scope,
        item: itemName,
        type: input.type,
        value: input.value,
        amount,
        reason: input.reason,
        grandTotal: worked.grandTotal
      })
    })
    return this.get(input.billId)
  }

  removeDiscount(auth: AuthContext, input: { billId: string; discountId: string }): BillDetail {
    this.db.transaction((tx) => {
      const { bill, order } = this.requireBill(tx, input.billId)
      this.assertChangeable(bill)
      const discount = this.activeDiscounts(tx, bill.id).find((row) => row.id === input.discountId)
      if (!discount) throw new AppError('NOT_FOUND', 'That discount is not on this bill.')

      tx.update(billDiscounts)
        .set({ deletedAt: new Date(this.clock()), ...markModified(billDiscounts) })
        .where(eq(billDiscounts.id, discount.id))
        .run()
      const worked = this.recalculate(tx, bill)
      this.record(tx, auth, 'bill.discount_removed', bill, order, {
        scope: discount.scope,
        type: discount.type,
        value: discount.value,
        amount: discount.amount,
        reason: discount.reason,
        grandTotal: worked.grandTotal
      })
    })
    return this.get(input.billId)
  }

  // --- Cancelling ------------------------------------------------------------------------

  /** Withdraws an unpaid bill so the order can be changed and billed again. */
  cancel(auth: AuthContext, input: { id: string; reason: string }): BillDetail {
    this.db.transaction((tx) => {
      const { bill, order } = this.requireBill(tx, input.id)
      if (bill.status === 'CANCELLED') {
        throw new AppError('CONFLICT', 'This bill was already cancelled.')
      }
      if (!CHANGEABLE_BILL_STATUSES.includes(bill.status)) {
        throw new AppError(
          'CONFLICT',
          bill.status === 'PARTIAL'
            ? 'Payment has started on this bill. Refund what was paid to withdraw it.'
            : 'Payment has started on this bill, so it cannot be cancelled.'
        )
      }
      const result = tx
        .update(bills)
        .set({
          status: 'CANCELLED',
          cancelReason: input.reason,
          cancelledAt: new Date(this.clock()),
          cancelledBy: auth.userId,
          ...markModified(bills)
        })
        .where(and(eq(bills.id, bill.id), eq(bills.status, 'PENDING')))
        .run()
      if (result.changes !== 1) {
        throw new AppError('CONFLICT', 'This bill was just changed somewhere else. Reopen it.')
      }
      if (order.status === 'BILL_REQUESTED') moveOrderStatus(tx, order, 'SERVED')
      this.record(tx, auth, 'bill.cancelled', bill, order, {
        reason: input.reason,
        grandTotal: bill.grandTotal
      })
    })
    return this.get(input.id)
  }

  // --- Payment ---------------------------------------------------------------------------

  /**
   * Records one or more payments (split payment: any mix of cash, UPI, card and other). Settling
   * the bill completes the order and marks its table paid. A bill whose total is zero is settled
   * with an empty list.
   */
  pay(auth: AuthContext, input: PayBillData): PayBillResult {
    const changeDue = this.db.transaction((tx) => {
      const { bill, order } = this.requireBill(tx, input.billId)
      if (!PAYABLE_BILL_STATUSES.includes(bill.status)) {
        throw new AppError(
          'CONFLICT',
          bill.status === 'PAID'
            ? 'This bill is already paid.'
            : `A ${BILL_STATUS_LABELS[bill.status].toLowerCase()} bill cannot take a payment.`
        )
      }
      if (input.payments.length === 0 && bill.grandTotal > 0) {
        throw new AppError('VALIDATION_ERROR', 'Enter at least one payment.')
      }
      const outcome = calculate(() =>
        allocatePayments(bill.grandTotal, bill.paidTotal, input.payments)
      )

      const now = new Date(this.clock())
      for (const line of input.payments) {
        tx.insert(payments)
          .values({
            billId: bill.id,
            method: line.method,
            amount: line.amount,
            tendered: line.tendered ?? line.amount,
            reference: line.reference,
            receivedBy: auth.userId,
            receivedAt: now
          })
          .run()
      }
      const settled = outcome.status === 'PAID'
      const result = tx
        .update(bills)
        .set({
          status: outcome.status,
          paidTotal: outcome.paidTotal,
          ...(settled ? { paidAt: now } : {}),
          ...markModified(bills)
        })
        .where(
          and(
            eq(bills.id, bill.id),
            eq(bills.status, bill.status),
            eq(bills.paidTotal, bill.paidTotal)
          )
        )
        .run()
      if (result.changes !== 1) {
        throw new AppError('CONFLICT', 'This bill was just changed somewhere else. Reopen it.')
      }

      if (input.payments.length > 0) {
        this.record(tx, auth, 'bill.payment_recorded', bill, order, {
          payments: input.payments.map((line) => ({
            method: line.method,
            amount: line.amount,
            reference: line.reference
          })),
          paidTotal: outcome.paidTotal,
          balance: outcome.balance,
          changeDue: outcome.changeDue
        })
      }
      if (settled) {
        moveOrderStatus(tx, order, 'COMPLETED')
        this.record(tx, auth, 'bill.paid', bill, order, {
          grandTotal: bill.grandTotal,
          methods: [...new Set(input.payments.map((line) => line.method))]
        })
      }
      return outcome.changeDue
    })
    return { bill: this.get(input.billId), changeDue }
  }

  // --- Refunds ---------------------------------------------------------------------------

  /**
   * Gives money back. Each line returns money through the method that took it, and never more
   * than that method took (less what was already returned). A paid bill can be refunded in part,
   * several times; once everything is returned it becomes REFUNDED. A bill that was only part
   * paid must have everything returned, which withdraws the bill and reopens the order so it can
   * be billed again.
   */
  refund(auth: AuthContext, input: RefundBillData): RefundBillResult {
    const { refundId, billCancelled } = this.db.transaction((tx) => {
      const { bill, order } = this.requireBill(tx, input.billId)
      if (!REFUNDABLE_BILL_STATUSES.includes(bill.status)) {
        throw new AppError(
          'CONFLICT',
          bill.status === 'REFUNDED'
            ? 'This bill has already been refunded in full.'
            : bill.status === 'CANCELLED'
              ? 'This bill was cancelled.'
              : 'Nothing has been paid on this bill, so there is nothing to refund.'
        )
      }

      const available = this.refundable(tx, bill.id)
      for (const line of input.lines) {
        const left = available.get(line.method) ?? 0
        if (line.amount > left) {
          throw new AppError(
            'VALIDATION_ERROR',
            left === 0
              ? `Nothing was paid by ${PAYMENT_METHOD_LABELS[line.method]} on this bill.`
              : `Only ${rupees(left)} can be returned by ${PAYMENT_METHOD_LABELS[line.method]}.`
          )
        }
      }
      const total = input.lines.reduce((sum, line) => sum + line.amount, 0)
      const owed = bill.paidTotal - bill.refundedTotal
      const partPaid = bill.status === 'PARTIAL'
      if (partPaid && total !== owed) {
        throw new AppError(
          'CONFLICT',
          `This bill is only part paid. Return everything that was paid (${rupees(owed)}) so the bill can be withdrawn.`
        )
      }

      const restaurantId = requireRestaurantId(tx)
      const now = new Date(this.clock())
      const refund = tx
        .insert(refunds)
        .values({
          restaurantId,
          refundNumber: nextDocumentNumber(tx, restaurantId, 'REF'),
          billId: bill.id,
          amount: total,
          reason: input.reason,
          refundedBy: auth.userId,
          refundedAt: now
        })
        .returning()
        .get()
      for (const line of input.lines) {
        tx.insert(refundLines)
          .values({
            refundId: refund.id,
            method: line.method,
            amount: line.amount,
            reference: line.reference
          })
          .run()
      }

      const refundedTotal = bill.refundedTotal + total
      const nextStatus = partPaid
        ? 'CANCELLED'
        : refundedTotal === bill.paidTotal
          ? 'REFUNDED'
          : bill.status
      const result = tx
        .update(bills)
        .set({
          refundedTotal,
          status: nextStatus,
          ...(partPaid
            ? { cancelReason: input.reason, cancelledAt: now, cancelledBy: auth.userId }
            : {}),
          ...markModified(bills)
        })
        .where(
          and(
            eq(bills.id, bill.id),
            eq(bills.status, bill.status),
            eq(bills.refundedTotal, bill.refundedTotal)
          )
        )
        .run()
      if (result.changes !== 1) {
        throw new AppError('CONFLICT', 'This bill was just changed somewhere else. Reopen it.')
      }
      if (partPaid && order.status === 'BILL_REQUESTED') moveOrderStatus(tx, order, 'SERVED')

      this.record(tx, auth, 'bill.refunded', bill, order, {
        refundNumber: refund.refundNumber,
        amount: total,
        reason: input.reason,
        lines: input.lines.map((line) => ({
          method: line.method,
          amount: line.amount,
          reference: line.reference
        })),
        refundedTotal,
        status: nextStatus
      })
      if (partPaid) {
        this.record(tx, auth, 'bill.cancelled', bill, order, {
          reason: input.reason,
          grandTotal: bill.grandTotal,
          refunded: total
        })
      }
      return { refundId: refund.id, billCancelled: partPaid }
    })

    const detail = this.get(input.billId)
    const refund = detail.refunds.find((row) => row.id === refundId)
    if (!refund) throw new AppError('NOT_FOUND', 'That refund could not be found.')
    return { bill: detail, refund, billCancelled }
  }

  /** Paise still returnable per payment method: what the method took less what went back. */
  private refundable(db: DbExecutor, billId: string): Map<PaymentMethod, number> {
    const left = new Map<PaymentMethod, number>()
    const taken = db
      .select({ method: payments.method, amount: payments.amount })
      .from(payments)
      .where(and(eq(payments.billId, billId), isNull(payments.deletedAt)))
      .all()
    for (const row of taken) left.set(row.method, (left.get(row.method) ?? 0) + row.amount)
    const returned = db
      .select({ method: refundLines.method, amount: refundLines.amount })
      .from(refundLines)
      .innerJoin(refunds, eq(refunds.id, refundLines.refundId))
      .where(and(eq(refunds.billId, billId), isNull(refunds.deletedAt)))
      .all()
    for (const row of returned) left.set(row.method, (left.get(row.method) ?? 0) - row.amount)
    return left
  }

  // --- Calculation -----------------------------------------------------------------------

  /** Works the bill out again from its lines and discounts and saves every figure. */
  private recalculate(tx: DbExecutor, bill: BillRow): BillCalculation {
    const items = this.items(tx, bill.id)
    const discounts = this.activeDiscounts(tx, bill.id)
    const spec = (row: DiscountRow | undefined): DiscountSpec | null =>
      row ? { type: row.type, value: row.value } : null

    const worked = calculate(() =>
      calculateBill({
        lines: items.map((item) => ({
          id: item.id,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          taxRateBps: item.taxRateBps,
          discount: spec(
            discounts.find((row) => row.scope === 'ITEM' && row.billItemId === item.id)
          )
        })),
        billDiscount: spec(discounts.find((row) => row.scope === 'BILL')),
        config: {
          taxMode: bill.taxMode,
          serviceChargeBps: bill.serviceChargeBps,
          serviceChargeTaxable: bill.serviceChargeTaxable,
          roundOffUnit: bill.roundOffUnit as RoundOffUnit
        }
      })
    )

    for (const line of worked.lines) {
      tx.update(billItems)
        .set({
          itemDiscount: line.itemDiscount,
          billDiscountShare: line.billDiscountShare,
          serviceChargeShare: line.serviceChargeShare,
          taxableValue: line.taxableValue,
          ...markModified(billItems)
        })
        .where(eq(billItems.id, line.id))
        .run()
    }
    for (const discount of discounts) {
      const amount =
        discount.scope === 'BILL'
          ? worked.billDiscountTotal
          : (worked.lines.find((line) => line.id === discount.billItemId)?.itemDiscount ?? 0)
      tx.update(billDiscounts)
        .set({ amount, ...markModified(billDiscounts) })
        .where(eq(billDiscounts.id, discount.id))
        .run()
    }
    tx.delete(billTaxes).where(eq(billTaxes.billId, bill.id)).run()
    for (const tax of worked.taxes) {
      tx.insert(billTaxes)
        .values({
          billId: bill.id,
          component: tax.component,
          rateBps: tax.rateBps,
          taxableAmount: tax.taxableAmount,
          taxAmount: tax.taxAmount
        })
        .run()
    }
    tx.update(bills)
      .set({
        subtotal: worked.subtotal,
        itemDiscountTotal: worked.itemDiscountTotal,
        billDiscountTotal: worked.billDiscountTotal,
        serviceCharge: worked.serviceCharge,
        taxTotal: worked.taxTotal,
        roundOff: worked.roundOff,
        grandTotal: worked.grandTotal,
        ...markModified(bills)
      })
      .where(eq(bills.id, bill.id))
      .run()
    return worked
  }

  // --- Guards ----------------------------------------------------------------------------

  private assertBillable(tx: DbExecutor, order: OrderRow): void {
    if (BILLABLE_ORDER_STATUSES.includes(order.status)) {
      const live = tx
        .select({ billNumber: bills.billNumber })
        .from(bills)
        .where(
          and(eq(bills.orderId, order.id), ne(bills.status, 'CANCELLED'), isNull(bills.deletedAt))
        )
        .get()
      if (live) {
        throw new AppError('CONFLICT', `This order already has bill ${live.billNumber}.`)
      }
      return
    }
    if (order.status === 'COMPLETED') {
      throw new AppError('CONFLICT', 'This order is already settled.')
    }
    if (order.status === 'CANCELLED') {
      throw new AppError('CONFLICT', 'A cancelled order cannot be billed.')
    }
    throw new AppError(
      'CONFLICT',
      `Mark the order served before billing. It is "${ORDER_STATUS_LABELS[order.status]}".`
    )
  }

  private assertChangeable(bill: BillRow): void {
    if (CHANGEABLE_BILL_STATUSES.includes(bill.status)) return
    throw new AppError(
      'CONFLICT',
      bill.status === 'CANCELLED'
        ? 'This bill was cancelled.'
        : 'Payment has started on this bill, so its amounts can no longer change.'
    )
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: AuditAction,
    bill: BillRow,
    order: OrderRow,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'bill',
        entityId: bill.id,
        details: { billNumber: bill.billNumber, orderNumber: order.orderNumber, ...details }
      },
      tx
    )
  }

  // --- Loading ---------------------------------------------------------------------------

  private requireOrder(db: DbExecutor, id: string): OrderRow {
    const row = db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That order no longer exists.')
    return row
  }

  private requireBill(db: DbExecutor, id: string): { bill: BillRow; order: OrderRow } {
    const bill = db
      .select()
      .from(bills)
      .where(and(eq(bills.id, id), isNull(bills.deletedAt)))
      .get()
    if (!bill) throw new AppError('NOT_FOUND', 'That bill no longer exists.')
    return { bill, order: this.requireOrder(db, bill.orderId) }
  }

  private items(db: DbExecutor, billId: string): BillItemRow[] {
    return db
      .select()
      .from(billItems)
      .where(and(eq(billItems.billId, billId), isNull(billItems.deletedAt)))
      .orderBy(asc(billItems.createdAt), sql`rowid`)
      .all()
  }

  private activeDiscounts(db: DbExecutor, billId: string): DiscountRow[] {
    return db
      .select()
      .from(billDiscounts)
      .where(and(eq(billDiscounts.billId, billId), isNull(billDiscounts.deletedAt)))
      .orderBy(asc(billDiscounts.createdAt), sql`rowid`)
      .all()
  }

  private loadRefunds(db: DbExecutor, billId: string): BillRefund[] {
    const headers = db
      .select({ refund: refunds, refundedByName: users.fullName })
      .from(refunds)
      .innerJoin(users, eq(users.id, refunds.refundedBy))
      .where(and(eq(refunds.billId, billId), isNull(refunds.deletedAt)))
      .orderBy(asc(refunds.refundedAt), sql`"refunds"."rowid"`)
      .all()
    return headers.map(({ refund, refundedByName }) => ({
      id: refund.id,
      refundNumber: refund.refundNumber,
      amount: refund.amount,
      reason: refund.reason,
      refundedByName,
      refundedAt: refund.refundedAt.toISOString(),
      lines: db
        .select()
        .from(refundLines)
        .where(eq(refundLines.refundId, refund.id))
        .orderBy(sql`rowid`)
        .all()
        .map((line) => ({ method: line.method, amount: line.amount, reference: line.reference }))
    }))
  }

  private loadSummaries(db: DbExecutor, conditions: SQL[], limit: number): BillSummary[] {
    return db
      .select({
        bill: bills,
        orderNumber: orders.orderNumber,
        orderType: orders.type,
        customerName: orders.customerName,
        tableNumber: diningTables.tableNumber
      })
      .from(bills)
      .innerJoin(orders, eq(orders.id, bills.orderId))
      .leftJoin(diningTables, eq(diningTables.id, orders.tableId))
      .where(and(isNull(bills.deletedAt), ...conditions))
      .orderBy(desc(bills.createdAt), desc(bills.billNumber))
      .limit(limit)
      .all()
      .map(({ bill, orderNumber, orderType, customerName, tableNumber }) => ({
        id: bill.id,
        billNumber: bill.billNumber,
        status: bill.status,
        orderId: bill.orderId,
        orderNumber,
        orderType,
        tableNumber,
        customerName,
        grandTotal: bill.grandTotal,
        paidTotal: bill.paidTotal,
        refundedTotal: bill.refundedTotal,
        balance: bill.status === 'CANCELLED' ? 0 : bill.grandTotal - bill.paidTotal,
        createdAt: bill.createdAt.toISOString()
      }))
  }

  private loadDetail(db: DbExecutor, id: string): BillDetail {
    const summary = this.loadSummaries(db, [eq(bills.id, id)], 1)[0]
    const bill = db
      .select()
      .from(bills)
      .where(and(eq(bills.id, id), isNull(bills.deletedAt)))
      .get()
    if (!summary || !bill) throw new AppError('NOT_FOUND', 'That bill no longer exists.')
    const order = this.requireOrder(db, bill.orderId)

    const items: BillItem[] = this.items(db, id).map((row) => ({
      id: row.id,
      orderItemId: row.orderItemId,
      name: row.itemName,
      variantName: row.variantName,
      foodType: row.foodType,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      gross: row.gross,
      itemDiscount: row.itemDiscount,
      billDiscountShare: row.billDiscountShare,
      serviceChargeShare: row.serviceChargeShare,
      taxableValue: row.taxableValue,
      taxName: row.taxName,
      taxRateBps: row.taxRateBps
    }))
    const taxes: BillTaxLine[] = db
      .select()
      .from(billTaxes)
      .where(eq(billTaxes.billId, id))
      .orderBy(asc(billTaxes.rateBps), sql`rowid`)
      .all()
      .map((row) => ({
        component: row.component,
        rateBps: row.rateBps,
        taxableAmount: row.taxableAmount,
        taxAmount: row.taxAmount
      }))
    const discounts: BillDiscount[] = db
      .select({ discount: billDiscounts, appliedByName: users.fullName })
      .from(billDiscounts)
      .innerJoin(users, eq(users.id, billDiscounts.appliedBy))
      .where(and(eq(billDiscounts.billId, id), isNull(billDiscounts.deletedAt)))
      .orderBy(asc(billDiscounts.createdAt), sql`"bill_discounts"."rowid"`)
      .all()
      .map(({ discount, appliedByName }) => ({
        id: discount.id,
        scope: discount.scope,
        billItemId: discount.billItemId,
        type: discount.type,
        value: discount.value,
        amount: discount.amount,
        reason: discount.reason,
        appliedByName,
        createdAt: discount.createdAt.toISOString()
      }))
    const paid: BillPayment[] = db
      .select({ payment: payments, receivedByName: users.fullName })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.receivedBy))
      .where(and(eq(payments.billId, id), isNull(payments.deletedAt)))
      .orderBy(asc(payments.receivedAt), sql`"payments"."rowid"`)
      .all()
      .map(({ payment, receivedByName }) => ({
        id: payment.id,
        method: payment.method,
        amount: payment.amount,
        tendered: payment.tendered,
        change: payment.tendered - payment.amount,
        reference: payment.reference,
        receivedByName,
        receivedAt: payment.receivedAt.toISOString()
      }))
    const creator = db
      .select({ name: users.fullName })
      .from(users)
      .where(eq(users.id, bill.createdBy))
      .get()
    const given = this.loadRefunds(db, id)
    const left = this.refundable(db, id)
    const refundable: RefundableAmount[] = REFUNDABLE_BILL_STATUSES.includes(bill.status)
      ? PAYMENT_METHODS.flatMap((method) => {
          const amount = left.get(method) ?? 0
          return amount > 0 ? [{ method, amount }] : []
        })
      : []

    return {
      ...summary,
      subtotal: bill.subtotal,
      itemDiscountTotal: bill.itemDiscountTotal,
      billDiscountTotal: bill.billDiscountTotal,
      discountedSubtotal: bill.subtotal - bill.itemDiscountTotal - bill.billDiscountTotal,
      serviceChargeBps: bill.serviceChargeBps,
      serviceCharge: bill.serviceCharge,
      taxMode: bill.taxMode,
      taxTotal: bill.taxTotal,
      roundOff: bill.roundOff,
      roundOffUnit: bill.roundOffUnit as RoundOffUnit,
      items,
      taxes,
      discounts,
      payments: paid,
      refunds: given,
      refundable,
      createdByName: creator?.name ?? '',
      cancelReason: bill.cancelReason,
      cancelledAt: iso(bill.cancelledAt),
      paidAt: iso(bill.paidAt),
      orderClosed: CLOSED_ORDER_STATUSES.includes(order.status)
    }
  }
}
