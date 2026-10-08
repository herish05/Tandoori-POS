import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { PermissionCode } from '@shared/permissions'
import type { ReportFileResult, ReportOptions, ReportResult } from '@shared/reports'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { createIpcRegistrar } from '@main/ipc/registrar'
import { registerReportHandlers } from '@main/reports-handlers'
import type { ReportOutput } from '@main/reports/output'
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
const FILTER = { kind: 'SALES', from: '2026-01-01', to: '2026-01-31' }

describe('reports IPC', () => {
  let app: TestApp
  let cancel: boolean
  let saved: { suggestedName: string; kind: string; data: string | Buffer }[]
  let printed: string[]
  let pdfs: string[]

  const output: ReportOutput = {
    saveFile: (file) => {
      saved.push(file)
      const result: ReportFileResult = cancel
        ? { saved: false, path: null }
        : { saved: true, path: `/tmp/${file.suggestedName}` }
      return Promise.resolve(result)
    },
    renderPdf: (html) => {
      pdfs.push(html)
      return Promise.resolve(Buffer.from('%PDF-fake'))
    },
    print: (html) => {
      printed.push(html)
      return Promise.resolve()
    }
  }

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

  const exportedActions = () =>
    app.services.audit
      .list({ page: 1, pageSize: 50, actionPrefix: 'report.' })
      .items.map((e) => e.action)

  beforeEach(async () => {
    electron.handlers.clear()
    cancel = false
    saved = []
    printed = []
    pdfs = []
    app = createTestApp()
    await completeSetup(app)
    const registrar = createIpcRegistrar({
      logger: silentLogger,
      securityLogger: silentLogger,
      isTrustedSender: () => true,
      authorize: (required, options) => app.services.auth.authorize(required, options)
    })
    registerAuthHandlers(registrar, app.services)
    registerReportHandlers(registrar, app.services, output)
    await loginAsOwner(app)
  })
  afterEach(() => {
    app.cleanup()
  })

  it('needs a session', async () => {
    app.services.auth.logout()
    expect(errorCode(await invoke(IPC_CHANNELS.reportsRun, FILTER))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.reportsOptions))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.reportsExportCsv, FILTER))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.reportsExportPdf, FILTER))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.reportsPrint, FILTER))).toBe('UNAUTHENTICATED')
    expect(saved).toHaveLength(0)
  })

  it('lets the owner run a report and read the filter lists', async () => {
    expect(await invoke<ReportResult>(IPC_CHANNELS.reportsRun, FILTER)).toMatchObject({
      ok: true,
      data: { kind: 'SALES', from: '2026-01-01', to: '2026-01-31', rows: [] }
    })
    expect(await invoke<ReportOptions>(IPC_CHANNELS.reportsOptions)).toMatchObject({
      ok: true,
      data: { staff: [{ name: 'Olivia Owner' }] }
    })
  })

  it('refuses malformed filters before touching the data', async () => {
    for (const bad of [
      undefined,
      {},
      { ...FILTER, kind: 'NOPE' },
      { ...FILTER, from: 'yesterday' },
      { ...FILTER, from: '2026-02-01' },
      { ...FILTER, from: '2000-01-01', to: '2026-01-31' },
      { ...FILTER, search: 'x'.repeat(200) }
    ]) {
      expect(errorCode(await invoke(IPC_CHANNELS.reportsRun, bad))).toBe('VALIDATION_ERROR')
    }
    expect(
      errorCode(await invoke(IPC_CHANNELS.reportsExportCsv, { ...FILTER, kind: 'NOPE' }))
    ).toBe('VALIDATION_ERROR')
    expect(errorCode(await invoke(IPC_CHANNELS.reportsRun, { ...FILTER, method: 'BANK' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(saved).toHaveLength(0)
  })

  describe('exports', () => {
    it('saves a CSV and notes it in the audit trail', async () => {
      const result = await invoke<ReportFileResult>(IPC_CHANNELS.reportsExportCsv, FILTER)
      expect(result).toMatchObject({
        ok: true,
        data: { saved: true, path: '/tmp/sales-report_2026-01-01_2026-01-31.csv' }
      })
      expect(saved[0]).toMatchObject({
        kind: 'csv',
        suggestedName: 'sales-report_2026-01-01_2026-01-31.csv'
      })
      expect(String(saved[0]?.data)).toContain('Bill')
      expect(exportedActions()).toEqual(['report.exported'])
    })

    it('saves a PDF and notes it in the audit trail', async () => {
      const result = await invoke<ReportFileResult>(IPC_CHANNELS.reportsExportPdf, FILTER)
      expect(result).toMatchObject({ ok: true, data: { saved: true } })
      expect(pdfs).toHaveLength(1)
      expect(saved[0]).toMatchObject({
        kind: 'pdf',
        suggestedName: 'sales-report_2026-01-01_2026-01-31.pdf'
      })
      expect(exportedActions()).toEqual(['report.exported'])
    })

    it('does not note a cancelled save', async () => {
      cancel = true
      expect(await invoke(IPC_CHANNELS.reportsExportCsv, FILTER)).toMatchObject({
        ok: true,
        data: { saved: false, path: null }
      })
      expect(await invoke(IPC_CHANNELS.reportsExportPdf, FILTER)).toMatchObject({
        ok: true,
        data: { saved: false }
      })
      expect(exportedActions()).toEqual([])
    })

    it('prints a page and notes it in the audit trail', async () => {
      expect(await invoke(IPC_CHANNELS.reportsPrint, FILTER)).toMatchObject({
        ok: true,
        data: null
      })
      expect(printed).toHaveLength(1)
      expect(printed[0]).toContain('<html')
      expect(exportedActions()).toEqual(['report.exported'])
    })
  })

  describe('permissions', () => {
    it('lets a viewer read but not export', async () => {
      await signInWith('viewer', ['reports.view'])
      expect(errorCode(await invoke(IPC_CHANNELS.reportsRun, FILTER))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.reportsOptions))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.reportsExportCsv, FILTER))).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.reportsExportPdf, FILTER))).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.reportsPrint, FILTER))).toBe('FORBIDDEN')
      expect(saved).toHaveLength(0)
      expect(printed).toHaveLength(0)
    })

    it('lets someone with reports.export also read', async () => {
      await signInWith('exporter', ['reports.export'])
      expect(errorCode(await invoke(IPC_CHANNELS.reportsRun, FILTER))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.reportsExportCsv, FILTER))).toBeNull()
    })

    it('gives nothing to someone without a reports permission', async () => {
      await signInWith('waiter', ['orders.view'])
      expect(errorCode(await invoke(IPC_CHANNELS.reportsRun, FILTER))).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.reportsOptions))).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.reportsExportCsv, FILTER))).toBe('FORBIDDEN')
    })
  })
})
