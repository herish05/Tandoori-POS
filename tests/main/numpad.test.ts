import { describe, expect, it } from 'vitest'
import { applyPadKey, PAD_MAX_LENGTH, type PadKey } from '../../src/lib/numpad'

const press = (keys: PadKey[], start = ''): string =>
  keys.reduce((value, key) => applyPadKey(value, key), start)

describe('number pad', () => {
  it('types digits in order', () => {
    expect(press(['1', '2', '5'])).toBe('125')
  })

  it('adds 00 for round amounts', () => {
    expect(press(['5', '00'])).toBe('500')
  })

  it('does not build leading zeros', () => {
    expect(press(['0', '0'])).toBe('0')
    expect(press(['0', '5'])).toBe('5')
    expect(press(['00'])).toBe('0')
  })

  it('starts a decimal with 0.', () => {
    expect(press(['.'])).toBe('0.')
    expect(press(['.', '5'])).toBe('0.5')
  })

  it('accepts only one decimal point', () => {
    expect(press(['1', '.', '5', '.'])).toBe('1.5')
  })

  it('keeps at most two decimals', () => {
    expect(press(['1', '.', '2', '5', '9'])).toBe('1.25')
    expect(press(['1', '.', '2', '00'])).toBe('1.2')
  })

  it('backspaces and clears', () => {
    expect(press(['back'], '125')).toBe('12')
    expect(press(['back'], '')).toBe('')
    expect(press(['clear'], '12.5')).toBe('')
  })

  it('stops at the maximum length', () => {
    const full = '1'.repeat(PAD_MAX_LENGTH)
    expect(press(['1'], full)).toBe(full)
  })
})
