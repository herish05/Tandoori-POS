/** What a keypad key does to the text of an amount field (rupees, at most two decimals). */
export type PadKey =
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'back' | 'clear'

export const PAD_MAX_LENGTH = 9

export function applyPadKey(value: string, key: PadKey): string {
  if (key === 'clear') return ''
  if (key === 'back') return value.slice(0, -1)

  let next = value
  if (key === '.') {
    if (value.includes('.')) return value
    next = value === '' ? '0.' : `${value}.`
  } else {
    const [, decimals] = value.split('.')
    if (decimals !== undefined && decimals.length + key.length > 2) return value
    next = value === '0' ? key.replace(/^0+(?=\d)/, '') : value + key
    if (next === '00') next = '0'
  }
  return next.length > PAD_MAX_LENGTH ? value : next
}
