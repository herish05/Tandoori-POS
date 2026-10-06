import { eq } from 'drizzle-orm'
import type { RestaurantData } from '@shared/auth-schemas'
import type { RestaurantProfile } from '@shared/domain'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { markModified, restaurants } from '../db/schema'
import { AppError } from '../ipc/errors'

type RestaurantRow = typeof restaurants.$inferSelect

/** The id of this installation's restaurant. Setup must have been completed. */
export function requireRestaurantId(db: DbExecutor): string {
  const row = db.select({ id: restaurants.id }).from(restaurants).get()
  if (!row) throw new AppError('NOT_AVAILABLE', 'The restaurant has not been set up yet.')
  return row.id
}

function toProfile(row: RestaurantRow): RestaurantProfile {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    address: row.address,
    city: row.city,
    state: row.state,
    country: row.country,
    phone: row.phone,
    email: row.email,
    gstin: row.gstin,
    currency: row.currency,
    timezone: row.timezone,
    receiptFooter: row.receiptFooter,
    logo: row.logo
  }
}

const EDITABLE_FIELDS = [
  'name',
  'legalName',
  'address',
  'city',
  'state',
  'country',
  'phone',
  'email',
  'gstin',
  'currency',
  'timezone',
  'receiptFooter',
  'logo'
] as const

export class RestaurantService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  get(): RestaurantProfile {
    const row = this.db.select().from(restaurants).get()
    if (!row) throw new AppError('NOT_AVAILABLE', 'The restaurant has not been set up yet.')
    return toProfile(row)
  }

  update(auth: AuthContext, input: RestaurantData): RestaurantProfile {
    return this.db.transaction((tx) => {
      const current = tx.select().from(restaurants).get()
      if (!current) throw new AppError('NOT_AVAILABLE', 'The restaurant has not been set up yet.')

      const changed = EDITABLE_FIELDS.filter((field) => current[field] !== input[field])
      if (changed.length === 0) return toProfile(current)

      const updated = tx
        .update(restaurants)
        .set({ ...input, ...markModified(restaurants) })
        .where(eq(restaurants.id, current.id))
        .returning()
        .get()
      this.audit.record(
        {
          action: 'restaurant.updated',
          userId: auth.userId,
          username: auth.username,
          entityType: 'restaurant',
          entityId: current.id,
          // Field names only: values (such as the logo image) do not belong in the audit trail.
          details: { changedFields: changed }
        },
        tx
      )
      return toProfile(updated)
    })
  }
}
