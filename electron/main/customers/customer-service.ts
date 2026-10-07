import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql, type SQL } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { bills, customerAddresses, customers, markModified, orders } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import {
  normalizePhone,
  type AddAddressData,
  type CreateCustomerData,
  type CustomerAddress,
  type CustomerDetail,
  type CustomerFilterData,
  type CustomerLookupData,
  type CustomerLookupResult,
  type CustomerSummary,
  type UpdateAddressData,
  type UpdateCustomerData
} from '@shared/customers'

type CustomerRow = typeof customers.$inferSelect
type AddressRow = typeof customerAddresses.$inferSelect

const RECENT_ORDERS = 20
const LOOKUP_LIMIT = 8

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (match) => `\\${match}`)

interface Stats {
  orderCount: number
  totalSpent: number
  lastOrderAt: Date | null
}

export class CustomerService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  list(filter: CustomerFilterData = {}): CustomerSummary[] {
    const conditions: SQL[] = [isNull(customers.deletedAt)]
    if (filter.search) conditions.push(this.searchCondition(filter.search))
    const rows = this.db
      .select()
      .from(customers)
      .where(and(...conditions))
      .orderBy(asc(customers.name), asc(customers.phone))
      .limit(filter.limit ?? 200)
      .all()
    return this.summarise(this.db, rows)
  }

  get(id: string): CustomerDetail {
    return this.loadDetail(this.db, id)
  }

  /** A few matches for the order screen's search box, with their saved addresses. */
  lookup(input: CustomerLookupData): CustomerLookupResult[] {
    const rows = this.db
      .select()
      .from(customers)
      .where(and(isNull(customers.deletedAt), this.searchCondition(input.query)))
      .orderBy(asc(customers.name))
      .limit(LOOKUP_LIMIT)
      .all()
    const summaries = this.summarise(this.db, rows)
    const addresses = this.addressesOf(
      this.db,
      rows.map((row) => row.id)
    )
    return summaries.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      orderCount: customer.orderCount,
      lastOrderAt: customer.lastOrderAt,
      addresses: addresses.get(customer.id) ?? []
    }))
  }

  // --- Writes ------------------------------------------------------------------------------

  create(auth: AuthContext, input: CreateCustomerData): CustomerDetail {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      this.assertPhoneFree(tx, restaurantId, input.phone)
      const row = tx
        .insert(customers)
        .values({
          restaurantId,
          name: input.name,
          phone: input.phone,
          email: input.email,
          notes: input.notes
        })
        .returning()
        .get()
      this.record(tx, auth, 'customer.created', row.id, { source: 'manual', phone: row.phone })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateCustomerData): CustomerDetail {
    this.db.transaction((tx) => {
      const current = this.requireCustomer(tx, input.id)
      if (input.phone !== current.phone) {
        this.assertPhoneFree(tx, current.restaurantId, input.phone, current.id)
      }
      const next = {
        name: input.name,
        phone: input.phone,
        email: input.email,
        notes: input.notes
      }
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
        (field) => next[field] !== current[field]
      )
      if (changed.length === 0) return
      tx.update(customers)
        .set({ ...next, ...markModified(customers) })
        .where(eq(customers.id, current.id))
        .run()
      this.record(tx, auth, 'customer.updated', current.id, { changedFields: changed })
    })
    return this.get(input.id)
  }

  /** Soft delete: old orders keep pointing at the customer, but they leave every list. */
  delete(auth: AuthContext, id: string): null {
    this.db.transaction((tx) => {
      const current = this.requireCustomer(tx, id)
      const now = new Date()
      tx.update(customerAddresses)
        .set({ deletedAt: now, ...markModified(customerAddresses) })
        .where(and(eq(customerAddresses.customerId, id), isNull(customerAddresses.deletedAt)))
        .run()
      tx.update(customers)
        .set({ deletedAt: now, ...markModified(customers) })
        .where(eq(customers.id, id))
        .run()
      this.record(tx, auth, 'customer.deleted', id, { name: current.name, phone: current.phone })
    })
    return null
  }

  addAddress(auth: AuthContext, input: AddAddressData): CustomerDetail {
    this.db.transaction((tx) => {
      this.requireCustomer(tx, input.customerId)
      const existing = this.liveAddresses(tx, input.customerId)
      const makeDefault = input.isDefault || existing.length === 0
      if (makeDefault) this.clearDefault(tx, input.customerId)
      const row = tx
        .insert(customerAddresses)
        .values({
          customerId: input.customerId,
          label: input.label,
          address: input.address,
          landmark: input.landmark,
          isDefault: makeDefault
        })
        .returning()
        .get()
      this.record(tx, auth, 'customer.address_added', input.customerId, {
        addressId: row.id,
        label: row.label
      })
    })
    return this.get(input.customerId)
  }

  updateAddress(auth: AuthContext, input: UpdateAddressData): CustomerDetail {
    const customerId = this.db.transaction((tx) => {
      const current = this.requireAddress(tx, input.id)
      if (input.isDefault && !current.isDefault) this.clearDefault(tx, current.customerId)
      // An address that is the only (default) one stays the default.
      const isDefault = input.isDefault || current.isDefault
      tx.update(customerAddresses)
        .set({
          label: input.label,
          address: input.address,
          landmark: input.landmark,
          isDefault,
          ...markModified(customerAddresses)
        })
        .where(eq(customerAddresses.id, current.id))
        .run()
      this.record(tx, auth, 'customer.address_updated', current.customerId, {
        addressId: current.id
      })
      return current.customerId
    })
    return this.get(customerId)
  }

  removeAddress(auth: AuthContext, id: string): CustomerDetail {
    const customerId = this.db.transaction((tx) => {
      const current = this.requireAddress(tx, id)
      tx.update(customerAddresses)
        .set({ deletedAt: new Date(), isDefault: false, ...markModified(customerAddresses) })
        .where(eq(customerAddresses.id, id))
        .run()
      if (current.isDefault) {
        const next = this.liveAddresses(tx, current.customerId)[0]
        if (next) {
          tx.update(customerAddresses)
            .set({ isDefault: true, ...markModified(customerAddresses) })
            .where(eq(customerAddresses.id, next.id))
            .run()
        }
      }
      this.record(tx, auth, 'customer.address_removed', current.customerId, { addressId: id })
      return current.customerId
    })
    return this.get(customerId)
  }

  // --- Internals ---------------------------------------------------------------------------

  private searchCondition(search: string): SQL {
    const like = `%${escapeLike(search)}%`
    const digits = search.replace(/\D/g, '')
    const phoneLike = digits.length >= 2 ? `%${escapeLike(normalizePhone(digits))}%` : null
    return phoneLike
      ? sql`(${customers.name} like ${like} escape '\\' or ${customers.phone} like ${phoneLike} escape '\\')`
      : sql`${customers.name} like ${like} escape '\\'`
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: AuditAction,
    customerId: string,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'customer',
        entityId: customerId,
        details
      },
      tx
    )
  }

  private requireCustomer(db: DbExecutor, id: string): CustomerRow {
    const row = db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That customer no longer exists.')
    return row
  }

  private requireAddress(db: DbExecutor, id: string): AddressRow {
    const row = db
      .select()
      .from(customerAddresses)
      .where(and(eq(customerAddresses.id, id), isNull(customerAddresses.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That address no longer exists.')
    return row
  }

  private assertPhoneFree(
    db: DbExecutor,
    restaurantId: string,
    phone: string,
    exceptId?: string
  ): void {
    const clash = db
      .select({ name: customers.name })
      .from(customers)
      .where(
        and(
          eq(customers.restaurantId, restaurantId),
          eq(customers.phone, phone),
          isNull(customers.deletedAt),
          exceptId ? ne(customers.id, exceptId) : undefined
        )
      )
      .get()
    if (clash) {
      throw new AppError('CONFLICT', `${clash.name} already uses this phone number.`)
    }
  }

  private clearDefault(tx: DbExecutor, customerId: string): void {
    tx.update(customerAddresses)
      .set({ isDefault: false, ...markModified(customerAddresses) })
      .where(
        and(
          eq(customerAddresses.customerId, customerId),
          eq(customerAddresses.isDefault, true),
          isNull(customerAddresses.deletedAt)
        )
      )
      .run()
  }

  private liveAddresses(db: DbExecutor, customerId: string): AddressRow[] {
    return db
      .select()
      .from(customerAddresses)
      .where(and(eq(customerAddresses.customerId, customerId), isNull(customerAddresses.deletedAt)))
      .orderBy(desc(customerAddresses.isDefault), asc(customerAddresses.createdAt))
      .all()
  }

  private addressesOf(db: DbExecutor, customerIds: string[]): Map<string, CustomerAddress[]> {
    const result = new Map<string, CustomerAddress[]>()
    if (customerIds.length === 0) return result
    const rows = db
      .select()
      .from(customerAddresses)
      .where(
        and(inArray(customerAddresses.customerId, customerIds), isNull(customerAddresses.deletedAt))
      )
      .orderBy(desc(customerAddresses.isDefault), asc(customerAddresses.createdAt))
      .all()
    for (const row of rows) {
      const list = result.get(row.customerId) ?? []
      list.push({
        id: row.id,
        label: row.label,
        address: row.address,
        landmark: row.landmark,
        isDefault: row.isDefault
      })
      result.set(row.customerId, list)
    }
    return result
  }

  private statsOf(db: DbExecutor, customerIds: string[]): Map<string, Stats> {
    const result = new Map<string, Stats>()
    if (customerIds.length === 0) return result
    const counts = db
      .select({
        customerId: orders.customerId,
        orderCount: sql<number>`count(*)`,
        lastOrderAt: sql<number | null>`max(${orders.createdAt})`
      })
      .from(orders)
      .where(
        and(
          inArray(orders.customerId, customerIds),
          isNull(orders.deletedAt),
          notInArray(orders.status, ['CANCELLED'])
        )
      )
      .groupBy(orders.customerId)
      .all()
    for (const row of counts) {
      if (!row.customerId) continue
      result.set(row.customerId, {
        orderCount: row.orderCount,
        totalSpent: 0,
        lastOrderAt: row.lastOrderAt === null ? null : new Date(row.lastOrderAt)
      })
    }
    const spent = db
      .select({
        customerId: orders.customerId,
        total: sql<number>`coalesce(sum(${bills.paidTotal}), 0)`
      })
      .from(bills)
      .innerJoin(orders, eq(bills.orderId, orders.id))
      .where(
        and(
          inArray(orders.customerId, customerIds),
          isNull(bills.deletedAt),
          inArray(bills.status, ['PAID', 'PARTIAL'])
        )
      )
      .groupBy(orders.customerId)
      .all()
    for (const row of spent) {
      const stats = row.customerId ? result.get(row.customerId) : undefined
      if (stats) stats.totalSpent = row.total
    }
    return result
  }

  private summarise(db: DbExecutor, rows: CustomerRow[]): CustomerSummary[] {
    const stats = this.statsOf(
      db,
      rows.map((row) => row.id)
    )
    return rows.map((row) => {
      const own = stats.get(row.id)
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        notes: row.notes,
        orderCount: own?.orderCount ?? 0,
        totalSpent: own?.totalSpent ?? 0,
        lastOrderAt: own?.lastOrderAt ? own.lastOrderAt.toISOString() : null,
        createdAt: row.createdAt.toISOString()
      }
    })
  }

  private loadDetail(db: DbExecutor, id: string): CustomerDetail {
    const row = this.requireCustomer(db, id)
    const [summary] = this.summarise(db, [row])
    if (!summary) throw new AppError('NOT_FOUND', 'That customer no longer exists.')
    const recent = db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        type: orders.type,
        status: orders.status,
        subtotal: orders.subtotal,
        createdAt: orders.createdAt
      })
      .from(orders)
      .where(and(eq(orders.customerId, id), isNull(orders.deletedAt)))
      .orderBy(desc(orders.createdAt))
      .limit(RECENT_ORDERS)
      .all()
    return {
      ...summary,
      addresses: this.addressesOf(db, [id]).get(id) ?? [],
      recentOrders: recent.map((order) => ({
        ...order,
        createdAt: order.createdAt.toISOString()
      }))
    }
  }
}
