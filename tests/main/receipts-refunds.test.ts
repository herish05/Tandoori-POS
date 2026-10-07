import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  billFilterSchema,
  generateBillInputSchema,
  payBillInputSchema,
  refundBillInputSchema,
  type PaymentLineInput,
  type RefundBillInput
} from '@shared/billing'
import { PAPER_COLUMNS, createPrinterInputSchema } from '@shared/kitchen'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import { createTaxCategoryInputSchema } from '@shared/menu'
import {
  createOrderInputSchema,
  setOrderStatusInputSchema,
  type OrderLineInput
} from '@shared/orders'
import { createAreaInputSchema, createTableInputSchema } from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { auditLogs, orders, printJobs } from '@main/db/schema'
import { PrintError, type PrinterDriver } from '@main/printing/drivers'
import { formatPrintAmount } from '@main/printing/receipt-template'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

describe('formatPrintAmount', () => {
  it('groups digits the Indian way and always shows paise', () => {
    expect(formatPrintAmount(0)).toBe('0.00')
    expect(formatPrintAmount(5)).toBe('0.05')
    expect(formatPrintAmount(99900)).toBe('999.00')
    expect(formatPrintAmount(123456)).toBe('1,234.56')
    expect(formatPrintAmount(12345678)).toBe('1,23,456.78')
    expect(formatPrintAmount(1234567890)).toBe('1,23,45,678.90')
    expect(formatPrintAmount(-500)).toBe('-5.00')
  })
})

describe('receipts and refunds', () => {
  let app: TestApp
  let owner: AuthContext
  let tableId: string
  let naan: string // 60.00 at 5%
  let tikka: string // 280.00 at 5%
  let soda: string // 40.00 at 18%

  const printed: { printer: string; text: string }[] = []
  let mode: 'ok' | 'fail' = 'ok'
  const fakeDriver: PrinterDriver = {
    print(target, payload) {
      if (mode === 'fail') return Promise.reject(new PrintError('Paper is out.'))
      printed.push({ printer: target.name, text: payload.lines.join('\n') })
      return Promise.resolve()
    }
  }

  const line = (menuItemId: string, quantity = 1): OrderLineInput => ({ menuItemId, quantity })
  const status = (orderId: string, next: string) =>
    app.services.orders.setStatus(
      owner,
      setOrderStatusInputSchema.parse({ id: orderId, status: next })
    )
  const served = (lines: OrderLineInput[]) => {
    const order = app.services.orders.create(
      owner,
      createOrderInputSchema.parse({ type: 'DINE_IN', tableId, lines })
    )
    app.services.orders.sendAndGetKots(owner, order.id)
    return status(order.id, 'SERVED')
  }
  const billFor = (orderId: string) =>
    app.services.bills.generate(owner, generateBillInputSchema.parse({ orderId }))
  /** 2 naan + tikka + soda = 467.00 with tax. */
  const usualBill = () => billFor(served([line(naan, 2), line(tikka), line(soda)]).id)
  const pay = (billId: string, lines: PaymentLineInput[]) =>
    app.services.bills.pay(owner, payBillInputSchema.parse({ billId, payments: lines }))
  /** Pays 467.00: 200.00 cash and 267.00 UPI. */
  const paidBill = () => {
    const bill = usualBill()
    pay(bill.id, [
      { method: 'CASH', amount: 20000 },
      { method: 'UPI', amount: 26700, reference: 'UTR 99' }
    ])
    return bill.id
  }
  const refund = (billId: string, lines: RefundBillInput['lines'], reason = 'Guest unhappy') =>
    app.services.bills.refund(owner, refundBillInputSchema.parse({ billId, reason, lines }))
  const actions = () =>
    app.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(sql`rowid`)
      .all()
      .map((row) => row.action)
      .filter((action) => action.startsWith('bill'))
  const jobs = () =>
    app.handle.db
      .select()
      .from(printJobs)
      .orderBy(sql`rowid`)
      .all()
  const addPrinter = (extra: Record<string, unknown> = {}) =>
    app.services.printers.create(
      owner,
      createPrinterInputSchema.parse({
        name: 'Counter printer',
        kind: 'NETWORK',
        address: '192.168.1.60',
        paperWidth: 80,
        stationId: null,
        ...extra
      })
    )
  const text = (billId: string, paperWidth: 58 | 80 = 80) =>
    app.services.receipts.preview({ billId, paperWidth }).lines.join('\n')

  beforeEach(async () => {
    mode = 'ok'
    printed.length = 0
    app = createTestApp(undefined, { NETWORK: fakeDriver, SYSTEM: fakeDriver })
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
    const hall = app.services.areas.create(owner, createAreaInputSchema.parse({ name: 'Hall' }))
    tableId = app.services.tables.create(
      owner,
      createTableInputSchema.parse({ areaId: hall.id, tableNumber: 'T1', capacity: 4, type: 'AC' })
    ).id
    const category = app.services.categories.create(
      owner,
      createCategoryInputSchema.parse({ name: 'Food' })
    ).id
    const tax = (name: string, rateBps: number) =>
      app.services.taxCategories.create(
        owner,
        createTaxCategoryInputSchema.parse({ name, rateBps })
      ).id
    const gst5 = tax('GST 5%', 500)
    const gst18 = tax('GST 18%', 1800)
    const item = (name: string, price: number, taxCategoryId: string) =>
      app.services.items.create(
        owner,
        createItemInputSchema.parse({
          categoryId: category,
          name,
          price,
          foodType: 'VEG',
          taxCategoryId
        })
      ).id
    naan = item('Butter Naan', 6000, gst5)
    tikka = item('Paneer Tikka', 28000, gst5)
    soda = item('Soda', 4000, gst18)
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('the receipt page', () => {
    it('shows the restaurant, the items, the GST and the total on a bill', () => {
      const bill = usualBill()
      const page = text(bill.id)
      expect(page).toContain('Test Kitchen')
      expect(page).toContain('GSTIN: 03ABCDE1234F1Z5')
      expect(page).toMatch(/^\s*BILL$/m)
      expect(page).toContain('TAX INVOICE')
      expect(page).toContain(bill.billNumber)
      expect(page).toContain('Table T1')
      expect(page).toContain('Olivia Owner')
      expect(page).toMatch(/2 x Butter Naan\s+120\.00/)
      expect(page).toContain('@ 60.00 each')
      expect(page).toMatch(/Subtotal\s+440\.00/)
      expect(page).toMatch(/CGST 2\.5%\s+10\.00/)
      expect(page).toMatch(/SGST 9%\s+3\.60/)
      expect(page).toMatch(/Round off\s+-0\.20/)
      expect(page).toMatch(/TOTAL\s+467\.00/)
      expect(page).toMatch(/BALANCE DUE\s+467\.00/)
      expect(page).toContain('Thank you!')
    })

    it('never goes past the paper width, on either paper size', () => {
      const bill = usualBill()
      for (const width of [58, 80] as const) {
        const lines = app.services.receipts.preview({ billId: bill.id, paperWidth: width }).lines
        expect(lines.length).toBeGreaterThan(20)
        for (const row of lines) expect(row.length).toBeLessThanOrEqual(PAPER_COLUMNS[width])
      }
    })

    it('becomes a receipt once paid, listing how it was paid and the change', () => {
      const bill = usualBill()
      pay(bill.id, [
        { method: 'UPI', amount: 20000, reference: 'UTR 99' },
        { method: 'CASH', amount: 26700, tendered: 30000 }
      ])
      const page = text(bill.id)
      expect(page).toMatch(/^\s*RECEIPT$/m)
      expect(page).toContain('Paid by')
      expect(page).toMatch(/UPI \(UTR 99\)\s+200\.00/)
      expect(page).toMatch(/Cash\s+267\.00/)
      expect(page).toMatch(/Change given\s+33\.00/)
      expect(page).not.toContain('BALANCE DUE')
    })

    it('shows the balance on a part-paid bill', () => {
      const bill = usualBill()
      pay(bill.id, [{ method: 'CASH', amount: 10000 }])
      expect(text(bill.id)).toContain('BILL - PART PAID')
      expect(text(bill.id)).toMatch(/BALANCE DUE\s+367\.00/)
    })

    it('shows the reason on a cancelled bill', () => {
      const other = billFor(served([line(naan)]).id)
      app.services.bills.cancel(owner, { id: other.id, reason: 'Wrong table' })
      const page = text(other.id)
      expect(page).toContain('*** CANCELLED BILL ***')
      expect(page).toContain('Reason: Wrong table')
      expect(page).not.toContain('TAX INVOICE')
    })

    it('shows refunds and what the guest finally paid', () => {
      const id = paidBill()
      const done = refund(id, [{ method: 'CASH', amount: 5000 }])
      const page = text(id)
      expect(page).toContain('Refunds')
      expect(page).toMatch(new RegExp(`${done.refund.refundNumber}\\s+-50\\.00`))
      expect(page).toMatch(/Net paid\s+417\.00/)
    })
  })

  describe('printing', () => {
    it('says so, and records the attempt, when there is no printer', async () => {
      const bill = usualBill()
      const outcome = await app.services.receipts.print(owner, { billId: bill.id })
      expect(outcome.status).toBe('FAILED')
      expect(outcome.error).toMatch(/No printer is set up/)
      expect(jobs()).toMatchObject([
        { documentType: 'RECEIPT', documentNumber: bill.billNumber, status: 'FAILED' }
      ])
      expect(actions()).toContain('bill.receipt_print_failed')
    })

    it('prints on the default printer and records it', async () => {
      const bill = usualBill()
      addPrinter()
      const outcome = await app.services.receipts.print(owner, { billId: bill.id })
      expect(outcome).toMatchObject({
        status: 'PRINTED',
        printerName: 'Counter printer',
        error: null,
        copyNumber: 0
      })
      expect(printed).toHaveLength(1)
      expect(printed[0]?.text).toContain(bill.billNumber)
      expect(printed[0]?.text).not.toContain('DUPLICATE')
      expect(jobs()).toMatchObject([{ status: 'PRINTED', isReprint: false, revision: 0 }])
      expect(actions()).toContain('bill.receipt_printed')
    })

    it('marks a second print of the same bill as a duplicate, and counts the copies', async () => {
      const bill = usualBill()
      addPrinter()
      await app.services.receipts.print(owner, { billId: bill.id })
      expect(app.services.receipts.preview({ billId: bill.id }).copyNumber).toBe(1)
      const second = await app.services.receipts.print(owner, { billId: bill.id })
      const third = await app.services.receipts.print(owner, { billId: bill.id })
      expect([second.copyNumber, third.copyNumber]).toEqual([1, 2])
      expect(printed[1]?.text).toContain('** DUPLICATE COPY 1 **')
      expect(printed[2]?.text).toContain('** DUPLICATE COPY 2 **')
      expect(actions().filter((a) => a === 'bill.receipt_reprinted')).toHaveLength(2)
      expect(jobs().map((job) => job.isReprint)).toEqual([false, true, true])
    })

    it('treats a bill that has changed as a new original, not a duplicate', async () => {
      const bill = usualBill()
      addPrinter()
      await app.services.receipts.print(owner, { billId: bill.id })
      pay(bill.id, [{ method: 'CASH', amount: 46700 }])
      const afterPay = await app.services.receipts.print(owner, { billId: bill.id })
      expect(afterPay.copyNumber).toBe(0)
      expect(printed[1]?.text).toMatch(/^\s*RECEIPT$/m)
      refund(bill.id, [{ method: 'CASH', amount: 1000 }])
      const afterRefund = await app.services.receipts.print(owner, { billId: bill.id })
      expect(afterRefund.copyNumber).toBe(0)
      expect(printed[2]?.text).toContain('Net paid')
    })

    it('keeps a failed attempt on record and does not count it as a copy', async () => {
      const bill = usualBill()
      addPrinter()
      mode = 'fail'
      const failed = await app.services.receipts.print(owner, { billId: bill.id })
      expect(failed).toMatchObject({ status: 'FAILED', error: 'Paper is out.', copyNumber: 0 })
      mode = 'ok'
      const retry = await app.services.receipts.print(owner, { billId: bill.id })
      expect(retry).toMatchObject({ status: 'PRINTED', copyNumber: 0 })
      const history = app.services.receipts.history(bill.id)
      expect(history.map((entry) => entry.status)).toEqual(['PRINTED', 'FAILED'])
      expect(history[1]?.error).toBe('Paper is out.')
    })

    it('lists the print history newest first with who printed it and the bill state', async () => {
      const bill = usualBill()
      addPrinter()
      await app.services.receipts.print(owner, { billId: bill.id })
      app.clock.advance(60_000)
      pay(bill.id, [{ method: 'CASH', amount: 46700 }])
      await app.services.receipts.print(owner, { billId: bill.id })
      const history = app.services.receipts.history(bill.id)
      expect(history).toHaveLength(2)
      expect(history[0]).toMatchObject({
        billState: 'Paid',
        copyNumber: 0,
        isReprint: false,
        requestedByName: 'Olivia Owner',
        printerName: 'Counter printer'
      })
      expect(history[1]?.billState).toBe('Unpaid')
      expect(await failureCode(() => app.services.receipts.history(crypto.randomUUID()))).toBe(
        'NOT_FOUND'
      )
    })

    it('prints on a chosen printer at its own paper width', async () => {
      const bill = usualBill()
      addPrinter()
      const small = addPrinter({ name: 'Mini', address: '192.168.1.61', paperWidth: 58 })
      const outcome = await app.services.receipts.print(owner, {
        billId: bill.id,
        printerId: small.id
      })
      expect(outcome.printerName).toBe('Mini')
      for (const row of (printed[0]?.text ?? '').split('\n')) {
        expect(row.length).toBeLessThanOrEqual(PAPER_COLUMNS[58])
      }
    })

    it('previews without printing or recording anything', () => {
      const bill = usualBill()
      const preview = app.services.receipts.preview({ billId: bill.id })
      expect(preview).toMatchObject({ billNumber: bill.billNumber, paperWidth: 80, copyNumber: 0 })
      expect(jobs()).toHaveLength(0)
      expect(printed).toHaveLength(0)
    })
  })

  describe('refunding a paid bill', () => {
    it('gives part of the money back and keeps the bill paid', () => {
      const id = paidBill()
      const result = refund(id, [{ method: 'CASH', amount: 5000 }])
      expect(result.billCancelled).toBe(false)
      expect(result.refund).toMatchObject({
        amount: 5000,
        reason: 'Guest unhappy',
        refundedByName: 'Olivia Owner',
        lines: [{ method: 'CASH', amount: 5000, reference: null }]
      })
      expect(result.refund.refundNumber).toMatch(/^[A-Z]{2}-REF-000001$/)
      expect(result.bill.status).toBe('PAID')
      expect(result.bill.paidTotal).toBe(46700)
      expect(result.bill.refundedTotal).toBe(5000)
      expect(result.bill.refundable).toEqual([
        { method: 'CASH', amount: 15000 },
        { method: 'UPI', amount: 26700 }
      ])
    })

    it('becomes REFUNDED once everything paid has gone back, and stays that way', async () => {
      const id = paidBill()
      refund(id, [{ method: 'CASH', amount: 20000 }])
      const done = refund(
        id,
        [{ method: 'UPI', amount: 26700, reference: 'Reversal 7' }],
        'Order was wrong'
      )
      expect(done.bill.status).toBe('REFUNDED')
      expect(done.bill.refundedTotal).toBe(46700)
      expect(done.bill.refundable).toEqual([])
      expect(done.bill.refunds.map((r) => r.refundNumber)).toEqual([
        expect.stringMatching(/REF-000001$/),
        expect.stringMatching(/REF-000002$/)
      ])
      expect(done.refund.lines[0]?.reference).toBe('Reversal 7')
      expect(await failureCode(() => refund(id, [{ method: 'CASH', amount: 100 }]))).toBe(
        'CONFLICT'
      )
      expect(
        app.services.bills.list(billFilterSchema.parse({ statuses: ['REFUNDED'] }))
      ).toHaveLength(1)
    })

    it('returns money only through the method that took it, and never more', async () => {
      const id = paidBill()
      // Cash took 200.00, UPI 267.00; nothing was paid by card.
      expect(await failureCode(() => refund(id, [{ method: 'CASH', amount: 20001 }]))).toBe(
        'VALIDATION_ERROR'
      )
      expect(await failureCode(() => refund(id, [{ method: 'CARD', amount: 100 }]))).toBe(
        'VALIDATION_ERROR'
      )
      refund(id, [{ method: 'CASH', amount: 15000 }])
      // Only 50.00 of the cash is left to give back.
      expect(await failureCode(() => refund(id, [{ method: 'CASH', amount: 5001 }]))).toBe(
        'VALIDATION_ERROR'
      )
      // A refused refund leaves nothing behind.
      expect(app.services.bills.get(id).refunds).toHaveLength(1)
      expect(app.services.bills.get(id).refundedTotal).toBe(15000)
    })

    it('refunds several methods in one go', () => {
      const id = paidBill()
      const result = refund(id, [
        { method: 'CASH', amount: 1000 },
        { method: 'UPI', amount: 2000 }
      ])
      expect(result.refund.amount).toBe(3000)
      expect(result.refund.lines).toHaveLength(2)
      expect(result.bill.refundedTotal).toBe(3000)
    })

    it('rejects badly formed refunds', () => {
      const id = paidBill()
      const bad = (value: Record<string, unknown>) =>
        refundBillInputSchema.safeParse({ billId: id, reason: 'Guest unhappy', ...value }).success
      expect(bad({ lines: [] })).toBe(false)
      expect(bad({ lines: [{ method: 'CASH', amount: 0 }] })).toBe(false)
      expect(bad({ lines: [{ method: 'CASH', amount: 10.5 }] })).toBe(false)
      expect(bad({ lines: [{ method: 'OTHER', amount: 100 }] })).toBe(false)
      expect(
        bad({
          lines: [
            { method: 'CASH', amount: 100 },
            { method: 'CASH', amount: 100 }
          ]
        })
      ).toBe(false)
      expect(bad({ reason: 'x', lines: [{ method: 'CASH', amount: 100 }] })).toBe(false)
      expect(bad({ lines: [{ method: 'CASH', amount: 100 }] })).toBe(true)
    })

    it('refuses a bill that has taken no money or was cancelled', async () => {
      const open = usualBill()
      expect(await failureCode(() => refund(open.id, [{ method: 'CASH', amount: 100 }]))).toBe(
        'CONFLICT'
      )
      app.services.bills.cancel(owner, { id: open.id, reason: 'Guest left' })
      expect(await failureCode(() => refund(open.id, [{ method: 'CASH', amount: 100 }]))).toBe(
        'CONFLICT'
      )
      expect(
        await failureCode(() => refund(crypto.randomUUID(), [{ method: 'CASH', amount: 100 }]))
      ).toBe('NOT_FOUND')
    })

    it('records the refund in the audit trail', () => {
      const id = paidBill()
      refund(id, [{ method: 'CASH', amount: 5000 }])
      expect(actions()).toContain('bill.refunded')
      const entry = app.handle.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'bill.refunded'))
        .get()
      expect(entry?.details).toContain('Guest unhappy')
      expect(entry?.details).toContain('5000')
    })
  })

  describe('refunding a part-paid bill', () => {
    it('needs everything back, then withdraws the bill and reopens the order', async () => {
      const bill = usualBill()
      pay(bill.id, [{ method: 'CASH', amount: 10000 }])
      expect(await failureCode(() => refund(bill.id, [{ method: 'CASH', amount: 4000 }]))).toBe(
        'CONFLICT'
      )
      const result = refund(bill.id, [{ method: 'CASH', amount: 10000 }], 'Guest had to leave')
      expect(result.billCancelled).toBe(true)
      expect(result.bill).toMatchObject({
        status: 'CANCELLED',
        refundedTotal: 10000,
        cancelReason: 'Guest had to leave',
        balance: 0
      })
      expect(actions()).toEqual(expect.arrayContaining(['bill.refunded', 'bill.cancelled']))
      const order = app.handle.db.select().from(orders).where(eq(orders.id, bill.orderId)).get()
      expect(order?.status).toBe('SERVED')
      // The order can be billed again.
      const again = billFor(bill.orderId)
      expect(again.status).toBe('PENDING')
      expect(again.id).not.toBe(bill.id)
    })

    it('points staff at the refund when they try to cancel a part-paid bill', () => {
      const bill = usualBill()
      pay(bill.id, [{ method: 'CASH', amount: 10000 }])
      let message = ''
      try {
        app.services.bills.cancel(owner, { id: bill.id, reason: 'Guest left' })
      } catch (error) {
        message = error instanceof Error ? error.message : ''
      }
      expect(message).toContain('Refund what was paid')
    })
  })

  describe('integrity, in the database itself', () => {
    const run = (query: string, ...params: unknown[]) =>
      app.handle.sqlite.prepare(query).run(...params)

    it('cannot change or delete a refund once recorded', () => {
      const id = paidBill()
      const { refund: made } = refund(id, [{ method: 'CASH', amount: 5000 }])
      expect(() => run('update refunds set amount = 1 where id = ?', made.id)).toThrow(
        /cannot be changed/
      )
      expect(() => run("update refunds set reason = 'x' where id = ?", made.id)).toThrow(
        /cannot be changed/
      )
      expect(() => run('delete from refunds where id = ?', made.id)).toThrow(/cannot be deleted/)
      expect(() => run('update refund_lines set amount = 1 where refund_id = ?', made.id)).toThrow(
        /cannot be changed/
      )
      expect(() => run('delete from refund_lines where refund_id = ?', made.id)).toThrow(
        /cannot be deleted/
      )
    })

    it('cannot refund more than was paid or take a refund back', () => {
      const id = paidBill()
      refund(id, [{ method: 'CASH', amount: 5000 }])
      expect(() => run('update bills set refunded_total = 46701 where id = ?', id)).toThrow(
        /cannot be more than what was paid/
      )
      expect(() => run('update bills set refunded_total = 100 where id = ?', id)).toThrow(
        /cannot be more than what was paid/
      )
    })

    it('cannot record a refund against a bill that is not paid', () => {
      const bill = usualBill()
      const insert = () =>
        run(
          `insert into refunds (id, restaurant_id, refund_number, bill_id, amount, reason, refunded_by, refunded_at, created_at, updated_at, version)
           select 'r1', restaurant_id, 'X-REF-1', id, 100, 'x', created_by, 1, 1, 1, 1 from bills where id = ?`,
          bill.id
        )
      expect(insert).toThrow(/Only a bill that has taken payment/)
    })

    it('only allows the bill status changes that make sense', () => {
      const id = paidBill()
      expect(() => run("update bills set status = 'CANCELLED' where id = ?", id)).toThrow(
        /not allowed/
      )
      expect(() => run("update bills set status = 'PENDING' where id = ?", id)).toThrow(
        /not allowed/
      )
      refund(id, [
        { method: 'CASH', amount: 20000 },
        { method: 'UPI', amount: 26700 }
      ])
      expect(() => run("update bills set status = 'PAID' where id = ?", id)).toThrow(/not allowed/)
      expect(() => run("update bills set status = 'CANCELLED' where id = ?", id)).toThrow(
        /not allowed/
      )
    })
  })
})
