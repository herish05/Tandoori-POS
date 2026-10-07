import { eq } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext, Clock } from '../auth/types'
import type { AppDatabase } from '../db/client'
import { printJobs, restaurants } from '../db/schema'
import { AppError } from '../ipc/errors'
import type { KotService } from '../kitchen/kot-service'
import type { Logger } from '../logging/log-manager'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import {
  PAPER_COLUMNS,
  type KotPreview,
  type KotPrintOutcome,
  type PaperWidth,
  type PrinterConfig,
  type PrinterTestOutcome
} from '@shared/kitchen'
import { PrintError, type PrinterDrivers, type PrintPayload } from './drivers'
import {
  buildKotTicket,
  buildTestTicket,
  formatTicketTime,
  renderEscPos,
  renderText,
  type TicketLine
} from './kot-template'
import type { PrinterService } from './printer-service'

interface Header {
  restaurantName: string
  timezone: string
}

/**
 * Prints documents and remembers every attempt. A failed print never undoes the business action
 * that asked for it: the order is still sent, the ticket still exists, and the failure is
 * recorded so the staff can reprint once the printer is fixed.
 */
export class PrintService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly kots: KotService,
    private readonly printers: PrinterService,
    private readonly drivers: PrinterDrivers,
    private readonly logger: Logger
  ) {}

  /** The names of printers installed on this computer, for the printer form. */
  async systemDevices(): Promise<string[]> {
    const driver = this.drivers.SYSTEM
    if (!driver?.listDevices) return []
    try {
      return await driver.listDevices()
    } catch (error) {
      this.logger.warn('Could not list the printers on this computer', {
        error: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  }

  /** What the ticket looks like on paper; nothing is printed or recorded. */
  preview(kotId: string, paperWidth: PaperWidth = 80): KotPreview {
    const kot = this.kots.get(kotId)
    const columns = PAPER_COLUMNS[paperWidth]
    const lines = buildKotTicket({ ...this.header(), kot, reprint: false })
    return {
      kotId: kot.id,
      kotNumber: kot.kotNumber,
      paperWidth,
      columns,
      lines: renderText(lines, columns)
    }
  }

  /** Prints one ticket. A reprint is marked as such on the paper and in the audit trail. */
  async printKot(
    auth: AuthContext,
    kotId: string,
    options: { reprint: boolean }
  ): Promise<KotPrintOutcome> {
    const kot = this.kots.get(kotId)
    const printer = this.printers.resolveFor(this.db, kot.stationId)
    const lines = buildKotTicket({ ...this.header(), kot, reprint: options.reprint })

    const result = await this.send(printer, `KOT ${kot.kotNumber}`, lines, kot.stationName)
    const status = result.error === null ? 'PRINTED' : 'FAILED'

    this.db.transaction((tx) => {
      tx.insert(printJobs)
        .values({
          restaurantId: requireRestaurantId(tx),
          documentType: 'KOT',
          documentId: kot.id,
          documentNumber: kot.kotNumber,
          printerId: printer?.id ?? null,
          printerName: printer?.name ?? null,
          status,
          error: result.error,
          isReprint: options.reprint,
          revision: kot.revision,
          requestedBy: auth.userId
        })
        .run()
      this.kots.recordPrint(tx, kot.id, { status, error: result.error })
      const action: AuditAction =
        status === 'FAILED' ? 'kot.print_failed' : options.reprint ? 'kot.reprinted' : 'kot.printed'
      this.audit.record(
        {
          action,
          userId: auth.userId,
          username: auth.username,
          entityType: 'kot',
          entityId: kot.id,
          details: {
            kotNumber: kot.kotNumber,
            orderNumber: kot.orderNumber,
            printer: printer?.name ?? null,
            revision: kot.revision,
            ...(result.error ? { error: result.error } : {})
          }
        },
        tx
      )
    })

    if (result.error !== null) {
      this.logger.error('A kitchen ticket could not be printed', {
        kot: kot.kotNumber,
        printer: printer?.name ?? null,
        error: result.error
      })
    }
    return {
      kotId: kot.id,
      kotNumber: kot.kotNumber,
      status,
      printerName: printer?.name ?? null,
      error: result.error
    }
  }

  /** Prints several tickets one after another (a send usually makes one per station). */
  async printKots(auth: AuthContext, kotIds: readonly string[]): Promise<KotPrintOutcome[]> {
    const outcomes: KotPrintOutcome[] = []
    for (const id of kotIds) outcomes.push(await this.printKot(auth, id, { reprint: false }))
    return outcomes
  }

  /** Prints a short page so staff can see that a printer is connected and set up properly. */
  async testPrinter(auth: AuthContext, printerId: string): Promise<PrinterTestOutcome> {
    const printer = this.printers.get(printerId)
    const header = this.header()
    const lines = buildTestTicket(
      header.restaurantName,
      printer.name,
      formatTicketTime(new Date(this.clock()).toISOString(), header.timezone)
    )
    const result = await this.send(printer, 'Printer test', lines, null)
    const status = result.error === null ? 'PRINTED' : 'FAILED'
    this.db.transaction((tx) => {
      tx.insert(printJobs)
        .values({
          restaurantId: requireRestaurantId(tx),
          documentType: 'TEST',
          printerId: printer.id,
          printerName: printer.name,
          status,
          error: result.error,
          requestedBy: auth.userId
        })
        .run()
      if (result.error !== null) {
        this.audit.record(
          {
            action: 'printer.test_failed',
            userId: auth.userId,
            username: auth.username,
            entityType: 'printer',
            entityId: printer.id,
            details: { name: printer.name, error: result.error }
          },
          tx
        )
      }
    })
    if (result.error !== null) {
      this.logger.warn('A printer test failed', { printer: printer.name, error: result.error })
    }
    return { status, error: result.error }
  }

  // --- Internals -------------------------------------------------------------

  private header(): Header {
    const row = this.db
      .select({ name: restaurants.name, timezone: restaurants.timezone })
      .from(restaurants)
      .where(eq(restaurants.id, requireRestaurantId(this.db)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'The restaurant has not been set up yet.')
    return { restaurantName: row.name, timezone: row.timezone }
  }

  /** Runs the printer's driver; never throws, the failure comes back as a message. */
  async send(
    printer: PrinterConfig | null,
    title: string,
    lines: readonly TicketLine[],
    stationName: string | null
  ): Promise<{ error: string | null }> {
    if (!printer) {
      return {
        error: `No printer is set up${stationName === null ? '' : ` for ${stationName}`}. Add one under Admin > Printers.`
      }
    }
    const driver = this.drivers[printer.kind]
    if (!driver) {
      return { error: `${printer.name} cannot be used on this computer.` }
    }
    const columns = PAPER_COLUMNS[printer.paperWidth]
    const payload: PrintPayload = {
      title,
      columns,
      lines: renderText(lines, columns),
      escpos: renderEscPos(lines, columns)
    }
    try {
      await driver.print(
        { name: printer.name, address: printer.address, paperWidth: printer.paperWidth },
        payload
      )
      return { error: null }
    } catch (error) {
      if (!(error instanceof PrintError)) {
        this.logger.warn('A printer driver failed unexpectedly', {
          printer: printer.name,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      return {
        error:
          error instanceof PrintError
            ? error.message
            : `Could not print to ${printer.name}. Check the printer and try again.`
      }
    }
  }
}
