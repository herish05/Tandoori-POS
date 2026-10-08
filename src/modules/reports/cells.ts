import type { ReportCell, ReportColumnType } from '@shared/reports'
import { formatDateTime } from '@/lib/format'
import { formatDay } from '@/modules/expenses/hooks'

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

/** Thousandths as a decimal without trailing zeros: 1500 becomes "1.5". */
function quantity(thousandths: number): string {
  const sign = thousandths < 0 ? '-' : ''
  const abs = Math.abs(thousandths)
  const fraction = String(abs % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${sign}${String(Math.floor(abs / 1000))}${fraction ? `.${fraction}` : ''}`
}

/** A report cell as it reads on screen. Money is paise, quantities thousandths, percents basis points. */
export function formatCell(value: ReportCell, type: ReportColumnType): string {
  if (value === null || value === '') return ''
  if (typeof value === 'string') {
    if (type === 'date') return formatDay(value)
    if (type === 'datetime') return formatDateTime(value)
    return value
  }
  switch (type) {
    case 'money':
      return money.format(value / 100)
    case 'quantity':
      return quantity(value)
    case 'percent':
      return `${(value / 100).toFixed(2)}%`
    default:
      return String(value)
  }
}

/** Numbers line up on the right. */
export const isNumericColumn = (type: ReportColumnType): boolean =>
  type === 'int' ||
  type === 'money' ||
  type === 'quantity' ||
  type === 'percent' ||
  type === 'minutes'
