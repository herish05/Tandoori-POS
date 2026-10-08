/**
 * Calendar days as the terminal sees them. A "day" is the local day of the machine the app runs
 * on, the same clock the till and the receipts use. Dates travel as `YYYY-MM-DD`.
 */

const pad = (value: number): string => String(value).padStart(2, '0')

/** `YYYY-MM-DD` of a moment, in local time. */
export function localDateString(at: number | Date): string {
  const date = new Date(at)
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parts(date: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return [year, month, day]
}

/** Midnight at the start of a local day. */
export function startOfLocalDay(date: string): Date {
  const [year, month, day] = parts(date)
  return new Date(year, month - 1, day)
}

/** Midnight at the end of a local day, i.e. the start of the next one. */
export function endOfLocalDay(date: string): Date {
  const [year, month, day] = parts(date)
  return new Date(year, month - 1, day + 1)
}

/** First and last day of the month a moment falls in. */
export function monthOf(at: number | Date): { from: string; to: string } {
  const date = new Date(at)
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return { from: localDateString(first), to: localDateString(last) }
}

/** How far ahead of the clock a recorded time may be before it counts as "in the future". */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

export function isInFuture(at: Date, now: number): boolean {
  return at.getTime() > now + FUTURE_TOLERANCE_MS
}

/** A `YYYY-MM-DD` date moved by a number of days (negative for earlier). */
export function addLocalDays(date: string, days: number): string {
  const [year, month, day] = parts(date)
  return localDateString(new Date(year, month - 1, day + days))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-01-05` as "5 Jan 2026", for messages. */
export function describeDate(date: string): string {
  const [year, month, day] = parts(date)
  return `${String(day)} ${MONTHS[month - 1] ?? ''} ${String(year)}`
}
