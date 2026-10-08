import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { markModified, purchases, suppliers } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import { normalizePhone } from '@shared/customers'
import type {
  CreateSupplierData,
  SetSupplierActiveData,
  Supplier,
  SupplierFilterData,
  UpdateSupplierData
} from '@shared/purchasing'

type SupplierRow = typeof suppliers.$inferSelect

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (match) => `\\${match}`)

interface Stats {
  purchaseCount: number
  totalPurchased: number
  amountDue: number
  lastPurchaseDate: string | null
}

const NO_STATS: Stats = {
  purchaseCount: 0,
  totalPurchased: 0,
  amountDue: 0,
  lastPurchaseDate: null
}

/**
 * The people the restaurant buys from. Totals and what is owed come from received purchases only;
 * a supplier with any purchase on record cannot be deleted (deactivate it instead).
 */
export class SupplierService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  list(filter: SupplierFilterData = {}): Supplier[] {
    const conditions: SQL[] = [isNull(suppliers.deletedAt)]
    if (!filter.includeInactive) conditions.push(eq(suppliers.isActive, true))
    if (filter.search) {
      const like = `%${escapeLike(filter.search)}%`
      const digits = filter.search.replace(/\D/g, '')
      const phoneLike = digits.length >= 2 ? `%${escapeLike(normalizePhone(digits))}%` : null
      conditions.push(
        phoneLike
          ? sql`(${suppliers.name} like ${like} escape '\\' or ${suppliers.contactPerson} like ${like} escape '\\' or ${suppliers.phone} like ${phoneLike} escape '\\')`
          : sql`(${suppliers.name} like ${like} escape '\\' or ${suppliers.contactPerson} like ${like} escape '\\')`
      )
    }
    const rows = this.db
      .select()
      .from(suppliers)
      .where(and(...conditions))
      .orderBy(asc(sql`lower(${suppliers.name})`))
      .all()
    const stats = this.stats(this.db)
    const result = rows.map((row) => this.toSupplier(row, stats.get(row.id) ?? NO_STATS))
    return filter.dueOnly ? result.filter((supplier) => supplier.amountDue > 0) : result
  }

  get(id: string): Supplier {
    return this.load(this.db, id)
  }

  // --- Changes -----------------------------------------------------------------------------

  create(auth: AuthContext, input: CreateSupplierData): Supplier {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      this.assertNameFree(tx, restaurantId, input.name)
      const row = tx
        .insert(suppliers)
        .values({
          restaurantId,
          name: input.name,
          contactPerson: input.contactPerson,
          phone: input.phone,
          email: input.email,
          address: input.address,
          gstin: input.gstin,
          notes: input.notes
        })
        .returning()
        .get()
      this.record(tx, auth, 'supplier.created', row.id, { name: row.name })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateSupplierData): Supplier {
    this.db.transaction((tx) => {
      const current = this.requireSupplier(tx, input.id)
      this.assertNameFree(tx, current.restaurantId, input.name, current.id)
      tx.update(suppliers)
        .set({
          name: input.name,
          contactPerson: input.contactPerson,
          phone: input.phone,
          email: input.email,
          address: input.address,
          gstin: input.gstin,
          notes: input.notes,
          ...markModified(suppliers)
        })
        .where(eq(suppliers.id, current.id))
        .run()
      this.record(tx, auth, 'supplier.updated', current.id, {
        name: input.name,
        previousName: current.name
      })
    })
    return this.get(input.id)
  }

  setActive(auth: AuthContext, input: SetSupplierActiveData): Supplier {
    this.db.transaction((tx) => {
      const current = this.requireSupplier(tx, input.id)
      if (current.isActive === input.isActive) return
      tx.update(suppliers)
        .set({ isActive: input.isActive, ...markModified(suppliers) })
        .where(eq(suppliers.id, current.id))
        .run()
      this.record(
        tx,
        auth,
        input.isActive ? 'supplier.activated' : 'supplier.deactivated',
        current.id,
        {
          name: current.name
        }
      )
    })
    return this.get(input.id)
  }

  delete(auth: AuthContext, id: string): null {
    this.db.transaction((tx) => {
      const current = this.requireSupplier(tx, id)
      const [used] = tx
        .select({ id: purchases.id })
        .from(purchases)
        .where(and(eq(purchases.supplierId, id), isNull(purchases.deletedAt)))
        .limit(1)
        .all()
      if (used) {
        throw new AppError(
          'CONFLICT',
          'This supplier has purchases on record. Deactivate it instead of deleting it.'
        )
      }
      tx.update(suppliers)
        .set({ deletedAt: new Date(), ...markModified(suppliers) })
        .where(eq(suppliers.id, id))
        .run()
      this.record(tx, auth, 'supplier.deleted', id, { name: current.name })
    })
    return null
  }

  // --- Internals ---------------------------------------------------------------------------

  /** Per supplier: what was bought (received purchases) and what is still owed. */
  private stats(db: DbExecutor): Map<string, Stats> {
    const rows = db
      .select({
        supplierId: purchases.supplierId,
        purchaseCount: sql<number>`count(*)`,
        totalPurchased: sql<number>`coalesce(sum(${purchases.total}), 0)`,
        amountDue: sql<number>`coalesce(sum(${purchases.total} - ${purchases.amountPaid}), 0)`,
        lastPurchaseDate: sql<string | null>`max(${purchases.purchaseDate})`
      })
      .from(purchases)
      .where(and(isNull(purchases.deletedAt), eq(purchases.status, 'RECEIVED')))
      .groupBy(purchases.supplierId)
      .all()
    return new Map(
      rows.map((row) => [
        row.supplierId,
        {
          purchaseCount: row.purchaseCount,
          totalPurchased: row.totalPurchased,
          amountDue: row.amountDue,
          lastPurchaseDate: row.lastPurchaseDate
        }
      ])
    )
  }

  private load(db: DbExecutor, id: string): Supplier {
    const row = this.requireSupplier(db, id)
    return this.toSupplier(row, this.stats(db).get(id) ?? NO_STATS)
  }

  private toSupplier(row: SupplierRow, stats: Stats): Supplier {
    return {
      id: row.id,
      name: row.name,
      contactPerson: row.contactPerson,
      phone: row.phone,
      email: row.email,
      address: row.address,
      gstin: row.gstin,
      notes: row.notes,
      isActive: row.isActive,
      ...stats,
      createdAt: row.createdAt.toISOString()
    }
  }

  private requireSupplier(db: DbExecutor, id: string): SupplierRow {
    const [row] = db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .all()
    if (!row) throw new AppError('NOT_FOUND', 'That supplier no longer exists.')
    return row
  }

  private assertNameFree(
    db: DbExecutor,
    restaurantId: string,
    name: string,
    exceptId?: string
  ): void {
    const clash = db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.restaurantId, restaurantId),
          isNull(suppliers.deletedAt),
          sql`lower(${suppliers.name}) = lower(${name})`
        )
      )
      .all()
      .find((row) => row.id !== exceptId)
    if (clash) throw new AppError('CONFLICT', 'There is already a supplier with that name.')
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: AuditAction,
    supplierId: string,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType: 'supplier',
        entityId: supplierId,
        details
      },
      tx
    )
  }
}
