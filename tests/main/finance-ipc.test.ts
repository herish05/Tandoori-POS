import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import type { CashBook, CashEntry, CashSummary } from '@shared/cash'
import type { Expense, ExpenseCategory, ExpenseSummary } from '@shared/expenses'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { PermissionCode } from '@shared/permissions'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { registerFinanceHandlers } from '@main/finance-handlers'
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

describe('expenses and cash IPC', () => {
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

  /** A category, an expense and a cash entry, made as the owner. */
  const seed = () => {
    const owner = app.services.auth.authorize([])
    const rent = app.services.expenses.createCategory(owner, { name: 'Rent', description: null })
    const expense = app.services.expenses.create(owner, {
      categoryId: rent.id,
      amount: 5000,
      method: 'CASH',
      payee: null,
      reference: null,
      notes: null
    })
    const entry = app.services.cash.recordEntry(owner, {
      kind: 'CASH_ADDED',
      amount: 9000,
      notes: null
    })
    return { rent, expense, entry }
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
    registerFinanceHandlers(registrar, app.services)
    await loginAsOwner(app)
  })
  afterEach(() => {
    app.cleanup()
  })

  it('needs a session', async () => {
    app.services.auth.logout()
    expect(errorCode(await invoke(IPC_CHANNELS.expenseCategoriesList, {}))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.expensesList, {}))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.cashSummary))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.cashBook, {}))).toBe('UNAUTHENTICATED')
  })

  it('lets the owner run expenses and the drawer end to end', async () => {
    const category = await invoke<ExpenseCategory>(IPC_CHANNELS.expenseCategoriesCreate, {
      name: 'Gas'
    })
    expect(category).toMatchObject({ ok: true, data: { name: 'Gas', isActive: true } })
    const categoryId = category.ok ? category.data.id : ''

    const created = await invoke<Expense>(IPC_CHANNELS.expensesCreate, {
      categoryId,
      amount: 120000,
      method: 'CASH',
      payee: 'Indane'
    })
    expect(created).toMatchObject({
      ok: true,
      data: { expenseNumber: 'TK-EXP-000001', amount: 120000 }
    })
    const id = created.ok ? created.data.id : ''
    expect(
      await invoke(IPC_CHANNELS.expensesUpdate, {
        id,
        categoryId,
        amount: 125000,
        method: 'CASH',
        payee: 'Indane'
      })
    ).toMatchObject({ ok: true, data: { amount: 125000 } })
    expect(await invoke(IPC_CHANNELS.expensesGet, { id })).toMatchObject({
      ok: true,
      data: { id }
    })
    expect(await invoke<Expense[]>(IPC_CHANNELS.expensesList, {})).toMatchObject({
      ok: true,
      data: [{ id }]
    })
    expect(await invoke<ExpenseSummary>(IPC_CHANNELS.expensesSummary, {})).toMatchObject({
      ok: true,
      data: { total: 125000, count: 1 }
    })

    expect(await invoke<CashSummary>(IPC_CHANNELS.cashSummary)).toMatchObject({
      ok: true,
      data: { balance: -125000 }
    })
    const added = await invoke<CashEntry>(IPC_CHANNELS.cashRecordEntry, {
      kind: 'OPENING_FLOAT',
      amount: 300000
    })
    expect(added).toMatchObject({ ok: true, data: { direction: 'IN' } })
    expect(await invoke<CashBook>(IPC_CHANNELS.cashBook, {})).toMatchObject({
      ok: true,
      data: { totalIn: 300000, totalOut: 125000, closingBalance: 175000 }
    })

    expect(
      await invoke(IPC_CHANNELS.expensesVoid, { id, reason: 'Paid by owner instead' })
    ).toMatchObject({ ok: true, data: { voidReason: 'Paid by owner instead' } })
    const entryId = added.ok ? added.data.id : ''
    expect(
      await invoke(IPC_CHANNELS.cashVoidEntry, { id: entryId, reason: 'Wrong float' })
    ).toMatchObject({ ok: true, data: { voidedBy: 'Olivia Owner' } })
    expect(await invoke(IPC_CHANNELS.cashEntriesList, { includeVoided: true })).toMatchObject({
      ok: true,
      data: [{ id: entryId }]
    })

    expect(
      await invoke(IPC_CHANNELS.expenseCategoriesSetActive, { id: categoryId, isActive: false })
    ).toMatchObject({ ok: true, data: { isActive: false } })
    expect(
      await invoke(IPC_CHANNELS.expenseCategoriesUpdate, { id: categoryId, name: 'LPG' })
    ).toMatchObject({ ok: true, data: { name: 'LPG' } })
    expect(
      await invoke(IPC_CHANNELS.expenseCategoriesList, { includeInactive: true })
    ).toMatchObject({ ok: true, data: [{ name: 'LPG' }] })
    expect(await invoke(IPC_CHANNELS.expenseCategoriesDelete, { id: categoryId })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' }
    })
  })

  it('refuses malformed input before touching the data', async () => {
    const { rent } = seed()
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.expensesCreate, {
          categoryId: rent.id,
          amount: -1,
          method: 'CASH'
        })
      )
    ).toBe('VALIDATION_ERROR')
    expect(
      errorCode(await invoke(IPC_CHANNELS.expensesCreate, { categoryId: rent.id, amount: 1 }))
    ).toBe('VALIDATION_ERROR')
    expect(errorCode(await invoke(IPC_CHANNELS.cashRecordEntry, { kind: 'TIP', amount: 5 }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(errorCode(await invoke(IPC_CHANNELS.cashBook, { from: 'soon' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(errorCode(await invoke(IPC_CHANNELS.expensesGet, { id: 'nope' }))).toBe(
      'VALIDATION_ERROR'
    )
  })

  describe('permissions', () => {
    it('lets a viewer read but not change anything', async () => {
      const { rent, expense, entry } = seed()
      await signInWith('viewer', ['expenses.view', 'cash.view'])
      expect(errorCode(await invoke(IPC_CHANNELS.expenseCategoriesList, {}))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.expensesList, {}))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.expensesGet, { id: expense.id }))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.expensesSummary, {}))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.cashSummary))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.cashBook, {}))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.cashEntriesList, {}))).toBeNull()

      const forbidden = [
        [IPC_CHANNELS.expenseCategoriesCreate, { name: 'X' }],
        [IPC_CHANNELS.expenseCategoriesUpdate, { id: rent.id, name: 'X' }],
        [IPC_CHANNELS.expenseCategoriesSetActive, { id: rent.id, isActive: false }],
        [IPC_CHANNELS.expenseCategoriesDelete, { id: rent.id }],
        [IPC_CHANNELS.expensesCreate, { categoryId: rent.id, amount: 100, method: 'CASH' }],
        [
          IPC_CHANNELS.expensesUpdate,
          { id: expense.id, categoryId: rent.id, amount: 1, method: 'CASH' }
        ],
        [IPC_CHANNELS.expensesVoid, { id: expense.id, reason: 'x' }],
        [IPC_CHANNELS.cashRecordEntry, { kind: 'CASH_ADDED', amount: 100 }],
        [IPC_CHANNELS.cashVoidEntry, { id: entry.id, reason: 'x' }]
      ] as const
      for (const [channel, input] of forbidden) {
        expect(errorCode(await invoke(channel, input)), channel).toBe('FORBIDDEN')
      }
    })

    it('lets a cashier operate expenses but not manage categories', async () => {
      const { rent, expense } = seed()
      await signInWith('cashier', ['expenses.view', 'expenses.operate'])
      expect(
        errorCode(
          await invoke(IPC_CHANNELS.expensesCreate, {
            categoryId: rent.id,
            amount: 100,
            method: 'CASH'
          })
        )
      ).toBeNull()
      expect(
        errorCode(await invoke(IPC_CHANNELS.expensesVoid, { id: expense.id, reason: 'Typo' }))
      ).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.expenseCategoriesCreate, { name: 'X' }))).toBe(
        'FORBIDDEN'
      )
      // Expenses and the cash drawer are separate permissions.
      expect(errorCode(await invoke(IPC_CHANNELS.cashSummary))).toBe('FORBIDDEN')
    })

    it('implies operate from manage', async () => {
      const { rent } = seed()
      await signInWith('manager', ['expenses.manage', 'cash.manage'])
      expect(
        errorCode(await invoke(IPC_CHANNELS.expenseCategoriesCreate, { name: 'X' }))
      ).toBeNull()
      expect(
        errorCode(
          await invoke(IPC_CHANNELS.expensesCreate, {
            categoryId: rent.id,
            amount: 100,
            method: 'UPI'
          })
        )
      ).toBeNull()
      expect(
        errorCode(await invoke(IPC_CHANNELS.cashRecordEntry, { kind: 'CASH_ADDED', amount: 100 }))
      ).toBeNull()
    })

    it('shuts out staff with no finance permissions', async () => {
      await signInWith('waiter', ['orders.view'])
      expect(errorCode(await invoke(IPC_CHANNELS.expensesList, {}))).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.expenseCategoriesList, {}))).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.cashBook, {}))).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.cashEntriesList, {}))).toBe('FORBIDDEN')
    })
  })
})
