import net from 'node:net'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCategoryInputSchema,
  createItemInputSchema,
  createStationInputSchema
} from '@shared/menu'
import {
  PAPER_COLUMNS,
  createPrinterInputSchema,
  updatePrinterInputSchema,
  type KotDetail
} from '@shared/kitchen'
import { cancelLineInputSchema, createOrderInputSchema } from '@shared/orders'
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, printJobs } from '@main/db/schema'
import {
  NetworkPrinterDriver,
  PrintError,
  parseNetworkAddress,
  type PrinterDriver,
  type PrintPayload
} from '@main/printing/drivers'
import {
  buildKotTicket,
  formatTicketTime,
  renderEscPos,
  renderText,
  toPrintable,
  wrapText
} from '@main/printing/kot-template'
import { PrintService } from '@main/printing/print-service'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

const sampleKot = (overrides: Partial<KotDetail> = {}): KotDetail => ({
  id: crypto.randomUUID(),
  kotNumber: 'TB-KOT-000012',
  orderId: crypto.randomUUID(),
  orderNumber: 'TB-ORD-000007',
  orderType: 'DINE_IN',
  tableNumber: '5',
  tableName: null,
  areaName: 'Main Hall',
  customerName: null,
  stationId: null,
  stationName: 'Tandoor',
  status: 'NEW',
  isAdditional: false,
  revision: 0,
  itemCount: 3,
  printStatus: 'NOT_PRINTED',
  printCount: 0,
  lastPrintError: null,
  createdByName: 'Olivia Owner',
  createdAt: '2026-01-05T09:00:00.000Z',
  acceptedAt: null,
  preparingAt: null,
  readyAt: null,
  servedAt: null,
  cancelledAt: null,
  cancelReason: null,
  orderNotes: null,
  guestCount: 4,
  items: [
    {
      id: crypto.randomUUID(),
      orderItemId: crypto.randomUUID(),
      name: 'Butter Chicken',
      variantName: 'Half',
      foodType: 'NON_VEG',
      quantity: 2,
      addons: [
        { name: 'Extra butter', kind: 'ADDON' },
        { name: 'Less spicy', kind: 'MODIFIER' }
      ],
      notes: 'Serve with the naan',
      status: 'ACTIVE',
      cancelReason: null
    },
    {
      id: crypto.randomUUID(),
      orderItemId: crypto.randomUUID(),
      name: 'Paneer Tikka Masala With A Very Long Name That Needs To Wrap Around',
      variantName: null,
      foodType: 'VEG',
      quantity: 1,
      addons: [],
      notes: null,
      status: 'ACTIVE',
      cancelReason: null
    }
  ],
  ...overrides
})

describe('kitchen ticket template', () => {
  const ticket = (kot: KotDetail, reprint = false) =>
    buildKotTicket({ restaurantName: 'Tandoori Bites', timezone: 'Asia/Kolkata', kot, reprint })

  it('shows what the kitchen needs, in the restaurant time zone', () => {
    const text = renderText(ticket(sampleKot()), 48).join('\n')
    expect(text).toContain('Tandoori Bites')
    expect(text).toContain('KITCHEN ORDER TICKET')
    expect(text).toContain('TANDOOR')
    expect(text).toContain('TB-KOT-000012')
    expect(text).toContain('TB-ORD-000007')
    expect(text).toContain('Table 5 (Main Hall)')
    expect(text).toContain('Guests   4')
    expect(text).toContain('  + Extra butter')
    expect(text).toContain('2 x Butter Chicken (Half)')
    expect(text).toContain('+ Extra butter')
    expect(text).toContain('- Less spicy')
    expect(text).toContain('NOTE: Serve with the naan')
    expect(text).toContain('Items: 3')
    // 09:00 UTC is 14:30 in Punjab.
    expect(text).toContain('05 Jan 2026')
    expect(text.toLowerCase()).toContain('02:30 pm')
  })

  it('never goes past the paper width, on either paper size', () => {
    for (const width of [58, 80] as const) {
      const columns = PAPER_COLUMNS[width]
      const lines = renderText(ticket(sampleKot()), columns)
      expect(lines.length).toBeGreaterThan(10)
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns)
    }
  })

  it('marks additional, revised, reprinted and cancelled tickets', () => {
    expect(renderText(ticket(sampleKot({ isAdditional: true })), 48).join('\n')).toContain(
      'ADDITIONAL KOT'
    )
    expect(renderText(ticket(sampleKot()), 48).join('\n')).not.toContain('REPRINT')
    expect(renderText(ticket(sampleKot(), true), 48).join('\n')).toContain('(REPRINT)')
    expect(renderText(ticket(sampleKot({ revision: 2 })), 48).join('\n')).toContain('REVISED')
    const cancelled = renderText(
      ticket(sampleKot({ status: 'CANCELLED', cancelReason: 'Guest left' })),
      48
    ).join('\n')
    expect(cancelled).toContain('CANCELLED - DO NOT PREPARE')
    expect(cancelled).toContain('Guest left')
  })

  it('lists cancelled items separately and leaves them out of the count', () => {
    const kot = sampleKot()
    const [first, second] = kot.items
    if (!first || !second) throw new Error('sample items missing')
    kot.items = [first, { ...second, status: 'CANCELLED', cancelReason: 'Out of paneer' }]
    const text = renderText(ticket({ ...kot, revision: 1 }), 48).join('\n')
    expect(text).toContain('CANCELLED ITEMS - DO NOT MAKE')
    expect(text).toContain('Reason: Out of paneer')
    expect(text).toContain('Items: 2')
  })

  it('names the customer for takeaway tickets instead of a table', () => {
    const text = renderText(
      ticket(sampleKot({ orderType: 'TAKEAWAY', tableNumber: null, customerName: 'Gurpreet' })),
      48
    ).join('\n')
    expect(text).toContain('Customer Gurpreet')
    expect(text).not.toContain('Table')
  })

  it('wraps long text with a hanging indent and cuts words longer than a line', () => {
    const lines = wrapText('2 x A very long dish name that needs to wrap around the line', 20, 4)
    expect(lines.length).toBeGreaterThan(2)
    for (const [index, line] of lines.entries()) {
      expect(line.length).toBeLessThanOrEqual(20)
      if (index > 0) expect(line.startsWith('    ')).toBe(true)
    }
    const cut = wrapText('X'.repeat(50), 20)
    expect(cut.every((piece) => piece.length <= 20)).toBe(true)
    expect(cut.join('')).toBe('X'.repeat(50))
  })

  it('turns characters a printer cannot show into safe ones', () => {
    expect(toPrintable('Crème brûlée')).toBe('Creme brulee')
    // Combining marks (accents, vowel signs) are dropped, other letters become "?".
    expect(toPrintable('मसाला')).toBe('???')
    expect(toPrintable('Naan\u0000')).toBe('Naan?')
  })

  it('falls back to UTC for an invalid time zone instead of failing', () => {
    expect(formatTicketTime('2026-01-05T09:00:00.000Z', 'Not/AZone')).toContain('05 Jan 2026')
  })

  it('builds ESC/POS bytes that initialise, print, feed and cut', () => {
    const bytes = renderEscPos(ticket(sampleKot()), 48)
    expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40])
    expect([...bytes.subarray(-4)]).toEqual([0x1d, 0x56, 0x42, 0x03])
    expect(bytes.toString('latin1')).toContain('TB-KOT-000012')
    // Double size is switched on for the heading.
    expect(bytes.includes(Buffer.from([0x1d, 0x21, 0x11]))).toBe(true)
  })
})

describe('network printer driver', () => {
  const target = { name: 'Tandoor printer', address: '', paperWidth: 80 as const }
  const payload: PrintPayload = {
    title: 'T',
    columns: 48,
    lines: ['x'],
    escpos: Buffer.from('hello printer')
  }
  let server: net.Server | null = null

  afterEach(async () => {
    const open = server
    server = null
    if (open) await new Promise((resolve) => open.close(resolve))
  })

  it('understands host and host:port', () => {
    expect(parseNetworkAddress('192.168.1.50')).toEqual({ host: '192.168.1.50', port: 9100 })
    expect(parseNetworkAddress('printer.local:9101')).toEqual({ host: 'printer.local', port: 9101 })
    expect(() => parseNetworkAddress(':9100')).toThrow(PrintError)
    expect(() => parseNetworkAddress('host:99999')).toThrow(PrintError)
  })

  it('sends the bytes to the printer', async () => {
    const received: Buffer[] = []
    server = net.createServer((socket) => {
      socket.on('data', (chunk: Buffer) => received.push(chunk))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as net.AddressInfo
    await new NetworkPrinterDriver().print(
      { ...target, address: `127.0.0.1:${String(port)}` },
      payload
    )
    // Give the server a moment to read what was flushed before the socket closed.
    await vi.waitFor(() => {
      expect(Buffer.concat(received).toString()).toBe('hello printer')
    })
  })

  it('says in plain words when the printer cannot be reached', async () => {
    const probe = net.createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const { port } = probe.address() as net.AddressInfo
    await new Promise((resolve) => probe.close(resolve))
    const attempt = new NetworkPrinterDriver().print(
      { ...target, address: `127.0.0.1:${String(port)}` },
      payload
    )
    await expect(attempt).rejects.toBeInstanceOf(PrintError)
    await expect(attempt).rejects.toThrow(/Could not print to Tandoor printer.*refused/)
  })

  it('gives up when the printer does not answer', async () => {
    const driver = new NetworkPrinterDriver(50)
    // 10.255.255.1 is not routable here; either a timeout or "unreachable" is a clean failure.
    await expect(
      driver.print({ ...target, address: '10.255.255.1:9100' }, payload)
    ).rejects.toThrow(/Could not print to Tandoor printer/)
  })
})

describe('printers and printing', () => {
  let app: TestApp
  let owner: AuthContext
  let tandoorStation: string
  let curryStation: string
  let tableId: string
  let naan: string
  let roti: string
  let dal: string

  const printed: { printer: string; address: string; text: string }[] = []
  let mode: 'ok' | 'fail' | 'crash' = 'ok'
  const fakeDriver: PrinterDriver = {
    print(printerTarget, payload) {
      if (mode === 'fail') return Promise.reject(new PrintError('Paper is out.'))
      if (mode === 'crash') return Promise.reject(new Error('boom: secret internals'))
      printed.push({
        printer: printerTarget.name,
        address: printerTarget.address,
        text: payload.lines.join('\n')
      })
      return Promise.resolve()
    },
    listDevices: () => Promise.resolve(['Front Desk USB'])
  }
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  let print: PrintService

  const addPrinter = (extra: Record<string, unknown> = {}) =>
    app.services.printers.create(
      owner,
      createPrinterInputSchema.parse({
        name: 'Tandoor printer',
        kind: 'NETWORK',
        address: '192.168.1.50',
        paperWidth: 80,
        stationId: tandoorStation,
        ...extra
      })
    )
  const sendOrder = (...items: string[]) => {
    const order = app.services.orders.create(
      owner,
      createOrderInputSchema.parse({
        type: 'DINE_IN',
        tableId,
        lines: items.map((menuItemId) => ({ menuItemId, quantity: 1 }))
      })
    )
    return { order, kotIds: app.services.orders.sendAndGetKots(owner, order.id).kotIds }
  }
  const jobs = () =>
    app.handle.db
      .select()
      .from(printJobs)
      .orderBy(sql`rowid`)
      .all()
  const actions = () =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(sql`rowid`)
      .all()
      .map((row) => row.action)

  beforeEach(async () => {
    mode = 'ok'
    printed.length = 0
    vi.clearAllMocks()
    app = createTestApp(undefined, { NETWORK: fakeDriver, SYSTEM: fakeDriver })
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
    print = new PrintService(
      app.handle.db,
      app.services.audit,
      () => app.clock.now,
      app.services.kots,
      app.services.printers,
      { NETWORK: fakeDriver, SYSTEM: fakeDriver },
      logger
    )
    const hall = app.services.areas.create(owner, createAreaInputSchema.parse({ name: 'Hall' }))
    tableId = app.services.tables.create(
      owner,
      createTableInputSchema.parse({ areaId: hall.id, tableNumber: 'T1', capacity: 4, type: 'AC' })
    ).id
    tandoorStation = app.services.stations.create(
      owner,
      createStationInputSchema.parse({ name: 'Tandoor' })
    ).id
    curryStation = app.services.stations.create(
      owner,
      createStationInputSchema.parse({ name: 'Curry' })
    ).id
    const category = (name: string, stationId: string) =>
      app.services.categories.create(owner, createCategoryInputSchema.parse({ name, stationId })).id
    const item = (categoryId: string, name: string) =>
      app.services.items.create(
        owner,
        createItemInputSchema.parse({ categoryId, name, price: 10000, foodType: 'VEG' })
      ).id
    const breads = category('Breads', tandoorStation)
    naan = item(breads, 'Butter Naan')
    roti = item(breads, 'Tandoori Roti')
    dal = item(category('Mains', curryStation), 'Dal Makhani')
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('printer settings', () => {
    it('adds, changes and removes printers, and records each in the audit log', () => {
      const added = addPrinter()
      expect(added).toMatchObject({
        name: 'Tandoor printer',
        kind: 'NETWORK',
        stationName: 'Tandoor',
        isDefault: false,
        isActive: true
      })
      const changed = app.services.printers.update(
        owner,
        updatePrinterInputSchema.parse({
          id: added.id,
          name: 'Tandoor printer',
          kind: 'NETWORK',
          address: '192.168.1.51:9100',
          paperWidth: 58,
          stationId: tandoorStation
        })
      )
      expect(changed).toMatchObject({ address: '192.168.1.51:9100', paperWidth: 58 })
      app.services.printers.delete(owner, added.id)
      expect(app.services.printers.list()).toEqual([])
      expect(actions().filter((a) => a.startsWith('printer.'))).toEqual([
        'printer.created',
        'printer.updated',
        'printer.deleted'
      ])
    })

    it('makes the first shared printer the default, but not a station printer or a later one', () => {
      const station = addPrinter()
      expect(station.isDefault).toBe(false)
      const shared = addPrinter({ name: 'Front', stationId: null })
      expect(shared.isDefault).toBe(true)
      const later = addPrinter({ name: 'Back', stationId: null })
      expect(later.isDefault).toBe(false)
      expect(app.services.printers.list().find((p) => p.id === shared.id)?.isDefault).toBe(true)
    })

    it('lets one printer serve each station, and one be the default', async () => {
      addPrinter()
      expect(await failureCode(() => addPrinter({ name: 'Second' }))).toBe('CONFLICT')
      const first = addPrinter({ name: 'Front', stationId: null, isDefault: true })
      const second = addPrinter({ name: 'Back', stationId: null, isDefault: true })
      const list = app.services.printers.list()
      expect(list.find((p) => p.id === first.id)?.isDefault).toBe(false)
      expect(list.find((p) => p.id === second.id)?.isDefault).toBe(true)
      expect(
        await failureCode(() => addPrinter({ name: 'tandoor PRINTER', stationId: curryStation }))
      ).toBe('CONFLICT')
    })

    it('checks the address and the station rules before saving', () => {
      const base = { name: 'P', kind: 'NETWORK', address: '10.0.0.5', paperWidth: 80 }
      expect(createPrinterInputSchema.safeParse(base).success).toBe(true)
      expect(
        createPrinterInputSchema.safeParse({ ...base, address: 'not an address' }).success
      ).toBe(false)
      expect(
        createPrinterInputSchema.safeParse({ ...base, address: '10.0.0.5:70000' }).success
      ).toBe(false)
      expect(createPrinterInputSchema.safeParse({ ...base, paperWidth: 70 }).success).toBe(false)
      expect(
        createPrinterInputSchema.safeParse({
          ...base,
          stationId: crypto.randomUUID(),
          isDefault: true
        }).success
      ).toBe(false)
      expect(
        createPrinterInputSchema.safeParse({ ...base, kind: 'SYSTEM', address: 'HP LaserJet 1020' })
          .success
      ).toBe(true)
    })

    it('refuses an unknown station or printer', async () => {
      expect(
        await failureCode(() => {
          addPrinter({ stationId: crypto.randomUUID() })
        })
      ).toBe('NOT_FOUND')
      expect(
        await failureCode(() => {
          app.services.printers.delete(owner, crypto.randomUUID())
        })
      ).toBe('NOT_FOUND')
    })

    it('picks the station printer first, then the default, and skips inactive ones', () => {
      const own = addPrinter()
      const fallback = addPrinter({ name: 'Front', stationId: null, isDefault: true })
      const resolve = (stationId: string | null) =>
        app.services.printers.resolveFor(app.handle.db, stationId)?.id
      expect(resolve(tandoorStation)).toBe(own.id)
      expect(resolve(curryStation)).toBe(fallback.id)
      expect(resolve(null)).toBe(fallback.id)
      app.services.printers.update(
        owner,
        updatePrinterInputSchema.parse({ ...own, stationId: tandoorStation, isActive: false })
      )
      expect(resolve(tandoorStation)).toBe(fallback.id)
    })
  })

  describe('printing tickets', () => {
    it('prints a ticket on its station printer and records it', async () => {
      addPrinter()
      const { kotIds } = sendOrder(naan)
      const outcome = await print.printKot(owner, kotIds[0] ?? '', { reprint: false })
      expect(outcome).toMatchObject({
        status: 'PRINTED',
        printerName: 'Tandoor printer',
        error: null
      })
      expect(printed).toHaveLength(1)
      expect(printed[0]?.address).toBe('192.168.1.50')
      expect(printed[0]?.text).toContain('Butter Naan')
      const kot = app.services.kots.get(kotIds[0] ?? '')
      expect(kot).toMatchObject({ printStatus: 'PRINTED', printCount: 1, lastPrintError: null })
      expect(jobs()).toMatchObject([{ documentType: 'KOT', status: 'PRINTED', isReprint: false }])
      expect(actions()).toContain('kot.printed')
    })

    it('uses the default printer for a station without its own', async () => {
      addPrinter({ name: 'Front', stationId: null, isDefault: true })
      const { kotIds } = sendOrder(dal)
      const [outcome] = await print.printKots(owner, kotIds)
      expect(outcome).toMatchObject({ status: 'PRINTED', printerName: 'Front' })
    })

    it('marks reprints on the paper and in the audit trail', async () => {
      addPrinter()
      const { kotIds } = sendOrder(naan)
      await print.printKot(owner, kotIds[0] ?? '', { reprint: false })
      await print.printKot(owner, kotIds[0] ?? '', { reprint: true })
      expect(printed[0]?.text).not.toContain('REPRINT')
      expect(printed[1]?.text).toContain('(REPRINT)')
      expect(app.services.kots.get(kotIds[0] ?? '').printCount).toBe(2)
      expect(actions()).toContain('kot.reprinted')
      expect(jobs().map((job) => job.isReprint)).toEqual([false, true])
    })

    it('does not hide a missing printer: it says so, keeps the ticket and logs it', async () => {
      const { order, kotIds } = sendOrder(naan)
      const outcome = await print.printKot(owner, kotIds[0] ?? '', { reprint: false })
      expect(outcome.status).toBe('FAILED')
      expect(outcome.printerName).toBeNull()
      expect(outcome.error).toMatch(/No printer is set up for Tandoor/)
      expect(app.services.kots.get(kotIds[0] ?? '')).toMatchObject({
        printStatus: 'FAILED',
        lastPrintError: outcome.error
      })
      expect(jobs()).toMatchObject([{ status: 'FAILED', printerId: null }])
      expect(actions()).toContain('kot.print_failed')
      expect(logger.error).toHaveBeenCalledTimes(1)
      // The order itself is still sent.
      expect(app.services.orders.get(order.id).status).toBe('CONFIRMED')
    })

    it('reports a printer failure, logs it, and lets the ticket be reprinted later', async () => {
      addPrinter()
      const { kotIds } = sendOrder(naan)
      mode = 'fail'
      const failed = await print.printKot(owner, kotIds[0] ?? '', { reprint: false })
      expect(failed).toMatchObject({ status: 'FAILED', error: 'Paper is out.' })
      expect(logger.error).toHaveBeenCalledWith(
        'A kitchen ticket could not be printed',
        expect.objectContaining({ kot: 'TK-KOT-000001', error: 'Paper is out.' })
      )
      expect(app.services.kots.get(kotIds[0] ?? '').printStatus).toBe('FAILED')
      mode = 'ok'
      expect((await print.printKot(owner, kotIds[0] ?? '', { reprint: true })).status).toBe(
        'PRINTED'
      )
      const kot = app.services.kots.get(kotIds[0] ?? '')
      expect(kot).toMatchObject({ printStatus: 'PRINTED', lastPrintError: null })
    })

    it('never leaks driver internals into the message staff see', async () => {
      addPrinter()
      const { kotIds } = sendOrder(naan)
      mode = 'crash'
      const outcome = await print.printKot(owner, kotIds[0] ?? '', { reprint: false })
      expect(outcome.status).toBe('FAILED')
      expect(outcome.error).not.toContain('secret')
      expect(outcome.error).toContain('Tandoor printer')
      expect(logger.warn).toHaveBeenCalled()
    })

    it('reports a printer type that this computer cannot use', async () => {
      const bare = new PrintService(
        app.handle.db,
        app.services.audit,
        () => app.clock.now,
        app.services.kots,
        app.services.printers,
        {},
        logger
      )
      addPrinter()
      const { kotIds } = sendOrder(naan)
      const outcome = await bare.printKot(owner, kotIds[0] ?? '', { reprint: false })
      expect(outcome.status).toBe('FAILED')
      expect(outcome.error).toContain('cannot be used')
    })

    it('flags a printed ticket for reprint when an item on it is cancelled', async () => {
      addPrinter()
      const { order, kotIds } = sendOrder(naan, roti)
      await print.printKot(owner, kotIds[0] ?? '', { reprint: false })
      expect(app.services.kots.get(kotIds[0] ?? '').printStatus).toBe('PRINTED')
      const line = app.services.orders.get(order.id).lines[0]
      app.services.orders.cancelLine(
        owner,
        cancelLineInputSchema.parse({
          orderId: order.id,
          lineId: line?.id,
          reason: 'Guest changed mind'
        })
      )
      const kot = app.services.kots.get(kotIds[0] ?? '')
      expect(kot.revision).toBe(1)
      expect(kot.printStatus).toBe('NEEDS_REPRINT')
      await print.printKot(owner, kotIds[0] ?? '', { reprint: true })
      expect(printed.at(-1)?.text).toContain('REVISED')
      expect(app.services.kots.get(kotIds[0] ?? '').printStatus).toBe('PRINTED')
    })
  })

  describe('preview and test page', () => {
    it('shows the ticket without printing or recording anything', () => {
      const { kotIds } = sendOrder(naan)
      const preview = print.preview(kotIds[0] ?? '')
      expect(preview).toMatchObject({ kotNumber: 'TK-KOT-000001', paperWidth: 80, columns: 48 })
      expect(preview.lines.join('\n')).toContain('Butter Naan')
      expect(preview.lines.join('\n')).toContain('Test Kitchen')
      expect(print.preview(kotIds[0] ?? '', 58).columns).toBe(32)
      expect(printed).toHaveLength(0)
      expect(jobs()).toHaveLength(0)
    })

    it('prints a test page and records a failure', async () => {
      const printer = addPrinter()
      expect(await print.testPrinter(owner, printer.id)).toEqual({ status: 'PRINTED', error: null })
      expect(printed[0]?.text).toContain('PRINTER TEST')
      mode = 'fail'
      expect(await print.testPrinter(owner, printer.id)).toEqual({
        status: 'FAILED',
        error: 'Paper is out.'
      })
      expect(jobs().map((job) => [job.documentType, job.status])).toEqual([
        ['TEST', 'PRINTED'],
        ['TEST', 'FAILED']
      ])
      expect(actions()).toContain('printer.test_failed')
      expect(await failureCode(() => print.testPrinter(owner, crypto.randomUUID()))).toBe(
        'NOT_FOUND'
      )
    })

    it('lists the printers installed on this computer', async () => {
      expect(await print.systemDevices()).toEqual(['Front Desk USB'])
      const none = new PrintService(
        app.handle.db,
        app.services.audit,
        () => app.clock.now,
        app.services.kots,
        app.services.printers,
        {},
        logger
      )
      expect(await none.systemDevices()).toEqual([])
    })
  })
})
