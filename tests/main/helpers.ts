import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SetupInput } from '@shared/auth-schemas'
import { setupInputSchema } from '@shared/auth-schemas'
import type { AuthOptions } from '@main/auth/auth-service'
import { openDatabase, type DatabaseHandle } from '@main/db/client'
import { runMigrations } from '@main/db/migrate'
import type { Logger } from '@main/logging/log-manager'
import { createServices, type Services } from '@main/services'

export const MIGRATIONS = resolve(__dirname, '../../drizzle')

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

export const OWNER_PASSWORD = 'Tandoor1-Secret'

export const SETUP_INPUT: SetupInput = {
  restaurant: {
    name: 'Test Kitchen',
    legalName: 'Test Kitchen Pvt Ltd',
    address: '1 Main Road',
    city: 'Testville',
    state: 'Punjab',
    country: 'India',
    phone: '+91 98765 43210',
    email: 'hello@example.com',
    gstin: '03ABCDE1234F1Z5',
    receiptFooter: 'Thank you!'
  },
  owner: {
    username: 'Owner',
    fullName: 'Olivia Owner',
    password: OWNER_PASSWORD,
    confirmPassword: OWNER_PASSWORD
  }
}

/** A throw-away migrated database with all services, and a controllable clock. */
export interface TestApp {
  handle: DatabaseHandle
  dir: string
  services: Services
  clock: { now: number; advance: (ms: number) => void }
  restart: () => Services
  cleanup: () => void
}

export function createTestApp(authOptions?: Partial<AuthOptions>): TestApp {
  const dir = mkdtempSync(join(tmpdir(), 'tpos-auth-'))
  const handle = openDatabase(join(dir, 'test.db'))
  runMigrations(handle.db, handle.sqlite, MIGRATIONS)

  const clock = {
    now: Date.UTC(2026, 0, 5, 9, 0, 0),
    advance(ms: number) {
      clock.now += ms
    }
  }
  const build = (): Services =>
    createServices({
      db: handle.db,
      deviceId: 'test-device',
      logger: silentLogger,
      securityLogger: silentLogger,
      allowDemoData: true,
      clock: () => clock.now,
      ...(authOptions ? { authOptions } : {})
    })

  return {
    handle,
    dir,
    clock,
    services: build(),
    restart: build,
    cleanup: () => {
      handle.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

export async function completeSetup(app: TestApp): Promise<void> {
  await app.services.setup.complete(setupInputSchema.parse(SETUP_INPUT))
}

export async function loginAsOwner(app: TestApp) {
  return app.services.auth.login({ username: 'owner', password: OWNER_PASSWORD })
}

/** The error code a call fails with, or null if it succeeds. */
export async function failureCode(call: () => unknown): Promise<string | null> {
  try {
    await call()
    return null
  } catch (error) {
    return (error as { code?: string }).code ?? 'UNKNOWN'
  }
}
