/**
 * Money on screen. The app stores and computes prices as whole paise; people type and read
 * rupees. These helpers convert at the edge so no screen ever does floating-point money maths.
 */

const AMOUNT_PATTERN = /^\d{1,7}(?:\.\d{1,2})?$/
const PERCENT_PATTERN = /^\d{1,3}(?:\.\d{1,2})?$/

/** "260" or "260.5" → 26000 or 26050. Anything else (including blank) → NaN. */
export function parseRupees(text: string): number {
  const cleaned = text.trim().replace(/^₹\s*/, '')
  if (!AMOUNT_PATTERN.test(cleaned)) return Number.NaN
  const [whole = '0', fraction = ''] = cleaned.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

/** Like {@link parseRupees}, but a blank field means 0 (for optional amounts). */
export function parseOptionalRupees(text: string): number {
  return text.trim() === '' ? 0 : parseRupees(text)
}

/** 26050 → "260.50", 26000 → "260": what to put in a text field. */
export function paiseToInput(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const rest = paise % 100
  return rest === 0 ? String(rupees) : `${String(rupees)}.${String(rest).padStart(2, '0')}`
}

/** 26050 → "₹260.50", 26000 → "₹260", 12345678 → "₹1,23,456.78". */
export function formatMoney(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(paise / 100)
}

/** "5" or "2.5" → basis points (500 or 250). Anything else → NaN. */
export function parsePercentToBps(text: string): number {
  const cleaned = text.trim().replace(/%$/, '').trim()
  if (!PERCENT_PATTERN.test(cleaned)) return Number.NaN
  const [whole = '0', fraction = ''] = cleaned.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

/** 500 → "5", 250 → "2.5", 1850 → "18.5". */
export function bpsToInput(bps: number): string {
  return paiseToInput(bps)
}

/** 500 → "5%", 250 → "2.5%". */
export function formatPercent(bps: number): string {
  return `${bpsToInput(bps)}%`
}
