import { ORDER_TYPE_LABELS } from '@shared/orders'
import { KOT_STATUS_LABELS, type KotDetail, type KotItem } from '@shared/kitchen'

/**
 * The kitchen ticket as a printed page. One model of the page (`TicketLine`) feeds three
 * outputs so that what staff see in the preview is exactly what the printer prints:
 * plain text (preview and operating-system printers), and ESC/POS bytes (thermal printers).
 */

export interface TicketLine {
  text: string
  align?: 'left' | 'center'
  bold?: boolean
  /** Double width and height; halves the number of characters per line. */
  large?: boolean
  /** A full-width rule instead of text. */
  rule?: boolean
  /** Draw the rule with = instead of -. */
  heavy?: boolean
  /** An amount (or any short text) pushed to the right edge of the first line. */
  right?: string
  /** Spaces to indent wrapped lines by (for the item lines). */
  hang?: number
  /** Spaces before the first line as well (for extras under an item). */
  indent?: number
  /** A caption in a fixed-width column before the text ("KOT", "Order", ...). */
  label?: string
}

export interface KotTicketInput {
  restaurantName: string
  timezone: string
  kot: KotDetail
  /** A copy of a ticket that was printed before. */
  reprint: boolean
}

const LABEL_WIDTH = 9

const labelled = (label: string, value: string): TicketLine => ({ label, text: value })

/** "06 Oct 2026, 02:32 pm" in the restaurant's time zone (UTC if the zone is not valid). */
export function formatTicketTime(iso: string, timezone: string): string {
  const date = new Date(iso)
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }
  try {
    return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: timezone }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'UTC' }).format(date)
  }
}

const dishName = (item: KotItem): string =>
  item.variantName ? `${item.name} (${item.variantName})` : item.name

function describePlace(kot: KotDetail): string {
  if (kot.orderType === 'DINE_IN') {
    const table = `Table ${kot.tableNumber ?? '?'}`
    return kot.areaName ? `${table} (${kot.areaName})` : table
  }
  return ORDER_TYPE_LABELS[kot.orderType]
}

/** Builds the ticket page. Nothing here is rounded or reordered: the ticket is a copy of the KOT. */
export function buildKotTicket(input: KotTicketInput): TicketLine[] {
  const { kot } = input
  const lines: TicketLine[] = [
    { text: input.restaurantName, align: 'center', bold: true, large: true },
    { text: 'KITCHEN ORDER TICKET', align: 'center', bold: true }
  ]
  if (kot.status === 'CANCELLED') {
    lines.push({ text: '*** CANCELLED - DO NOT PREPARE ***', align: 'center', bold: true })
  } else if (kot.revision > 0) {
    lines.push({
      text: `*** REVISED (change ${String(kot.revision)}) ***`,
      align: 'center',
      bold: true
    })
  }
  if (kot.isAdditional) {
    lines.push({ text: '** ADDITIONAL KOT **', align: 'center', bold: true })
  }
  if (input.reprint) lines.push({ text: '(REPRINT)', align: 'center', bold: true })
  lines.push({ text: kot.stationName.toUpperCase(), align: 'center', bold: true, large: true })
  lines.push({ text: '', rule: true })

  lines.push(labelled('KOT', kot.kotNumber))
  lines.push(labelled('Order', kot.orderNumber))
  lines.push(labelled('For', describePlace(kot)))
  if (kot.orderType === 'DINE_IN' && kot.guestCount !== null) {
    lines.push(labelled('Guests', String(kot.guestCount)))
  }
  if (kot.orderType !== 'DINE_IN' && kot.customerName) {
    lines.push(labelled('Customer', kot.customerName))
  }
  if (kot.orderType !== 'DINE_IN' && kot.customerPhone) {
    lines.push(labelled('Phone', kot.customerPhone))
  }
  if (kot.orderType === 'DELIVERY' && kot.deliveryAddress) {
    lines.push(labelled('Address', kot.deliveryAddress))
  }
  if (kot.orderType !== 'DINE_IN' && kot.promisedAt) {
    const when = formatTicketTime(kot.promisedAt, input.timezone)
    lines.push({
      ...labelled(kot.orderType === 'DELIVERY' ? 'Due by' : 'Ready by', when),
      bold: true
    })
  }
  lines.push(labelled('Time', formatTicketTime(kot.createdAt, input.timezone)))
  lines.push(labelled('Taken by', kot.createdByName))
  lines.push({ text: '', rule: true })

  const live = kot.items.filter((item) => item.status === 'ACTIVE')
  const cancelled = kot.items.filter((item) => item.status === 'CANCELLED')
  for (const item of live) {
    lines.push({ text: `${String(item.quantity)} x ${dishName(item)}`, bold: true, hang: 4 })
    for (const addon of item.addons) {
      lines.push({
        text: `${addon.kind === 'MODIFIER' ? '-' : '+'} ${addon.name}`,
        indent: 2,
        hang: 2
      })
    }
    if (item.notes) lines.push({ text: `NOTE: ${item.notes}`, bold: true, indent: 2, hang: 6 })
  }
  if (cancelled.length > 0 && kot.status !== 'CANCELLED') {
    lines.push({ text: '', rule: true })
    lines.push({ text: 'CANCELLED ITEMS - DO NOT MAKE', bold: true })
    for (const item of cancelled) {
      lines.push({ text: `X ${String(item.quantity)} x ${dishName(item)}`, hang: 6 })
      if (item.cancelReason) lines.push({ text: `Reason: ${item.cancelReason}`, hang: 6 })
    }
  }
  if (kot.status === 'CANCELLED' && kot.cancelReason) {
    lines.push({ text: `Reason: ${kot.cancelReason}`, bold: true, hang: 8 })
  }

  lines.push({ text: '', rule: true })
  lines.push({
    text: `Items: ${String(live.reduce((sum, item) => sum + item.quantity, 0))}`,
    bold: true
  })
  if (kot.orderNotes) lines.push({ text: `Order note: ${kot.orderNotes}`, hang: 12 })
  lines.push({ text: KOT_STATUS_LABELS[kot.status].toUpperCase(), align: 'center' })
  return lines
}

/** A page that proves a printer works, for the "print test page" button. */
export function buildTestTicket(
  restaurantName: string,
  printerName: string,
  now: string
): TicketLine[] {
  return [
    { text: restaurantName, align: 'center', bold: true, large: true },
    { text: 'PRINTER TEST', align: 'center', bold: true },
    { text: '', rule: true },
    { text: `Printer: ${printerName}`, hang: 9 },
    { text: `Time: ${now}`, hang: 6 },
    { text: '', rule: true },
    { text: 'If you can read this, kitchen tickets will print here.', hang: 0 },
    { text: '1234567890 ABCDEFGHIJKLMNOPQRSTUVWXYZ', hang: 0 }
  ]
}

/** Characters the printer's code page can show; anything else becomes "?". */
export function toPrintable(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/g, '?')
}

/** Splits text into lines no longer than `width`, indenting every line after the first by `hang`. */
export function wrapText(text: string, width: number, hang = 0): string[] {
  const safeHang = Math.min(hang, Math.max(width - 8, 0))
  const result: string[] = []
  let line = ''
  const flush = (): void => {
    result.push(line.trimEnd())
    line = ' '.repeat(safeHang)
  }
  for (const word of text.split(/\s+/).filter((part) => part.length > 0)) {
    let rest = word
    // A word longer than the line is cut.
    while (rest.length > width - safeHang) {
      if (line.trim().length > 0) flush()
      const room = width - line.length
      line += rest.slice(0, room)
      rest = rest.slice(room)
      flush()
    }
    const needsSpace = line.trim().length > 0 ? 1 : 0
    if (line.length + needsSpace + rest.length > width) flush()
    line += (line.trim().length > 0 ? ' ' : '') + rest
  }
  if (line.trim().length > 0 || result.length === 0) result.push(line.trimEnd())
  return result
}

interface RenderedLine {
  text: string
  align: 'left' | 'center'
  bold: boolean
  large: boolean
}

function layout(lines: readonly TicketLine[], columns: number): RenderedLine[] {
  const rendered: RenderedLine[] = []
  for (const line of lines) {
    if (line.rule) {
      rendered.push({
        text: (line.heavy === true ? '=' : '-').repeat(columns),
        align: 'left',
        bold: false,
        large: false
      })
      continue
    }
    const width = line.large ? Math.floor(columns / 2) : columns
    const label = line.label === undefined ? '' : toPrintable(line.label).padEnd(LABEL_WIDTH)
    const lead = ' '.repeat(label.length > 0 ? 0 : (line.indent ?? 0))
    const right = line.right === undefined ? '' : toPrintable(line.right)
    // Room for the amount on the first line, and one space between it and the text.
    const reserved = right.length > 0 ? right.length + 1 : 0
    const body = wrapText(
      toPrintable(line.text),
      width - label.length - lead.length - reserved,
      line.hang ?? 0
    )
    const pieces = body.map((piece, index) =>
      index === 0 ? `${label}${lead}${piece}` : `${' '.repeat(label.length)}${lead}${piece}`
    )
    if (right.length > 0 && pieces[0] !== undefined) {
      pieces[0] = pieces[0].padEnd(Math.max(width - right.length, 0)) + right
    }
    for (const piece of pieces) {
      rendered.push({
        text: piece,
        align: line.align ?? 'left',
        bold: line.bold === true,
        large: line.large === true
      })
    }
  }
  return rendered
}

/** The ticket as plain lines of text, centred with spaces where needed. */
export function renderText(lines: readonly TicketLine[], columns: number): string[] {
  return layout(lines, columns).map((line) => {
    const width = line.large ? line.text.length * 2 : line.text.length
    const pad = line.align === 'center' ? Math.max(Math.floor((columns - width) / 2), 0) : 0
    return ' '.repeat(pad) + line.text
  })
}

const ESC = 0x1b
const GS = 0x1d

/** The ticket as ESC/POS bytes: initialise, print each line with its style, feed and cut. */
export function renderEscPos(lines: readonly TicketLine[], columns: number): Buffer {
  const bytes: number[] = [ESC, 0x40]
  for (const line of layout(lines, columns)) {
    bytes.push(ESC, 0x61, line.align === 'center' ? 1 : 0)
    bytes.push(ESC, 0x45, line.bold ? 1 : 0)
    bytes.push(GS, 0x21, line.large ? 0x11 : 0x00)
    for (const char of line.text) bytes.push(char.charCodeAt(0))
    bytes.push(0x0a)
  }
  bytes.push(GS, 0x21, 0x00, ESC, 0x45, 0x00, ESC, 0x61, 0x00)
  bytes.push(ESC, 0x64, 4) // feed four lines
  bytes.push(GS, 0x56, 0x42, 0x03) // partial cut
  return Buffer.from(bytes)
}
