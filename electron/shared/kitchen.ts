import { z } from 'zod'
import type { AddonKind, FoodType } from './menu'
import type { OrderDetail, OrderType } from './orders'

/**
 * Kitchen order tickets (KOTs) and the printers that print them. Shared by the renderer (labels,
 * instant feedback) and the main process (the real checks).
 *
 * A KOT is a snapshot of what one kitchen station has to cook for one "send": it is never
 * rewritten. Items sent later get a new, additional KOT. A ticket that was already given to the
 * kitchen can only change through a controlled cancellation, which raises its revision number.
 */

// --- KOT -----------------------------------------------------------------------------------

export const KOT_STATUSES = [
  'NEW',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'SERVED',
  'CANCELLED'
] as const
export type KotStatus = (typeof KOT_STATUSES)[number]

export const KOT_STATUS_LABELS: Record<KotStatus, string> = {
  NEW: 'New',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  SERVED: 'Served',
  CANCELLED: 'Cancelled'
}

/** Tickets the kitchen still has to work on. */
export const OPEN_KOT_STATUSES: readonly KotStatus[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY']

/** Which status may follow which. CANCELLED is reached through the cancel action, with a reason. */
export const KOT_TRANSITIONS: Record<KotStatus, readonly KotStatus[]> = {
  NEW: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: [],
  CANCELLED: []
}

/** Statuses the kitchen sets with the "set status" call. */
export const SETTABLE_KOT_STATUSES = [
  'ACCEPTED',
  'PREPARING',
  'READY',
  'SERVED'
] as const satisfies readonly KotStatus[]

/** The kitchen action that leads into each status, as a short verb for buttons. */
export const KOT_ACTION_LABELS: Record<(typeof SETTABLE_KOT_STATUSES)[number], string> = {
  ACCEPTED: 'Accept',
  PREPARING: 'Start',
  READY: 'Ready',
  SERVED: 'Serve'
}

export const KOT_ITEM_STATUSES = ['ACTIVE', 'CANCELLED'] as const
export type KotItemStatus = (typeof KOT_ITEM_STATUSES)[number]

/** Where a ticket stands with the printer. */
export const KOT_PRINT_STATUSES = ['NOT_PRINTED', 'PRINTED', 'NEEDS_REPRINT', 'FAILED'] as const
export type KotPrintStatus = (typeof KOT_PRINT_STATUSES)[number]

export const KOT_PRINT_STATUS_LABELS: Record<KotPrintStatus, string> = {
  NOT_PRINTED: 'Not printed',
  PRINTED: 'Printed',
  NEEDS_REPRINT: 'Changed - reprint',
  FAILED: 'Print failed'
}

export interface KotItemAddon {
  name: string
  kind: AddonKind
}

export interface KotItem {
  id: string
  orderItemId: string
  name: string
  variantName: string | null
  foodType: FoodType
  quantity: number
  addons: KotItemAddon[]
  notes: string | null
  status: KotItemStatus
  cancelReason: string | null
}

export interface KotSummary {
  id: string
  kotNumber: string
  orderId: string
  orderNumber: string
  orderType: OrderType
  tableNumber: string | null
  tableName: string | null
  areaName: string | null
  customerName: string | null
  stationId: string | null
  /** "Kitchen" when the item has no station of its own. */
  stationName: string
  status: KotStatus
  /** Sent after an earlier KOT of the same order. */
  isAdditional: boolean
  /** Raised each time an item is cancelled after the ticket was issued. */
  revision: number
  /** Quantity of the items that are not cancelled. */
  itemCount: number
  printStatus: KotPrintStatus
  printCount: number
  lastPrintError: string | null
  createdByName: string
  createdAt: string
  acceptedAt: string | null
  preparingAt: string | null
  readyAt: string | null
  servedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

export interface KotDetail extends KotSummary {
  items: KotItem[]
  /** The order's own notes, so the kitchen sees them too. */
  orderNotes: string | null
  guestCount: number | null
}

/** An order together with the tickets it produced, as returned when it is sent to the kitchen. */
export interface SendOrderResult {
  order: OrderDetail
  kots: KotSummary[]
  print: KotPrintOutcome[]
}

// --- Printing ------------------------------------------------------------------------------

export const PRINTER_KINDS = ['NETWORK', 'SYSTEM'] as const
export type PrinterKind = (typeof PRINTER_KINDS)[number]

export const PRINTER_KIND_LABELS: Record<PrinterKind, string> = {
  NETWORK: 'Network thermal printer (ESC/POS)',
  SYSTEM: 'Printer installed on this computer'
}

export const PAPER_WIDTHS = [58, 80] as const
export type PaperWidth = (typeof PAPER_WIDTHS)[number]

/** Characters per line for each paper width. */
export const PAPER_COLUMNS: Record<PaperWidth, number> = { 58: 32, 80: 48 }

export const DEFAULT_NETWORK_PRINTER_PORT = 9100

export interface PrinterConfig {
  id: string
  name: string
  kind: PrinterKind
  /** NETWORK: host or host:port. SYSTEM: the device name the operating system uses. */
  address: string
  paperWidth: PaperWidth
  /** The station whose tickets this printer prints; none = the default printer. */
  stationId: string | null
  stationName: string | null
  isDefault: boolean
  isActive: boolean
}

export const PRINT_STATUSES = ['PRINTED', 'FAILED'] as const
export type PrintStatus = (typeof PRINT_STATUSES)[number]

export interface KotPrintOutcome {
  kotId: string
  kotNumber: string
  status: PrintStatus
  printerName: string | null
  /** Set when the ticket could not be printed; the staff-friendly reason. */
  error: string | null
}

/** What a ticket looks like on paper, line by line, for the preview. */
export interface KotPreview {
  kotId: string
  kotNumber: string
  paperWidth: PaperWidth
  columns: number
  lines: string[]
}

export interface PrinterTestOutcome {
  status: PrintStatus
  error: string | null
}

// --- Validation ----------------------------------------------------------------------------

const idSchema = z.uuid()

const reason = (message: string) =>
  z.string(message).trim().min(3, message).max(200, 'The reason must be at most 200 characters.')

export const kotFilterSchema = z.object({
  orderId: idSchema.optional(),
  stationId: idSchema.optional(),
  statuses: z.array(z.enum(KOT_STATUSES)).max(KOT_STATUSES.length).optional(),
  /** Only tickets the kitchen still has to work on (new, accepted, preparing, ready). */
  openOnly: z.boolean().optional(),
  /** Matches the KOT or order number. */
  search: z.string().trim().max(60).optional(),
  limit: z.number().int().min(1).max(500).optional()
})

export const kotBoardInputSchema = z.object({ stationId: idSchema.optional() })

export const setKotStatusInputSchema = z.object({
  id: idSchema,
  status: z.enum(SETTABLE_KOT_STATUSES)
})

export const cancelKotInputSchema = z.object({
  id: idSchema,
  reason: reason('Say why the ticket is being cancelled.')
})

export const kotPreviewInputSchema = z.object({
  id: idSchema,
  paperWidth: z.union([z.literal(58), z.literal(80)]).optional()
})

const NETWORK_ADDRESS = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$/

const printerFields = z.object({
  name: z.string('Enter a name.').trim().min(1, 'Enter a name.').max(60),
  kind: z.enum(PRINTER_KINDS),
  address: z.string('Enter the address.').trim().min(1, 'Enter the address.').max(120),
  paperWidth: z.union([z.literal(58), z.literal(80)]),
  stationId: idSchema.nullish().transform((value) => value ?? null),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true)
})

const checkPrinter = (
  value: { kind: PrinterKind; address: string; stationId: string | null; isDefault: boolean },
  ctx: z.RefinementCtx
): void => {
  if (value.stationId !== null && value.isDefault) {
    ctx.addIssue({
      code: 'custom',
      path: ['isDefault'],
      message: 'A printer is either the default or belongs to one station, not both.'
    })
  }
  if (value.kind !== 'NETWORK') return
  const match = NETWORK_ADDRESS.exec(value.address)
  const port = value.address.includes(':') ? Number(value.address.split(':')[1]) : null
  if (!match || (port !== null && (port < 1 || port > 65535))) {
    ctx.addIssue({
      code: 'custom',
      path: ['address'],
      message:
        'Enter the printer as an IP address or host name, e.g. 192.168.1.50 or 192.168.1.50:9100.'
    })
  }
}

export const createPrinterInputSchema = printerFields.superRefine(checkPrinter)
export const updatePrinterInputSchema = printerFields
  .extend({ id: idSchema })
  .superRefine(checkPrinter)
export const testPrinterInputSchema = z.object({ id: idSchema })

export type KotBoardInput = z.input<typeof kotBoardInputSchema>
export type KotFilterInput = z.input<typeof kotFilterSchema>
export type SetKotStatusInput = z.input<typeof setKotStatusInputSchema>
export type CancelKotInput = z.input<typeof cancelKotInputSchema>
export type KotPreviewInput = z.input<typeof kotPreviewInputSchema>
export type CreatePrinterInput = z.input<typeof createPrinterInputSchema>
export type UpdatePrinterInput = z.input<typeof updatePrinterInputSchema>

export type KotFilterData = z.output<typeof kotFilterSchema>
export type SetKotStatusData = z.output<typeof setKotStatusInputSchema>
export type CancelKotData = z.output<typeof cancelKotInputSchema>
export type KotPreviewData = z.output<typeof kotPreviewInputSchema>
export type CreatePrinterData = z.output<typeof createPrinterInputSchema>
export type UpdatePrinterData = z.output<typeof updatePrinterInputSchema>
