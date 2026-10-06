import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { baseColumns } from './common'

/**
 * Key/value application settings (JSON encoded values).
 * Holds device identity today; restaurant-level settings are added in later phases.
 */
export const settings = sqliteTable(
  'settings',
  {
    ...baseColumns(),
    key: text('key').notNull(),
    value: text('value').notNull()
  },
  (table) => [uniqueIndex('settings_key_unique').on(table.key)]
)

export type SettingRow = typeof settings.$inferSelect
