import { describe, expect, it } from 'vitest'
import {
  allocate,
  allocatePayments,
  BillCalculationError,
  calculateBill,
  discountAmount,
  mulDivRound,
  percentOf,
  roundToUnit,
  type CalcConfig,
  type CalcLineInput,
  type DiscountSpec
} from '@main/billing/calculator'

/** Exact paise, no round off, intra-state, no service charge unless a test changes it. */
const PLAIN: CalcConfig = {
  taxMode: 'INTRA_STATE',
  serviceChargeBps: 0,
  serviceChargeTaxable: true,
  roundOffUnit: 1
}

function line(
  id: string,
  unitPrice: number,
  quantity: number,
  taxRateBps = 0,
  discount: DiscountSpec | null = null
): CalcLineInput {
  return { id, unitPrice, quantity, taxRateBps, discount }
}

const pct = (bps: number): DiscountSpec => ({ type: 'PERCENTAGE', value: bps })
const fixed = (paise: number): DiscountSpec => ({ type: 'FIXED', value: paise })

describe('rounding helpers', () => {
  it('rounds half up and never uses floating point for the product', () => {
    expect(mulDivRound(12500, 500, 20000)).toBe(313) // 312.5
    expect(mulDivRound(12499, 500, 20000)).toBe(312) // 312.475
    expect(percentOf(10000, 1000)).toBe(1000)
    expect(percentOf(333, 1000)).toBe(33) // 33.3
    expect(percentOf(335, 1000)).toBe(34) // 33.5
    // 0.1 + 0.2 style traps: 29 x 7% in floats is 2.0300000000000002
    expect(percentOf(29, 700)).toBe(2)
    // Far beyond 2^53 when multiplied, still exact.
    expect(mulDivRound(299_999_999, 9_999, 10_000)).toBe(299_969_999)
  })

  it('rounds to a unit, halves up', () => {
    expect(roundToUnit(10549, 100)).toBe(10500)
    expect(roundToUnit(10550, 100)).toBe(10600)
    expect(roundToUnit(1234, 10)).toBe(1230)
    expect(roundToUnit(1235, 10)).toBe(1240)
    expect(roundToUnit(1274, 50)).toBe(1250)
    expect(roundToUnit(1275, 50)).toBe(1300)
    expect(roundToUnit(1234, 1)).toBe(1234)
    expect(roundToUnit(0, 100)).toBe(0)
  })
})

describe('allocate', () => {
  it('splits exactly, the odd paisa going to the largest remainder then the first line', () => {
    expect(allocate(1000, [10000, 10000, 10000])).toEqual([334, 333, 333])
    expect(allocate(100, [1, 2])).toEqual([33, 67])
    expect(allocate(10, [1, 1, 1, 1])).toEqual([3, 3, 2, 2])
  })

  it('gives nothing to a zero-weight line and handles a zero total', () => {
    expect(allocate(500, [0, 100, 0])).toEqual([0, 500, 0])
    expect(allocate(0, [0, 0])).toEqual([0, 0])
    expect(allocate(7, [5])).toEqual([7])
  })

  it('refuses to share an amount over nothing', () => {
    expect(() => allocate(10, [0, 0])).toThrow(BillCalculationError)
  })

  it('always adds up to the total', () => {
    let seed = 12345
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed
    }
    for (let i = 0; i < 500; i += 1) {
      const weights = Array.from({ length: 1 + (next() % 9) }, () => next() % 100_000)
      if (weights.every((w) => w === 0)) continue
      const total = next() % 5_000_000
      const shares = allocate(total, weights)
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total)
      shares.forEach((share) => {
        expect(Number.isInteger(share)).toBe(true)
        expect(share).toBeGreaterThanOrEqual(0)
      })
    }
  })
})

describe('discountAmount', () => {
  it('works out percentage and fixed discounts', () => {
    expect(discountAmount(20000, pct(1000), 'bill')).toBe(2000)
    expect(discountAmount(20000, pct(10000), 'bill')).toBe(20000)
    expect(discountAmount(20000, fixed(500), 'bill')).toBe(500)
    expect(discountAmount(20000, fixed(20000), 'bill')).toBe(20000)
  })

  it('refuses zero, negative, fractional and oversized discounts', () => {
    expect(() => discountAmount(20000, pct(0), 'bill')).toThrow(BillCalculationError)
    expect(() => discountAmount(20000, pct(10001), 'bill')).toThrow(BillCalculationError)
    expect(() => discountAmount(20000, fixed(20001), 'bill')).toThrow(BillCalculationError)
    expect(() => discountAmount(20000, fixed(-5), 'bill')).toThrow(BillCalculationError)
    expect(() => discountAmount(20000, fixed(10.5), 'bill')).toThrow(BillCalculationError)
  })
})

describe('calculateBill', () => {
  it('prices a single item', () => {
    const result = calculateBill({ lines: [line('a', 10000, 1)], config: PLAIN })
    expect(result.subtotal).toBe(10000)
    expect(result.taxes).toEqual([])
    expect(result.taxTotal).toBe(0)
    expect(result.roundOff).toBe(0)
    expect(result.grandTotal).toBe(10000)
  })

  it('prices an empty bill at nothing', () => {
    const result = calculateBill({ lines: [], config: PLAIN })
    expect(result.grandTotal).toBe(0)
    expect(result.lines).toEqual([])
  })

  it('multiplies by the quantity', () => {
    const result = calculateBill({ lines: [line('a', 12000, 3)], config: PLAIN })
    expect(result.lines[0]?.gross).toBe(36000)
    expect(result.grandTotal).toBe(36000)
  })

  it('adds several items', () => {
    const result = calculateBill({
      lines: [line('a', 25000, 1), line('b', 18000, 2), line('c', 999, 5)],
      config: PLAIN
    })
    expect(result.subtotal).toBe(25000 + 36000 + 4995)
    expect(result.grandTotal).toBe(65995)
  })

  it('splits GST into equal CGST and SGST halves', () => {
    const result = calculateBill({ lines: [line('a', 10000, 1, 500)], config: PLAIN })
    expect(result.taxes).toEqual([
      { component: 'CGST', rateBps: 500, taxableAmount: 10000, taxAmount: 250 },
      { component: 'SGST', rateBps: 500, taxableAmount: 10000, taxAmount: 250 }
    ])
    expect(result.taxTotal).toBe(500)
    expect(result.grandTotal).toBe(10500)
  })

  it('groups tax by rate across items', () => {
    const result = calculateBill({
      lines: [line('a', 25000, 1, 500), line('b', 18000, 2, 1800), line('c', 5000, 1, 500)],
      config: PLAIN
    })
    expect(result.taxes).toEqual([
      { component: 'CGST', rateBps: 500, taxableAmount: 30000, taxAmount: 750 },
      { component: 'SGST', rateBps: 500, taxableAmount: 30000, taxAmount: 750 },
      { component: 'CGST', rateBps: 1800, taxableAmount: 36000, taxAmount: 3240 },
      { component: 'SGST', rateBps: 1800, taxableAmount: 36000, taxAmount: 3240 }
    ])
    expect(result.taxTotal).toBe(7980)
    expect(result.grandTotal).toBe(25000 + 36000 + 5000 + 7980)
  })

  it('charges IGST as one component for inter-state sales', () => {
    const result = calculateBill({
      lines: [line('a', 10000, 1, 500), line('b', 36000, 1, 1800)],
      config: { ...PLAIN, taxMode: 'INTER_STATE' }
    })
    expect(result.taxes).toEqual([
      { component: 'IGST', rateBps: 500, taxableAmount: 10000, taxAmount: 500 },
      { component: 'IGST', rateBps: 1800, taxableAmount: 36000, taxAmount: 6480 }
    ])
    expect(result.grandTotal).toBe(46000 + 6980)
  })

  it('leaves untaxed items out of the tax lines', () => {
    const result = calculateBill({
      lines: [line('a', 10000, 1, 0), line('b', 10000, 1, 500)],
      config: PLAIN
    })
    expect(result.taxes).toHaveLength(2)
    expect(result.taxTotal).toBe(500)
    expect(result.grandTotal).toBe(20500)
  })

  it('takes a percentage item discount off before tax', () => {
    const result = calculateBill({
      lines: [line('a', 10000, 2, 500, pct(1000))],
      config: PLAIN
    })
    expect(result.itemDiscountTotal).toBe(2000)
    expect(result.lines[0]?.itemDiscount).toBe(2000)
    expect(result.taxes[0]?.taxableAmount).toBe(18000)
    expect(result.taxTotal).toBe(900)
    expect(result.grandTotal).toBe(18900)
  })

  it('takes a fixed item discount off before tax, rounding each GST half up', () => {
    const result = calculateBill({
      lines: [line('a', 15000, 1, 500, fixed(2500))],
      config: PLAIN
    })
    expect(result.taxes.map((t) => t.taxAmount)).toEqual([313, 313]) // 312.5 each
    expect(result.grandTotal).toBe(12500 + 626)
  })

  it('treats a zero or missing discount as no discount', () => {
    const none = calculateBill({ lines: [line('a', 10000, 1, 500)], config: PLAIN })
    const nulls = calculateBill({
      lines: [line('a', 10000, 1, 500, null)],
      billDiscount: null,
      config: PLAIN
    })
    expect(nulls).toEqual(none)
    expect(none.itemDiscountTotal).toBe(0)
    expect(none.billDiscountTotal).toBe(0)
  })

  it('shares a percentage bill discount over the lines', () => {
    const result = calculateBill({
      lines: [line('a', 10000, 1, 500), line('b', 20000, 1, 500)],
      billDiscount: pct(1000),
      config: PLAIN
    })
    expect(result.billDiscountTotal).toBe(3000)
    expect(result.lines.map((l) => l.billDiscountShare)).toEqual([1000, 2000])
    expect(result.taxes[0]?.taxableAmount).toBe(27000)
    expect(result.taxTotal).toBe(1350)
    expect(result.grandTotal).toBe(27000 + 1350)
  })

  it('shares a fixed bill discount without losing a paisa', () => {
    const result = calculateBill({
      lines: [line('a', 10000, 1), line('b', 10000, 1), line('c', 10000, 1)],
      billDiscount: fixed(1000),
      config: PLAIN
    })
    expect(result.lines.map((l) => l.billDiscountShare)).toEqual([334, 333, 333])
    expect(result.grandTotal).toBe(29000)
  })

  it('shares the bill discount over what is left after item discounts', () => {
    const result = calculateBill({
      lines: [line('a', 10000, 1, 0, pct(1000)), line('b', 5000, 1)],
      billDiscount: fixed(700),
      config: PLAIN
    })
    expect(result.itemDiscountTotal).toBe(1000)
    expect(result.lines.map((l) => l.billDiscountShare)).toEqual([450, 250])
    expect(result.discountedSubtotal).toBe(13300)
    expect(result.grandTotal).toBe(13300)
  })

  it('lets a bill discount cover the whole bill', () => {
    const result = calculateBill({
      lines: [line('a', 10000, 1, 500)],
      billDiscount: pct(10000),
      config: { ...PLAIN, serviceChargeBps: 1000 }
    })
    expect(result.discountedSubtotal).toBe(0)
    expect(result.serviceCharge).toBe(0)
    expect(result.taxes).toEqual([])
    expect(result.grandTotal).toBe(0)
  })

  it('refuses a fixed bill discount larger than the bill', () => {
    expect(() =>
      calculateBill({
        lines: [line('a', 10000, 1, 0, fixed(4000))],
        billDiscount: fixed(6001),
        config: PLAIN
      })
    ).toThrow(BillCalculationError)
  })

  it('adds a taxable service charge to the taxable value', () => {
    const result = calculateBill({
      lines: [line('a', 20000, 1, 500)],
      config: { ...PLAIN, serviceChargeBps: 1000 }
    })
    expect(result.serviceCharge).toBe(2000)
    expect(result.taxes[0]?.taxableAmount).toBe(22000)
    expect(result.taxTotal).toBe(1100)
    expect(result.grandTotal).toBe(23100)
  })

  it('keeps a non-taxable service charge out of the taxable value', () => {
    const result = calculateBill({
      lines: [line('a', 20000, 1, 500)],
      config: { ...PLAIN, serviceChargeBps: 1000, serviceChargeTaxable: false }
    })
    expect(result.serviceCharge).toBe(2000)
    expect(result.taxes[0]?.taxableAmount).toBe(20000)
    expect(result.grandTotal).toBe(20000 + 2000 + 1000)
  })

  it('charges service on the discounted amount', () => {
    const result = calculateBill({
      lines: [line('a', 20000, 1, 500)],
      billDiscount: pct(1000),
      config: { ...PLAIN, serviceChargeBps: 1000 }
    })
    expect(result.serviceCharge).toBe(1800)
    expect(result.taxTotal).toBe(990)
    expect(result.grandTotal).toBe(18000 + 1800 + 990)
  })

  it("taxes the service charge at each line's own rate", () => {
    const result = calculateBill({
      lines: [line('a', 10000, 1, 500), line('b', 10000, 1, 1800)],
      config: { ...PLAIN, serviceChargeBps: 1000 }
    })
    expect(result.lines.map((l) => l.serviceChargeShare)).toEqual([1000, 1000])
    expect(result.taxes.map((t) => t.taxAmount)).toEqual([275, 275, 990, 990])
    expect(result.grandTotal).toBe(20000 + 2000 + 2530)
  })

  it('rounds off to the nearest rupee, up or down', () => {
    const up = calculateBill({
      lines: [line('a', 10050, 1, 500)],
      config: { ...PLAIN, roundOffUnit: 100 }
    })
    expect(up.preRoundTotal).toBe(10552)
    expect(up.roundOff).toBe(48)
    expect(up.grandTotal).toBe(10600)

    const down = calculateBill({
      lines: [line('a', 12347, 1)],
      config: { ...PLAIN, roundOffUnit: 100 }
    })
    expect(down.roundOff).toBe(-47)
    expect(down.grandTotal).toBe(12300)

    const half = calculateBill({
      lines: [line('a', 10550, 1)],
      config: { ...PLAIN, roundOffUnit: 100 }
    })
    expect(half.roundOff).toBe(50)
    expect(half.grandTotal).toBe(10600)
  })

  it('supports the other round-off units and none', () => {
    const base = { lines: [line('a', 12347, 1)] }
    expect(calculateBill({ ...base, config: { ...PLAIN, roundOffUnit: 1 } }).grandTotal).toBe(12347)
    expect(calculateBill({ ...base, config: { ...PLAIN, roundOffUnit: 10 } }).grandTotal).toBe(
      12350
    )
    expect(calculateBill({ ...base, config: { ...PLAIN, roundOffUnit: 50 } }).grandTotal).toBe(
      12350
    )
  })

  it('rounds the tax-inclusive total and records the difference', () => {
    const result = calculateBill({
      lines: [line('a', 33333, 1, 500)],
      config: { ...PLAIN, roundOffUnit: 100 }
    })
    // 33333 + 2 x round(833.325) = 33333 + 1666 = 34999
    expect(result.taxTotal).toBe(1666)
    expect(result.preRoundTotal).toBe(34999)
    expect(result.grandTotal).toBe(35000)
    expect(result.roundOff).toBe(1)
  })

  it('stays exact on the biggest bill allowed', () => {
    const lines = Array.from({ length: 100 }, (_, i) => line(`l${i}`, 300_000_000, 99, 1800))
    const result = calculateBill({
      lines,
      billDiscount: pct(1234),
      config: { ...PLAIN, serviceChargeBps: 1000, roundOffUnit: 100 }
    })
    expect(result.subtotal).toBe(300_000_000 * 99 * 100)
    expect(Number.isSafeInteger(result.grandTotal)).toBe(true)
    expect(result.lines.reduce((s, l) => s + l.billDiscountShare, 0)).toBe(result.billDiscountTotal)
    expect(result.grandTotal % 100).toBe(0)
  })

  it('refuses bad input', () => {
    const bad = (l: CalcLineInput): void => {
      expect(() => calculateBill({ lines: [l], config: PLAIN })).toThrow(BillCalculationError)
    }
    bad(line('a', -1, 1))
    bad(line('a', 10.5, 1))
    bad(line('a', 300_000_001, 1))
    bad(line('a', 100, 0))
    bad(line('a', 100, 100))
    bad(line('a', 100, 1.5))
    bad(line('a', 100, 1, 10001))
    bad(line('a', 100, 1, -1))
    bad(line('a', 100, 1, 0, fixed(101)))
    bad(line('a', 100, 1, 0, pct(10001)))
    expect(() =>
      calculateBill({ lines: [line('a', 100, 1)], config: { ...PLAIN, serviceChargeBps: -1 } })
    ).toThrow(BillCalculationError)
    expect(() =>
      calculateBill({
        lines: [line('a', 100, 1)],
        config: { ...PLAIN, roundOffUnit: 5 as unknown as CalcConfig['roundOffUnit'] }
      })
    ).toThrow(BillCalculationError)
    expect(() =>
      calculateBill({
        lines: Array.from({ length: 101 }, (_, i) => line(`l${i}`, 1, 1)),
        config: PLAIN
      })
    ).toThrow(BillCalculationError)
  })

  it('always balances, over many random bills', () => {
    let seed = 987654321
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed
    }
    const rates = [0, 0, 250, 500, 1200, 1800, 2800]
    const units = [1, 10, 50, 100] as const
    for (let i = 0; i < 1000; i += 1) {
      const lines = Array.from({ length: 1 + (next() % 8) }, (_, n) => {
        const unit = next() % 200_000
        const qty = 1 + (next() % 12)
        const rate = rates[next() % rates.length] ?? 0
        const spec: DiscountSpec | null =
          next() % 3 === 0
            ? next() % 2 === 0
              ? pct(1 + (next() % 10000))
              : fixed(1 + (next() % Math.max(1, unit * qty)))
            : null
        const discount =
          spec && (spec.type === 'PERCENTAGE' || spec.value <= unit * qty) ? spec : null
        return line(`l${n}`, unit, qty, rate, discount)
      })
      const net = lines.reduce(
        (s, l) =>
          s +
          l.unitPrice * l.quantity -
          (l.discount ? discountAmount(l.unitPrice * l.quantity, l.discount, 'item') : 0),
        0
      )
      const billDiscount: DiscountSpec | null =
        net > 0 && next() % 2 === 0
          ? next() % 2 === 0
            ? pct(1 + (next() % 10000))
            : fixed(1 + (next() % net))
          : null
      const config: CalcConfig = {
        taxMode: next() % 2 === 0 ? 'INTRA_STATE' : 'INTER_STATE',
        serviceChargeBps: [0, 500, 1000][next() % 3] ?? 0,
        serviceChargeTaxable: next() % 2 === 0,
        roundOffUnit: units[next() % units.length] ?? 1
      }
      const r = calculateBill({ lines, billDiscount, config })

      const sum = (pick: (l: (typeof r.lines)[number]) => number): number =>
        r.lines.reduce((s, l) => s + pick(l), 0)
      expect(sum((l) => l.gross)).toBe(r.subtotal)
      expect(sum((l) => l.itemDiscount)).toBe(r.itemDiscountTotal)
      expect(sum((l) => l.billDiscountShare)).toBe(r.billDiscountTotal)
      expect(sum((l) => l.serviceChargeShare)).toBe(r.serviceCharge)
      expect(r.discountedSubtotal).toBe(r.subtotal - r.itemDiscountTotal - r.billDiscountTotal)
      expect(r.taxes.reduce((s, t) => s + t.taxAmount, 0)).toBe(r.taxTotal)
      expect(r.preRoundTotal).toBe(r.discountedSubtotal + r.serviceCharge + r.taxTotal)
      expect(r.grandTotal).toBe(r.preRoundTotal + r.roundOff)
      expect(r.grandTotal % config.roundOffUnit).toBe(0)
      expect(Math.abs(r.roundOff) * 2).toBeLessThanOrEqual(config.roundOffUnit)
      expect(r.grandTotal).toBeGreaterThanOrEqual(0)
      r.taxes.forEach((t) => {
        expect(t.taxAmount).toBeGreaterThanOrEqual(0)
      })
      for (let k = 0; k + 1 < r.taxes.length; k += 1) {
        const a = r.taxes[k]
        const b = r.taxes[k + 1]
        if (a?.component === 'CGST') {
          expect(b?.component).toBe('SGST')
          expect(b?.taxAmount).toBe(a.taxAmount)
          k += 1
        }
      }
    }
  })
})

describe('allocatePayments', () => {
  it('settles a bill with one cash payment', () => {
    expect(allocatePayments(15000, 0, [{ method: 'CASH', amount: 15000 }])).toEqual({
      paidTotal: 15000,
      balance: 0,
      status: 'PAID',
      changeDue: 0
    })
  })

  it('gives change for cash handed over above the amount', () => {
    const result = allocatePayments(15000, 0, [{ method: 'CASH', amount: 15000, tendered: 20000 }])
    expect(result.status).toBe('PAID')
    expect(result.changeDue).toBe(5000)
  })

  it('splits a bill across methods', () => {
    const result = allocatePayments(150000, 0, [
      { method: 'CASH', amount: 50000 },
      { method: 'UPI', amount: 60000 },
      { method: 'CARD', amount: 30000 },
      { method: 'OTHER', amount: 10000 }
    ])
    expect(result.paidTotal).toBe(150000)
    expect(result.status).toBe('PAID')
    expect(result.changeDue).toBe(0)
  })

  it('gives change on the cash part of a split', () => {
    const result = allocatePayments(150000, 0, [
      { method: 'UPI', amount: 100000 },
      { method: 'CASH', amount: 50000, tendered: 100000 }
    ])
    expect(result.status).toBe('PAID')
    expect(result.changeDue).toBe(50000)
  })

  it('leaves a part payment open', () => {
    expect(allocatePayments(150000, 0, [{ method: 'UPI', amount: 50000 }])).toEqual({
      paidTotal: 50000,
      balance: 100000,
      status: 'PARTIAL',
      changeDue: 0
    })
  })

  it('finishes a part-paid bill', () => {
    const result = allocatePayments(150000, 50000, [{ method: 'CARD', amount: 100000 }])
    expect(result.status).toBe('PAID')
    expect(result.balance).toBe(0)
  })

  it('settles a bill of nothing with no payments, and leaves a real bill pending', () => {
    expect(allocatePayments(0, 0, []).status).toBe('PAID')
    expect(allocatePayments(1000, 0, []).status).toBe('PENDING')
  })

  it('refuses payments that add up to more than is owed', () => {
    expect(() =>
      allocatePayments(10000, 0, [
        { method: 'UPI', amount: 6000 },
        { method: 'CARD', amount: 4001 }
      ])
    ).toThrow(BillCalculationError)
    expect(() => allocatePayments(10000, 9000, [{ method: 'CASH', amount: 1001 }])).toThrow(
      BillCalculationError
    )
  })

  it('refuses over-tendering anything but cash, and under-tendering cash', () => {
    expect(() =>
      allocatePayments(10000, 0, [{ method: 'UPI', amount: 10000, tendered: 20000 }])
    ).toThrow(BillCalculationError)
    expect(() =>
      allocatePayments(10000, 0, [{ method: 'CASH', amount: 10000, tendered: 9000 }])
    ).toThrow(BillCalculationError)
  })

  it('refuses zero, negative and fractional amounts', () => {
    for (const amount of [0, -100, 10.5]) {
      expect(() => allocatePayments(10000, 0, [{ method: 'CASH', amount }])).toThrow(
        BillCalculationError
      )
    }
  })
})

describe('delivery and packaging charges', () => {
  const charges = {
    deliveryCharge: 3000,
    deliveryChargeTaxBps: 500,
    packagingCharge: 1000,
    packagingChargeTaxBps: 1800
  }

  it('changes nothing when there are no charges', () => {
    const without = calculateBill({ lines: [line('a', 10000, 1, 500)], config: PLAIN })
    const zero = calculateBill({
      lines: [line('a', 10000, 1, 500)],
      charges: {
        deliveryCharge: 0,
        deliveryChargeTaxBps: 500,
        packagingCharge: 0,
        packagingChargeTaxBps: 500
      },
      config: PLAIN
    })
    expect(zero).toEqual(without)
    expect(without.deliveryCharge).toBe(0)
    expect(without.packagingCharge).toBe(0)
  })

  it('adds each charge with its own GST, sharing a slab with the food at the same rate', () => {
    const result = calculateBill({
      lines: [line('a', 10000, 1, 500)],
      charges,
      config: PLAIN
    })
    expect(result.deliveryCharge).toBe(3000)
    expect(result.packagingCharge).toBe(1000)
    // 5%: food 100.00 + delivery 30.00; 18%: packaging 10.00.
    expect(result.taxes).toEqual([
      { component: 'CGST', rateBps: 500, taxableAmount: 13000, taxAmount: 325 },
      { component: 'SGST', rateBps: 500, taxableAmount: 13000, taxAmount: 325 },
      { component: 'CGST', rateBps: 1800, taxableAmount: 1000, taxAmount: 90 },
      { component: 'SGST', rateBps: 1800, taxableAmount: 1000, taxAmount: 90 }
    ])
    expect(result.taxTotal).toBe(830)
    expect(result.grandTotal).toBe(10000 + 3000 + 1000 + 830)
  })

  it('uses IGST between states and leaves an untaxed charge untaxed', () => {
    const result = calculateBill({
      lines: [line('a', 10000, 1)],
      charges: { ...charges, packagingChargeTaxBps: 0 },
      config: { ...PLAIN, taxMode: 'INTER_STATE' }
    })
    expect(result.taxes).toEqual([
      { component: 'IGST', rateBps: 500, taxableAmount: 3000, taxAmount: 150 }
    ])
    expect(result.grandTotal).toBe(10000 + 3000 + 1000 + 150)
  })

  it('is neither discounted nor charged a service charge, and rounds with the bill', () => {
    const result = calculateBill({
      lines: [line('a', 10000, 1)],
      billDiscount: pct(1000),
      charges: { ...charges, deliveryChargeTaxBps: 0, packagingChargeTaxBps: 0 },
      config: { ...PLAIN, serviceChargeBps: 1000, roundOffUnit: 100 }
    })
    expect(result.billDiscountTotal).toBe(1000)
    expect(result.serviceCharge).toBe(900) // 10% of 90.00, not of the charges
    expect(result.preRoundTotal).toBe(9000 + 900 + 3000 + 1000)
    expect(result.grandTotal).toBe(13900)
  })

  it('refuses charges that are negative, fractional or out of range', () => {
    const attempt = (extra: Partial<typeof charges>) => () =>
      calculateBill({
        lines: [line('a', 10000, 1)],
        charges: { ...charges, ...extra },
        config: PLAIN
      })
    expect(attempt({ deliveryCharge: -1 })).toThrow(BillCalculationError)
    expect(attempt({ packagingCharge: 10.5 })).toThrow(BillCalculationError)
    expect(attempt({ deliveryChargeTaxBps: 10_001 })).toThrow(BillCalculationError)
    expect(attempt({ packagingCharge: 300_000_001 })).toThrow(BillCalculationError)
  })
})
