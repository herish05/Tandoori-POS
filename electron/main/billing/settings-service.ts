import { eq } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { billingSettings, markModified } from '../db/schema'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import {
  DEFAULT_BILLING_SETTINGS,
  type BillingSettings,
  type RoundOffUnit,
  type UpdateBillingSettingsData
} from '@shared/billing'

type SettingsRow = typeof billingSettings.$inferSelect

function toSettings(row: SettingsRow): BillingSettings {
  return {
    taxMode: row.taxMode,
    serviceChargeBps: row.serviceChargeBps,
    serviceChargeDineInOnly: row.serviceChargeDineInOnly,
    serviceChargeTaxable: row.serviceChargeTaxable,
    // The table's check constraint keeps this to the supported units.
    roundOffUnit: row.roundOffUnit as RoundOffUnit,
    autoPrintReceipt: row.autoPrintReceipt
  }
}

/**
 * How the restaurant bills: the GST split, the service charge and the round off. The values live
 * in the database; until the owner changes them the documented defaults apply. A bill copies the
 * settings it was made with, so a change here only affects bills made afterwards.
 */
export class BillingSettingsService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  get(executor: DbExecutor = this.db): BillingSettings {
    const row = executor.select().from(billingSettings).get()
    return row ? toSettings(row) : { ...DEFAULT_BILLING_SETTINGS }
  }

  update(auth: AuthContext, input: UpdateBillingSettingsData): BillingSettings {
    this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      const before = this.get(tx)
      const existing = tx
        .select({ id: billingSettings.id })
        .from(billingSettings)
        .where(eq(billingSettings.restaurantId, restaurantId))
        .get()
      const values = {
        taxMode: input.taxMode,
        serviceChargeBps: input.serviceChargeBps,
        serviceChargeDineInOnly: input.serviceChargeDineInOnly,
        serviceChargeTaxable: input.serviceChargeTaxable,
        roundOffUnit: input.roundOffUnit,
        autoPrintReceipt: input.autoPrintReceipt,
        updatedBy: auth.userId
      }
      if (existing) {
        tx.update(billingSettings)
          .set({ ...values, ...markModified(billingSettings) })
          .where(eq(billingSettings.id, existing.id))
          .run()
      } else {
        tx.insert(billingSettings)
          .values({ restaurantId, ...values })
          .run()
      }
      this.audit.record(
        {
          action: 'billing.settings_updated',
          userId: auth.userId,
          username: auth.username,
          entityType: 'billing_settings',
          entityId: existing?.id ?? restaurantId,
          details: {
            from: before,
            to: {
              taxMode: input.taxMode,
              serviceChargeBps: input.serviceChargeBps,
              serviceChargeDineInOnly: input.serviceChargeDineInOnly,
              serviceChargeTaxable: input.serviceChargeTaxable,
              roundOffUnit: input.roundOffUnit,
              autoPrintReceipt: input.autoPrintReceipt
            }
          }
        },
        tx
      )
    })
    return this.get()
  }
}
