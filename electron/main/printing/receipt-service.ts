import { and, asc, eq, sql } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase } from '../db/client'
import { printJobs, restaurants, users } from '../db/schema'
import { AppError } from '../ipc/errors'
import type { BillService } from '../billing/bill-service'
import type { Logger } from '../logging/log-manager'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import { PAPER_COLUMNS } from '@shared/kitchen'
import type {
  PrintReceiptInput,
  ReceiptPreview,
  ReceiptPreviewInput,
  ReceiptPrintOutcome,
  ReceiptPrintRecord
} from '@shared/receipts'
import { renderText } from './kot-template'
import type { PrinterService } from './printer-service'
import type { PrintService } from './print-service'
import {
  buildReceipt,
  describeReceiptState,
  receiptState,
  type ReceiptRestaurant
} from './receipt-template'

const DOCUMENT_TYPE = 'RECEIPT'

/**
 * Prints and previews the bill/receipt. Every attempt is recorded together with the state of
 * the bill at that moment, so a second print of an unchanged bill is marked as a duplicate copy
 * while a print after a payment or refund is a fresh original of the new state.
 */
export class ReceiptService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly bills: BillService,
    private readonly printing: PrintService,
    private readonly printers: PrinterService,
    private readonly logger: Logger
  ) {}

  /** What the page looks like on paper; nothing is printed or recorded. */
  preview(input: ReceiptPreviewInput): ReceiptPreview {
    const bill = this.bills.get(input.billId)
    const paperWidth = input.paperWidth ?? 80
    const columns = PAPER_COLUMNS[paperWidth]
    const copyNumber = this.copiesPrinted(bill.id, receiptState(bill))
    const { restaurant, timezone } = this.restaurant()
    const lines = buildReceipt({ restaurant, timezone, bill, copyNumber })
    return {
      billId: bill.id,
      billNumber: bill.billNumber,
      paperWidth,
      columns,
      copyNumber,
      lines: renderText(lines, columns)
    }
  }

  async print(auth: AuthContext, input: PrintReceiptInput): Promise<ReceiptPrintOutcome> {
    const bill = this.bills.get(input.billId)
    const printer = input.printerId
      ? this.printers.get(input.printerId)
      : this.printers.resolveFor(this.db, null)
    const state = receiptState(bill)
    const copyNumber = this.copiesPrinted(bill.id, state)
    const { restaurant, timezone } = this.restaurant()
    const lines = buildReceipt({ restaurant, timezone, bill, copyNumber })

    const result = await this.printing.send(printer, `Bill ${bill.billNumber}`, lines, null)
    const status = result.error === null ? 'PRINTED' : 'FAILED'

    this.db.transaction((tx) => {
      tx.insert(printJobs)
        .values({
          restaurantId: requireRestaurantId(tx),
          documentType: DOCUMENT_TYPE,
          documentId: bill.id,
          documentNumber: bill.billNumber,
          printerId: printer?.id ?? null,
          printerName: printer?.name ?? null,
          status,
          error: result.error,
          isReprint: copyNumber > 0,
          revision: copyNumber,
          snapshot: state,
          requestedBy: auth.userId
        })
        .run()
      this.audit.record(
        {
          action:
            status === 'FAILED'
              ? 'bill.receipt_print_failed'
              : copyNumber > 0
                ? 'bill.receipt_reprinted'
                : 'bill.receipt_printed',
          userId: auth.userId,
          username: auth.username,
          entityType: 'bill',
          entityId: bill.id,
          details: {
            billNumber: bill.billNumber,
            status: bill.status,
            printer: printer?.name ?? null,
            copyNumber,
            ...(result.error ? { error: result.error } : {})
          }
        },
        tx
      )
    })

    if (result.error !== null) {
      this.logger.error('A receipt could not be printed', {
        bill: bill.billNumber,
        printer: printer?.name ?? null,
        error: result.error
      })
    }
    return {
      billId: bill.id,
      billNumber: bill.billNumber,
      status,
      printerName: printer?.name ?? null,
      error: result.error,
      copyNumber
    }
  }

  /** Every attempt to print this bill, newest first. */
  history(billId: string): ReceiptPrintRecord[] {
    this.bills.get(billId)
    return this.db
      .select({ job: printJobs, requestedByName: users.fullName })
      .from(printJobs)
      .leftJoin(users, eq(users.id, printJobs.requestedBy))
      .where(and(eq(printJobs.documentType, DOCUMENT_TYPE), eq(printJobs.documentId, billId)))
      .orderBy(sql`${printJobs.createdAt} desc`, sql`"print_jobs"."rowid" desc`)
      .all()
      .map(({ job, requestedByName }) => ({
        id: job.id,
        printedAt: job.createdAt.toISOString(),
        status: job.status,
        printerName: job.printerName,
        error: job.error,
        copyNumber: job.revision,
        isReprint: job.isReprint,
        billState: describeReceiptState(job.snapshot ?? ''),
        requestedByName
      }))
  }

  /** How many times this exact state of the bill has already come out of a printer. */
  private copiesPrinted(billId: string, state: string): number {
    const rows = this.db
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(
        and(
          eq(printJobs.documentType, DOCUMENT_TYPE),
          eq(printJobs.documentId, billId),
          eq(printJobs.status, 'PRINTED'),
          eq(printJobs.snapshot, state)
        )
      )
      .orderBy(asc(printJobs.createdAt))
      .all()
    return rows.length
  }

  private restaurant(): { restaurant: ReceiptRestaurant; timezone: string } {
    const row = this.db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, requireRestaurantId(this.db)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'The restaurant has not been set up yet.')
    return {
      timezone: row.timezone,
      restaurant: {
        name: row.name,
        legalName: row.legalName,
        address: row.address,
        city: row.city,
        state: row.state,
        phone: row.phone,
        gstin: row.gstin,
        footer: row.receiptFooter
      }
    }
  }
}
