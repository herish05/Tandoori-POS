import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext, Clock } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import {
  inventoryItems,
  markModified,
  purchaseLines,
  purchases,
  supplierPayments,
  suppliers,
  users
} from '../db/schema'
import type { InventoryService } from '../inventory/inventory-service'
import { AppError } from '../ipc/errors'
import { nextDocumentNumber } from '../orders/numbering'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import type { DayLock } from '../finance/day-lock'
import { costOfQuantity } from '@shared/inventory'
import {
  MAX_PURCHASE_AMOUNT,
  paymentStatusOf,
  type CancelPurchaseData,
  type CreatePurchaseData,
  type Purchase,
  type PurchaseFilterData,
  type PurchaseLine,
  type PurchaseSummary,
  type PurchasingSummary,
  type RecordPaymentData,
  type SupplierPayment,
  type UpdatePurchaseData,
  type VoidPaymentData
} from '@shared/purchasing'

type PurchaseRow = typeof purchases.$inferSelect
type PaymentRow = typeof supplierPayments.$inferSelect
type LineInput = CreatePurchaseData['lines'][number]

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (match) => `\\${match}`)

interface PreparedLine {
  inventoryItemId: string
  itemName: string
  unit: PurchaseLine['unit']
  quantity: number
  unitCost: number
  lineTotal: number
  sortOrder: number
}

interface Prepared {
  lines: PreparedLine[]
  subtotal: number
  total: number
}

/**
 * Purchase invoices from suppliers. A purchase is a draft until it is received; receiving puts
 * every line into stock (and notes the price paid as the item's latest cost) in the same
 * transaction, and from then on the invoice is frozen. Payments are recorded against received
 * purchases; a wrong one is voided, never edited.
 */
export class PurchaseService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly inventory: InventoryService,
    private readonly lock: DayLock
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  summary(): PurchasingSummary {
    const rows = this.db
      .select({
        status: purchases.status,
        purchaseDate: purchases.purchaseDate,
        total: purchases.total,
        amountPaid: purchases.amountPaid
      })
      .from(purchases)
      .where(and(isNull(purchases.deletedAt), inArray(purchases.status, ['DRAFT', 'RECEIVED'])))
      .all()
    const now = new Date(this.clock())
    const month = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`
    let draftCount = 0
    let unpaidCount = 0
    let totalDue = 0
    let purchasedThisMonth = 0
    for (const row of rows) {
      if (row.status === 'DRAFT') {
        draftCount += 1
        continue
      }
      const due = row.total - row.amountPaid
      if (due > 0) {
        unpaidCount += 1
        totalDue += due
      }
      if (row.purchaseDate.startsWith(month)) purchasedThisMonth += row.total
    }
    return { draftCount, unpaidCount, totalDue, purchasedThisMonth }
  }

  list(filter: PurchaseFilterData = {}): PurchaseSummary[] {
    const conditions: SQL[] = [isNull(purchases.deletedAt)]
    if (filter.status) conditions.push(eq(purchases.status, filter.status))
    if (filter.supplierId) conditions.push(eq(purchases.supplierId, filter.supplierId))
    if (filter.unpaidOnly) {
      conditions.push(
        eq(purchases.status, 'RECEIVED'),
        sql`${purchases.total} > ${purchases.amountPaid}`
      )
    }
    if (filter.from) conditions.push(gte(purchases.purchaseDate, filter.from))
    if (filter.to) conditions.push(lte(purchases.purchaseDate, filter.to))
    if (filter.search) {
      const like = `%${escapeLike(filter.search)}%`
      const match = or(
        sql`${purchases.purchaseNumber} like ${like} escape '\\'`,
        sql`${purchases.invoiceNumber} like ${like} escape '\\'`,
        sql`${suppliers.name} like ${like} escape '\\'`
      )
      if (match) conditions.push(match)
    }
    const rows = this.db
      .select({
        purchase: purchases,
        supplierName: suppliers.name,
        lineCount: sql<number>`(select count(*) from purchase_lines pl where pl.purchase_id = ${purchases.id} and pl.deleted_at is null)`
      })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(and(...conditions))
      .orderBy(
        desc(purchases.purchaseDate),
        desc(purchases.createdAt),
        desc(purchases.purchaseNumber)
      )
      .limit(filter.limit ?? 300)
      .all()
    return rows.map((row) => this.toSummary(row.purchase, row.supplierName, row.lineCount))
  }

  get(id: string): Purchase {
    return this.load(this.db, id)
  }

  // --- Drafts ------------------------------------------------------------------------------

  create(auth: AuthContext, input: CreatePurchaseData): Purchase {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      this.requireActiveSupplier(tx, input.supplierId)
      const prepared = this.prepare(tx, input.lines, input.discount, input.tax)
      const row = tx
        .insert(purchases)
        .values({
          restaurantId,
          purchaseNumber: nextDocumentNumber(tx, restaurantId, 'PUR'),
          supplierId: input.supplierId,
          invoiceNumber: input.invoiceNumber,
          purchaseDate: input.purchaseDate,
          status: 'DRAFT',
          notes: input.notes,
          subtotal: prepared.subtotal,
          discount: input.discount,
          tax: input.tax,
          total: prepared.total,
          createdBy: auth.userId
        })
        .returning()
        .get()
      this.insertLines(tx, row.id, prepared.lines)
      this.record(tx, auth, 'purchase.created', row.id, {
        purchaseNumber: row.purchaseNumber,
        supplierId: row.supplierId,
        total: row.total
      })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdatePurchaseData): Purchase {
    this.db.transaction((tx) => {
      const current = this.requireDraft(tx, input.id)
      if (input.supplierId !== current.supplierId) this.requireActiveSupplier(tx, input.supplierId)
      const prepared = this.prepare(tx, input.lines, input.discount, input.tax)
      tx.update(purchaseLines)
        .set({ deletedAt: new Date(this.clock()), ...markModified(purchaseLines) })
        .where(and(eq(purchaseLines.purchaseId, current.id), isNull(purchaseLines.deletedAt)))
        .run()
      this.insertLines(tx, current.id, prepared.lines)
      tx.update(purchases)
        .set({
          supplierId: input.supplierId,
          invoiceNumber: input.invoiceNumber,
          purchaseDate: input.purchaseDate,
          notes: input.notes,
          subtotal: prepared.subtotal,
          discount: input.discount,
          tax: input.tax,
          total: prepared.total,
          ...markModified(purchases)
        })
        .where(eq(purchases.id, current.id))
        .run()
      this.record(tx, auth, 'purchase.updated', current.id, {
        purchaseNumber: current.purchaseNumber,
        total: prepared.total
      })
    })
    return this.get(input.id)
  }

  cancel(auth: AuthContext, input: CancelPurchaseData): Purchase {
    this.db.transaction((tx) => {
      const current = this.requireDraft(tx, input.id)
      tx.update(purchases)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(this.clock()),
          cancelledBy: auth.userId,
          cancelReason: input.reason,
          ...markModified(purchases)
        })
        .where(eq(purchases.id, current.id))
        .run()
      this.record(tx, auth, 'purchase.cancelled', current.id, {
        purchaseNumber: current.purchaseNumber,
        reason: input.reason
      })
    })
    return this.get(input.id)
  }

  // --- Receiving ---------------------------------------------------------------------------

  /** Puts every line into stock at the price paid and freezes the invoice. */
  receive(auth: AuthContext, id: string): Purchase {
    this.db.transaction((tx) => {
      const current = this.requireDraft(tx, id)
      const lines = tx
        .select()
        .from(purchaseLines)
        .where(and(eq(purchaseLines.purchaseId, id), isNull(purchaseLines.deletedAt)))
        .orderBy(asc(purchaseLines.sortOrder))
        .all()
      if (lines.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'Add at least one item before receiving.')
      }
      for (const line of lines) {
        const [item] = tx
          .select({
            name: inventoryItems.name,
            unit: inventoryItems.unit,
            isActive: inventoryItems.isActive
          })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.id, line.inventoryItemId), isNull(inventoryItems.deletedAt)))
          .all()
        if (!item) {
          throw new AppError('CONFLICT', `${line.itemName} no longer exists in stock.`)
        }
        if (!item.isActive) {
          throw new AppError(
            'CONFLICT',
            `${item.name} has been retired. Activate it or remove the line.`
          )
        }
        if (item.unit !== line.unit) {
          throw new AppError(
            'CONFLICT',
            `The unit of ${item.name} has changed since this purchase was drafted. Edit the purchase and enter the quantity again.`
          )
        }
      }
      for (const line of lines) {
        this.inventory.receiveStock(
          tx,
          auth,
          line.inventoryItemId,
          line.quantity,
          line.unitCost,
          `Purchase ${current.purchaseNumber}`
        )
      }
      const [updated] = tx
        .update(purchases)
        .set({
          status: 'RECEIVED',
          receivedAt: new Date(this.clock()),
          receivedBy: auth.userId,
          ...markModified(purchases)
        })
        .where(and(eq(purchases.id, id), eq(purchases.status, 'DRAFT')))
        .returning({ id: purchases.id })
        .all()
      if (!updated) throw new AppError('CONFLICT', 'This purchase has already been received.')
      this.record(tx, auth, 'purchase.received', id, {
        purchaseNumber: current.purchaseNumber,
        total: current.total,
        lines: lines.length
      })
    })
    return this.get(id)
  }

  // --- Payments ----------------------------------------------------------------------------

  recordPayment(auth: AuthContext, input: RecordPaymentData): Purchase {
    this.db.transaction((tx) => {
      const current = this.requirePurchase(tx, input.purchaseId)
      if (current.status !== 'RECEIVED') {
        throw new AppError('CONFLICT', 'Payments can only be recorded against a received purchase.')
      }
      const due = current.total - current.amountPaid
      if (input.amount > due) {
        throw new AppError('VALIDATION_ERROR', 'That is more than is still owed on this purchase.')
      }
      const paidAt = input.paidAt ? new Date(input.paidAt) : new Date(this.clock())
      this.lock.assertOpen(tx, 'record a supplier payment', paidAt)
      tx.insert(supplierPayments)
        .values({
          restaurantId: current.restaurantId,
          purchaseId: current.id,
          supplierId: current.supplierId,
          amount: input.amount,
          method: input.method,
          reference: input.reference,
          notes: input.notes,
          paidAt,
          recordedBy: auth.userId
        })
        .run()
      this.syncAmountPaid(tx, current.id)
      this.record(tx, auth, 'purchase.payment_recorded', current.id, {
        purchaseNumber: current.purchaseNumber,
        amount: input.amount,
        method: input.method
      })
    })
    return this.get(input.purchaseId)
  }

  voidPayment(auth: AuthContext, input: VoidPaymentData): Purchase {
    const purchaseId = this.db.transaction((tx) => {
      const [payment] = tx
        .select()
        .from(supplierPayments)
        .where(and(eq(supplierPayments.id, input.id), isNull(supplierPayments.deletedAt)))
        .all()
      if (!payment) throw new AppError('NOT_FOUND', 'That payment no longer exists.')
      if (payment.voidedAt) throw new AppError('CONFLICT', 'That payment is already voided.')
      this.lock.assertOpen(tx, 'void a supplier payment', payment.paidAt)
      const purchase = this.requirePurchase(tx, payment.purchaseId)
      tx.update(supplierPayments)
        .set({
          voidedAt: new Date(this.clock()),
          voidedBy: auth.userId,
          voidReason: input.reason,
          ...markModified(supplierPayments)
        })
        .where(eq(supplierPayments.id, payment.id))
        .run()
      this.syncAmountPaid(tx, purchase.id)
      this.record(tx, auth, 'purchase.payment_voided', purchase.id, {
        purchaseNumber: purchase.purchaseNumber,
        amount: payment.amount,
        reason: input.reason
      })
      return purchase.id
    })
    return this.get(purchaseId)
  }

  // --- Internals ---------------------------------------------------------------------------

  /** Checks each line against live stock items and works out the totals. */
  private prepare(
    tx: DbExecutor,
    lines: readonly LineInput[],
    discount: number,
    tax: number
  ): Prepared {
    const items = tx
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        unit: inventoryItems.unit,
        isActive: inventoryItems.isActive
      })
      .from(inventoryItems)
      .where(
        and(
          inArray(
            inventoryItems.id,
            lines.map((line) => line.inventoryItemId)
          ),
          isNull(inventoryItems.deletedAt)
        )
      )
      .all()
    const byId = new Map(items.map((item) => [item.id, item]))
    const prepared = lines.map((line, index): PreparedLine => {
      const item = byId.get(line.inventoryItemId)
      if (!item) throw new AppError('NOT_FOUND', 'A stock item on this purchase no longer exists.')
      if (!item.isActive) {
        throw new AppError(
          'VALIDATION_ERROR',
          `${item.name} is retired. Activate it before buying it.`
        )
      }
      return {
        inventoryItemId: item.id,
        itemName: item.name,
        unit: item.unit,
        quantity: line.quantity,
        unitCost: line.unitCost,
        lineTotal: costOfQuantity(line.quantity, line.unitCost),
        sortOrder: index
      }
    })
    const subtotal = prepared.reduce((sum, line) => sum + line.lineTotal, 0)
    if (discount > subtotal) {
      throw new AppError('VALIDATION_ERROR', 'The discount cannot be more than the items total.')
    }
    const total = subtotal - discount + tax
    if (total > MAX_PURCHASE_AMOUNT) {
      throw new AppError('VALIDATION_ERROR', 'The purchase total is too large.')
    }
    return { lines: prepared, subtotal, total }
  }

  private insertLines(tx: DbExecutor, purchaseId: string, lines: readonly PreparedLine[]): void {
    for (const line of lines) {
      tx.insert(purchaseLines)
        .values({
          purchaseId,
          inventoryItemId: line.inventoryItemId,
          itemName: line.itemName,
          unit: line.unit,
          quantity: line.quantity,
          unitCost: line.unitCost,
          lineTotal: line.lineTotal,
          sortOrder: line.sortOrder
        })
        .run()
    }
  }

  /** Keeps the running paid total equal to the payments that are not voided. */
  private syncAmountPaid(tx: DbExecutor, purchaseId: string): void {
    const [row] = tx
      .select({ paid: sql<number>`coalesce(sum(${supplierPayments.amount}), 0)` })
      .from(supplierPayments)
      .where(
        and(
          eq(supplierPayments.purchaseId, purchaseId),
          isNull(supplierPayments.deletedAt),
          isNull(supplierPayments.voidedAt)
        )
      )
      .all()
    tx.update(purchases)
      .set({ amountPaid: row?.paid ?? 0, ...markModified(purchases) })
      .where(eq(purchases.id, purchaseId))
      .run()
  }

  private load(db: DbExecutor, id: string): Purchase {
    const row = this.requirePurchase(db, id)
    const [supplier] = db
      .select({ name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.id, row.supplierId))
      .all()
    const lines = db
      .select()
      .from(purchaseLines)
      .where(and(eq(purchaseLines.purchaseId, id), isNull(purchaseLines.deletedAt)))
      .orderBy(asc(purchaseLines.sortOrder))
      .all()
    const payments = db
      .select()
      .from(supplierPayments)
      .where(and(eq(supplierPayments.purchaseId, id), isNull(supplierPayments.deletedAt)))
      .orderBy(asc(supplierPayments.paidAt), asc(supplierPayments.createdAt))
      .all()
    const userIds = [
      ...new Set(
        [row.createdBy, row.receivedBy, ...payments.map((payment) => payment.recordedBy)].filter(
          (value): value is string => value !== null
        )
      )
    ]
    const names = new Map(
      userIds.length === 0
        ? []
        : db
            .select({ id: users.id, fullName: users.fullName })
            .from(users)
            .where(inArray(users.id, userIds))
            .all()
            .map((user) => [user.id, user.fullName] as const)
    )
    return {
      ...this.toSummary(row, supplier?.name ?? 'Unknown supplier', lines.length),
      notes: row.notes,
      subtotal: row.subtotal,
      discount: row.discount,
      tax: row.tax,
      lines: lines.map((line): PurchaseLine => ({
        id: line.id,
        inventoryItemId: line.inventoryItemId,
        itemName: line.itemName,
        unit: line.unit,
        quantity: line.quantity,
        unitCost: line.unitCost,
        lineTotal: line.lineTotal
      })),
      payments: payments.map((payment) => this.toPayment(payment, names)),
      receivedAt: row.receivedAt?.toISOString() ?? null,
      receivedBy: row.receivedBy ? (names.get(row.receivedBy) ?? null) : null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      createdBy: names.get(row.createdBy) ?? null
    }
  }

  private toSummary(row: PurchaseRow, supplierName: string, lineCount: number): PurchaseSummary {
    return {
      id: row.id,
      purchaseNumber: row.purchaseNumber,
      supplierId: row.supplierId,
      supplierName,
      invoiceNumber: row.invoiceNumber,
      purchaseDate: row.purchaseDate,
      status: row.status,
      paymentStatus: paymentStatusOf(row.status, row.total, row.amountPaid),
      lineCount,
      total: row.total,
      amountPaid: row.amountPaid,
      amountDue: row.status === 'RECEIVED' ? row.total - row.amountPaid : 0,
      createdAt: row.createdAt.toISOString()
    }
  }

  private toPayment(row: PaymentRow, names: Map<string, string>): SupplierPayment {
    return {
      id: row.id,
      amount: row.amount,
      method: row.method,
      reference: row.reference,
      notes: row.notes,
      paidAt: row.paidAt.toISOString(),
      recordedBy: names.get(row.recordedBy) ?? null,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidReason: row.voidReason
    }
  }

  private requirePurchase(db: DbExecutor, id: string): PurchaseRow {
    const [row] = db
      .select()
      .from(purchases)
      .where(and(eq(purchases.id, id), isNull(purchases.deletedAt)))
      .all()
    if (!row) throw new AppError('NOT_FOUND', 'That purchase no longer exists.')
    return row
  }

  private requireDraft(db: DbExecutor, id: string): PurchaseRow {
    const row = this.requirePurchase(db, id)
    if (row.status !== 'DRAFT') {
      throw new AppError(
        'CONFLICT',
        row.status === 'RECEIVED'
          ? 'This purchase has already been received and cannot be changed.'
          : 'This purchase was cancelled.'
      )
    }
    return row
  }

  private requireActiveSupplier(db: DbExecutor, id: string): void {
    const [row] = db
      .select({ isActive: suppliers.isActive })
      .from(suppliers)
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .all()
    if (!row) throw new AppError('NOT_FOUND', 'That supplier no longer exists.')
    if (!row.isActive) {
      throw new AppError(
        'VALIDATION_ERROR',
        'That supplier is deactivated. Activate it to buy from it.'
      )
    }
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: AuditAction,
    purchaseId: string,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'purchase',
        entityId: purchaseId,
        details
      },
      tx
    )
  }
}
