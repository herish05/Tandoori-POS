import { z } from 'zod'
import type { PaperWidth, PrintStatus } from './kitchen'

/**
 * Receipts: the printed (or previewed) copy of a bill. The same page serves as the bill handed
 * over before payment and as the receipt after it; its title follows the bill's status.
 */

const idSchema = z.uuid()
const paperWidthSchema = z.union([z.literal(58), z.literal(80)])

export interface ReceiptPreview {
  billId: string
  billNumber: string
  paperWidth: PaperWidth
  columns: number
  /** 0 for the first print of this version of the bill; 1 and up for duplicate copies. */
  copyNumber: number
  lines: string[]
}

export interface ReceiptPrintOutcome {
  billId: string
  billNumber: string
  status: PrintStatus
  printerName: string | null
  /** Set when nothing came out of the printer; the staff-friendly reason. */
  error: string | null
  /** 0 for the original; 1 and up are duplicates, marked as such on the paper. */
  copyNumber: number
}

/** One line of a bill's print history. */
export interface ReceiptPrintRecord {
  id: string
  printedAt: string
  status: PrintStatus
  printerName: string | null
  error: string | null
  copyNumber: number
  isReprint: boolean
  /** The bill's status when it was printed, e.g. "Paid". */
  billState: string
  requestedByName: string | null
}

export const receiptPreviewInputSchema = z.object({
  billId: idSchema,
  paperWidth: paperWidthSchema.optional()
})

export const printReceiptInputSchema = z.object({
  billId: idSchema,
  /** A particular printer; otherwise the default printer is used. */
  printerId: idSchema.optional()
})

export type ReceiptPreviewInput = z.input<typeof receiptPreviewInputSchema>
export type PrintReceiptInput = z.input<typeof printReceiptInputSchema>
