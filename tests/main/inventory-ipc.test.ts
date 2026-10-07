import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { InventoryItem, InventorySummary, Recipe } from '@shared/inventory'
import type { PermissionCode } from '@shared/permissions'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { registerInventoryHandlers } from '@main/inventory-handlers'
import { createIpcRegistrar } from '@main/ipc/registrar'
import { completeSetup, createTestApp, loginAsOwner, silentLogger, type TestApp } from './helpers'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, raw: unknown) => Promise<unknown>) => {
      electron.handlers.set(channel, fn)
    }
  }
}))

const trustedEvent = { senderFrame: { url: 'app://tandoori-pos/index.html' } }

async function invoke<T = unknown>(channel: string, raw?: unknown) {
  const handler = electron.handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return (await handler(trustedEvent, raw)) as IpcResult<T>
}

const errorCode = (result: IpcResult<unknown>): string | null =>
  result.ok ? null : result.error.code

const PASSWORD = 'Biryani-2026'

describe('inventory IPC', () => {
  let app: TestApp

  const signInWith = async (username: string, permissions: PermissionCode[]) => {
    const owner = app.services.auth.authorize([])
    const role = app.services.roles.create(
      owner,
      createRoleInputSchema.parse({ name: `Role ${username}`, permissions })
    )
    await app.services.users.create(
      owner,
      createStaffInputSchema.parse({
        username,
        password: PASSWORD,
        fullName: `Staff ${username}`,
        roleIds: [role.id]
      })
    )
    app.services.auth.logout()
    await invoke(IPC_CHANNELS.authLogin, { username, password: PASSWORD })
    await invoke(IPC_CHANNELS.authChangePassword, {
      currentPassword: PASSWORD,
      newPassword: 'Fresh-Password-9',
      confirmPassword: 'Fresh-Password-9'
    })
  }

  beforeEach(async () => {
    electron.handlers.clear()
    app = createTestApp()
    await completeSetup(app)
    const registrar = createIpcRegistrar({
      logger: silentLogger,
      securityLogger: silentLogger,
      isTrustedSender: () => true,
      authorize: (required, options) => app.services.auth.authorize(required, options)
    })
    registerAuthHandlers(registrar, app.services)
    registerInventoryHandlers(registrar, app.services)
    await loginAsOwner(app)
  })
  afterEach(() => {
    app.cleanup()
  })

  it('needs a session', async () => {
    app.services.auth.logout()
    expect(errorCode(await invoke(IPC_CHANNELS.inventoryList, {}))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.inventorySummary))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.recipesCoverage))).toBe('UNAUTHENTICATED')
  })

  it('lets the owner keep stock over IPC', async () => {
    const created = await invoke<InventoryItem>(IPC_CHANNELS.inventoryCreate, {
      name: 'Paneer',
      unit: 'KG',
      openingStock: 2000
    })
    expect(created).toMatchObject({ ok: true, data: { name: 'Paneer', onHand: 2000 } })
    const id = created.ok ? created.data.id : ''
    expect(
      await invoke(IPC_CHANNELS.inventoryStockIn, { itemId: id, quantity: 500 })
    ).toMatchObject({ ok: true, data: { onHand: 2500 } })
    expect(
      await invoke(IPC_CHANNELS.inventoryWastage, { itemId: id, quantity: 250, reason: 'Spoiled' })
    ).toMatchObject({ ok: true, data: { onHand: 2250 } })
    expect(await invoke(IPC_CHANNELS.inventoryCount, { itemId: id, counted: 2000 })).toMatchObject({
      ok: true,
      data: { onHand: 2000 }
    })
    expect(await invoke(IPC_CHANNELS.inventoryMovements, { itemId: id })).toMatchObject({
      ok: true,
      data: [{ type: 'ADJUSTMENT' }, { type: 'WASTAGE' }, { type: 'STOCK_IN' }, { type: 'OPENING' }]
    })
    expect(await invoke<InventorySummary>(IPC_CHANNELS.inventorySummary)).toMatchObject({
      ok: true,
      data: { activeItems: 1 }
    })
    expect(await invoke<Recipe>(IPC_CHANNELS.recipesCoverage)).toMatchObject({ ok: true })
  })

  it('validates input', async () => {
    expect(errorCode(await invoke(IPC_CHANNELS.inventoryCreate, { name: '', unit: 'KG' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(
      errorCode(await invoke(IPC_CHANNELS.inventoryCreate, { name: 'X', unit: 'TONNE' }))
    ).toBe('VALIDATION_ERROR')
    expect(
      errorCode(await invoke(IPC_CHANNELS.inventoryStockIn, { itemId: 'nope', quantity: 1 }))
    ).toBe('VALIDATION_ERROR')
    expect(errorCode(await invoke(IPC_CHANNELS.inventoryDelete, { id: 'nope' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(errorCode(await invoke(IPC_CHANNELS.recipesGet, {}))).toBe('VALIDATION_ERROR')
  })

  it('lets view-only staff read but not change anything', async () => {
    const owner = app.services.auth.authorize([])
    const item = app.services.inventory.create(owner, {
      name: 'Paneer',
      unit: 'KG',
      category: null,
      reorderLevel: 0,
      unitCost: 0,
      openingStock: 1000
    })
    await signInWith('viewer', ['inventory.view'])
    expect(await invoke(IPC_CHANNELS.inventoryList, {})).toMatchObject({ ok: true })
    expect(await invoke(IPC_CHANNELS.inventoryMovements, {})).toMatchObject({ ok: true })
    expect(await invoke(IPC_CHANNELS.recipesCoverage)).toMatchObject({ ok: true })
    expect(
      errorCode(await invoke(IPC_CHANNELS.inventoryCreate, { name: 'Rice', unit: 'KG' }))
    ).toBe('FORBIDDEN')
    expect(
      errorCode(await invoke(IPC_CHANNELS.inventoryStockIn, { itemId: item.id, quantity: 100 }))
    ).toBe('FORBIDDEN')
    expect(
      errorCode(await invoke(IPC_CHANNELS.inventoryCount, { itemId: item.id, counted: 10 }))
    ).toBe('FORBIDDEN')
    expect(errorCode(await invoke(IPC_CHANNELS.inventoryDelete, { id: item.id }))).toBe('FORBIDDEN')
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.recipesSet, {
          menuItemId: crypto.randomUUID(),
          variantId: null,
          lines: []
        })
      )
    ).toBe('FORBIDDEN')
  })

  it('lets stock staff record stock but not set up items or recipes', async () => {
    const owner = app.services.auth.authorize([])
    const item = app.services.inventory.create(owner, {
      name: 'Paneer',
      unit: 'KG',
      category: null,
      reorderLevel: 0,
      unitCost: 0,
      openingStock: 1000
    })
    await signInWith('stockman', ['inventory.view', 'inventory.operate'])
    expect(
      await invoke(IPC_CHANNELS.inventoryStockIn, { itemId: item.id, quantity: 100 })
    ).toMatchObject({ ok: true, data: { onHand: 1100 } })
    expect(
      await invoke(IPC_CHANNELS.inventoryWastage, {
        itemId: item.id,
        quantity: 100,
        reason: 'Spoiled'
      })
    ).toMatchObject({ ok: true })
    expect(
      errorCode(await invoke(IPC_CHANNELS.inventoryCreate, { name: 'Rice', unit: 'KG' }))
    ).toBe('FORBIDDEN')
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.inventoryUpdate, { id: item.id, name: 'Paneer 2', unit: 'KG' })
      )
    ).toBe('FORBIDDEN')
  })

  it('lets a manager set up items and recipes', async () => {
    await signInWith('manager', ['inventory.view', 'inventory.manage'])
    const created = await invoke<InventoryItem>(IPC_CHANNELS.inventoryCreate, {
      name: 'Rice',
      unit: 'KG'
    })
    expect(created).toMatchObject({ ok: true })
    const id = created.ok ? created.data.id : ''
    expect(await invoke(IPC_CHANNELS.inventorySetActive, { id, isActive: false })).toMatchObject({
      ok: true,
      data: { isActive: false }
    })
    expect(await invoke(IPC_CHANNELS.inventoryDelete, { id })).toMatchObject({ ok: true })
  })
})
