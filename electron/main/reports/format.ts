import { describeDate, localDateString } from '../finance/dates'
import type { ReportCell, ReportColumnType, ReportResult } from '@shared/reports'

const pad = (value: number): string => String(value).padStart(2, '0')

const timeOf = (iso: string): string => {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Whole paise as rupees with two decimals, e.g. 46700 -> "467.00". */
export function plainMoney(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  return `${sign}${String(Math.floor(abs / 100))}.${pad(abs % 100)}`
}

/** Thousandths as a decimal without trailing zeros, e.g. 1500 -> "1.5". */
export function plainQuantity(thousandths: number): string {
  const sign = thousandths < 0 ? '-' : ''
  const abs = Math.abs(thousandths)
  const whole = String(Math.floor(abs / 1000))
  const fraction = String(abs % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`
}

const plainPercent = (bps: number): string => (bps / 100).toFixed(2)

const groupIndian = (whole: string): string => {
  if (whole.length <= 3) return whole
  const tail = whole.slice(-3)
  const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return `${head},${tail}`
}

/** A cell the way it reads on paper: rupees with Indian digit grouping, dates in words. */
export function displayCell(value: ReportCell, type: ReportColumnType): string {
  if (value === null || value === '') return ''
  if (typeof value === 'string') {
    if (type === 'date') return describeDate(value)
    if (type === 'datetime') {
      const date = new Date(value)
      return Number.isNaN(date.getTime())
        ? value
        : `${describeDate(localDateString(date))}, ${timeOf(value)}`
    }
    return value
  }
  switch (type) {
    case 'money': {
      const [whole = '0', fraction = '00'] = plainMoney(Math.abs(value)).split('.')
      return `${value < 0 ? '-' : ''}\u20B9${groupIndian(whole)}.${fraction}`
    }
    case 'quantity':
      return plainQuantity(value)
    case 'percent':
      return `${plainPercent(value)}%`
    default:
      return String(value)
  }
}

/** A cell for a spreadsheet: plain numbers so they can be added up, dates in a sortable form. */
function csvCell(value: ReportCell, type: ReportColumnType): string {
  if (value === null) return ''
  if (typeof value === 'number') {
    if (type === 'money') return plainMoney(value)
    if (type === 'quantity') return plainQuantity(value)
    if (type === 'percent') return plainPercent(value)
    return String(value)
  }
  if (type === 'datetime') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return `${localDateString(date)} ${timeOf(value)}`
  }
  return value
}

/** Quotes a field, and defuses text a spreadsheet would run as a formula. */
function csvField(text: string, numeric: boolean): string {
  const safe = !numeric && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The report as CSV: a header, one line per row and a totals line, with a BOM so Excel reads it as UTF-8. */
export function reportToCsv(result: ReportResult): string {
  const lines: string[] = []
  lines.push(result.columns.map((c) => csvField(c.label, false)).join(','))
  const numeric = (type: ReportColumnType): boolean =>
    type === 'int' ||
    type === 'money' ||
    type === 'quantity' ||
    type === 'percent' ||
    type === 'minutes'
  for (const row of result.rows) {
    lines.push(
      result.columns
        .map((c) => csvField(csvCell(row[c.key] ?? null, c.type), numeric(c.type)))
        .join(',')
    )
  }
  const { totals } = result
  if (totals) {
    lines.push(
      result.columns
        .map((c, index) => {
          if (index === 0) return csvField('Total', false)
          return csvField(csvCell(totals[c.key] ?? null, c.type), numeric(c.type))
        })
        .join(',')
    )
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const isRight = (type: ReportColumnType): boolean =>
  type === 'int' ||
  type === 'money' ||
  type === 'quantity' ||
  type === 'percent' ||
  type === 'minutes'

/** A self-contained page of the report for printing or saving as a PDF. */
export function reportToHtml(result: ReportResult, restaurantName: string): string {
  const head = result.columns
    .map((c) => `<th class="${isRight(c.type) ? 'r' : ''}">${escapeHtml(c.label)}</th>`)
    .join('')
  const body = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map(
            (c) =>
              `<td class="${isRight(c.type) ? 'r' : ''}">${escapeHtml(displayCell(row[c.key] ?? null, c.type))}</td>`
          )
          .join('')}</tr>`
    )
    .join('')
  const { totals } = result
  const foot = totals
    ? `<tfoot><tr>${result.columns
        .map((c, index) => {
          const text = index === 0 ? 'Total' : displayCell(totals[c.key] ?? null, c.type)
          return `<td class="${isRight(c.type) ? 'r' : ''}">${escapeHtml(text)}</td>`
        })
        .join('')}</tr></tfoot>`
    : ''
  const summary = result.summary
    .map(
      (s) =>
        `<div class="card"><div class="k">${escapeHtml(s.label)}</div><div class="v">${escapeHtml(displayCell(s.value, s.type))}</div></div>`
    )
    .join('')
  const period =
    result.from === result.to
      ? describeDate(result.from)
      : `${describeDate(result.from)} to ${describeDate(result.to)}`
  const filters =
    result.filters.length > 0 ? ` &middot; ${escapeHtml(result.filters.join(' · '))}` : ''
  const empty =
    result.rows.length === 0 ? '<p class="note">Nothing to show for this period.</p>' : ''
  const truncated = result.truncated
    ? '<p class="note">Only the first rows are shown. Narrow the period to see the rest.</p>'
    : ''
  const landscape = result.columns.length > 7

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(result.title)}</title>
<style>
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #111; margin: 0; }
  h1 { font-size: 16px; margin: 0; }
  .sub { color: #444; margin: 2px 0 8px; }
  .cards { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .card { border: 1px solid #bbb; border-radius: 4px; padding: 4px 8px; min-width: 90px; }
  .k { color: #555; font-size: 9px; }
  .v { font-size: 12px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #ddd; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; border-bottom: 1px solid #999; }
  .r { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 1px solid #999; border-bottom: 0; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .note { color: #555; margin: 8px 0; }
  .foot { margin-top: 10px; color: #666; font-size: 9px; }
</style>
</head>
<body>
<h1>${escapeHtml(restaurantName)}</h1>
<div class="sub"><strong>${escapeHtml(result.title)}</strong> &middot; ${escapeHtml(period)}${filters}</div>
<div class="cards">${summary}</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
${empty}${truncated}
<div class="foot">Generated ${escapeHtml(displayCell(result.generatedAt, 'datetime'))}</div>
</body>
</html>
`
}
