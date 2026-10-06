import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from './client'
import { settings } from './schema'

/**
 * Typed access to the `settings` table. Values are stored as JSON text.
 * Kept deliberately small: feature modules own their own repositories.
 */
export class SettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  get(key: string): unknown {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get()
    if (!row) return undefined
    return JSON.parse(row.value) as unknown
  }

  set(key: string, value: unknown): void {
    const encoded = JSON.stringify(value)
    this.db.transaction((tx) => {
      const existing = tx.select().from(settings).where(eq(settings.key, key)).get()
      if (existing) {
        tx.update(settings)
          .set({ value: encoded, version: existing.version + 1, syncStatus: 'PENDING' })
          .where(eq(settings.id, existing.id))
          .run()
      } else {
        tx.insert(settings).values({ key, value: encoded }).run()
      }
    })
  }
}

export const SETTING_KEYS = {
  deviceId: 'device.id',
  firstBootAt: 'device.first_boot_at'
} as const

/**
 * Every installation gets a stable, random device identity on first launch.
 * It is used from Phase 19 to attribute synchronised operations to a device.
 */
export function ensureDeviceIdentity(repo: SettingsRepository): string {
  const existing = repo.get(SETTING_KEYS.deviceId)
  if (typeof existing === 'string' && existing.length > 0) return existing

  const deviceId = randomUUID()
  repo.set(SETTING_KEYS.deviceId, deviceId)
  repo.set(SETTING_KEYS.firstBootAt, new Date().toISOString())
  return deviceId
}
