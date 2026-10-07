import type { BillTaxLine, DiscountType, RoundOffUnit, TaxMode } from '@shared/billing'

/*
 * The billing calculator. Pure arithmetic over whole paise: no database, no clock, no UI, no
 * floating point. Every division rounds half up and every split (a discount or service charge
 * shared over the lines) is made exactly, so the parts always add up to the whole.
 *
 * Order of work:
 *   gross (unit price x quantity)
 *   - item discounts
 *   - bill discount (shared over the lines in proportion to their value)
 *   + service charge (on what is left; shared over the lines the same way)
 *   + GST per tax rate: CGST + SGST, or IGST
 *   +/- round off to the unit set in the billing settings
 *   = grand total
 */

/** Largest unit price accepted (an item and 20 add-ons at the menu's price limit), in paise. */
export const MAX_UNIT_PRICE = 300_000_000
export const MAX_QUANTITY = 99
export const MAX_CALC_LINES = 100

export class BillCalculationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BillCalculationError'
  }
}

export interface DiscountSpec {
  type: DiscountType
  /** Basis points for a percentage (1-10000), paise for a fixed amount. */
  value: number
}

export interface CalcLineInput {
  id: string
  /** Paise per unit, add-ons included. */
  unitPrice: number
  quantity: number
  /** The GST rate of the line in basis points; 0 when the item is not taxed. */
  taxRateBps: number
  discount?: DiscountSpec | null
}

export interface CalcConfig {
  taxMode: TaxMode
  /** Already limited to the orders it applies to: 0 means no service charge on this bill. */
  serviceChargeBps: number
  serviceChargeTaxable: boolean
  roundOffUnit: RoundOffUnit
}

export interface CalcInput {
  lines: readonly CalcLineInput[]
  billDiscount?: DiscountSpec | null
  config: CalcConfig
}

export interface CalcLineResult {
  id: string
  gross: number
  itemDiscount: number
  billDiscountShare: number
  serviceChargeShare: number
  /** What GST is worked out on. */
  taxableValue: number
}

export interface BillCalculation {
  lines: CalcLineResult[]
  subtotal: number
  itemDiscountTotal: number
  billDiscountTotal: number
  discountedSubtotal: number
  serviceCharge: number
  taxes: BillTaxLine[]
  taxTotal: number
  /** Total before rounding. */
  preRoundTotal: number
  roundOff: number
  grandTotal: number
}

// --- Integer helpers ---------------------------------------------------------------------

function assertWhole(value: number, what: string): void {
  if (!Number.isSafeInteger(value))
    throw new BillCalculationError(`${what} must be a whole number.`)
}

/** numerator / denominator rounded half up, for a non-negative numerator and positive denominator. */
export function roundDiv(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator))
}

/** amount x numerator / denominator, rounded half up. The product is exact whatever its size. */
export function mulDivRound(amount: number, numerator: number, denominator: number): number {
  const divisor = BigInt(denominator)
  return Number((BigInt(amount) * BigInt(numerator) * 2n + divisor) / (divisor * 2n))
}

/** A percentage of an amount: the basis points taken, rounded half up to a whole paisa. */
export function percentOf(amount: number, bps: number): number {
  return mulDivRound(amount, bps, 10_000)
}

/** Rounds an amount to the nearest multiple of the unit (halves go up). */
export function roundToUnit(amount: number, unit: number): number {
  return roundDiv(amount, unit) * unit
}

/**
 * Splits `total` over the weights in proportion, in whole paise, so the shares add up to exactly
 * `total`. The leftover paise go to the largest remainders (earliest line first on a tie).
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const result = weights.map(() => 0)
  if (total === 0) return result
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  if (weightSum <= 0) throw new BillCalculationError('There is nothing to share the amount over.')

  // BigInt keeps total x weight exact whatever the size of the bill.
  const bigTotal = BigInt(total)
  const bigSum = BigInt(weightSum)
  const remainders: { index: number; remainder: bigint }[] = []
  let given = 0
  weights.forEach((weight, index) => {
    const product = bigTotal * BigInt(weight)
    const share = Number(product / bigSum)
    result[index] = share
    given += share
    remainders.push({ index, remainder: product % bigSum })
  })
  let left = total - given
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
  )
  for (const { index } of remainders) {
    if (left === 0) break
    result[index] = (result[index] ?? 0) + 1
    left -= 1
  }
  return result
}

/** What a discount takes off an amount. A fixed discount larger than the amount is refused. */
export function discountAmount(base: number, discount: DiscountSpec, what: string): number {
  assertWhole(discount.value, `The ${what} discount`)
  if (discount.value < 1) throw new BillCalculationError(`The ${what} discount must be positive.`)
  if (discount.type === 'PERCENTAGE') {
    if (discount.value > 10_000) {
      throw new BillCalculationError(`The ${what} discount cannot be more than 100%.`)
    }
    return percentOf(base, discount.value)
  }
  if (discount.value > base) {
    throw new BillCalculationError(`The ${what} discount is more than the amount it applies to.`)
  }
  return discount.value
}

// --- The calculation ---------------------------------------------------------------------

function validate(input: CalcInput): void {
  if (input.lines.length > MAX_CALC_LINES) {
    throw new BillCalculationError(`A bill can have at most ${MAX_CALC_LINES} items.`)
  }
  for (const line of input.lines) {
    assertWhole(line.unitPrice, 'A price')
    assertWhole(line.quantity, 'A quantity')
    assertWhole(line.taxRateBps, 'A tax rate')
    if (line.unitPrice < 0 || line.unitPrice > MAX_UNIT_PRICE) {
      throw new BillCalculationError('A price is out of range.')
    }
    if (line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      throw new BillCalculationError('A quantity is out of range.')
    }
    if (line.taxRateBps < 0 || line.taxRateBps > 10_000) {
      throw new BillCalculationError('A tax rate is out of range.')
    }
  }
  const { serviceChargeBps, roundOffUnit } = input.config
  assertWhole(serviceChargeBps, 'The service charge')
  if (serviceChargeBps < 0 || serviceChargeBps > 10_000) {
    throw new BillCalculationError('The service charge is out of range.')
  }
  if (![1, 10, 50, 100].includes(roundOffUnit)) {
    throw new BillCalculationError('The round-off unit is not supported.')
  }
}

export function calculateBill(input: CalcInput): BillCalculation {
  validate(input)
  const { config } = input

  // 1. Gross and item discounts.
  const grossLines = input.lines.map((line) => {
    const gross = line.unitPrice * line.quantity
    const itemDiscount = line.discount ? discountAmount(gross, line.discount, 'item') : 0
    return { line, gross, itemDiscount, net: gross - itemDiscount }
  })
  const subtotal = grossLines.reduce((sum, row) => sum + row.gross, 0)
  const itemDiscountTotal = grossLines.reduce((sum, row) => sum + row.itemDiscount, 0)
  const netSubtotal = subtotal - itemDiscountTotal

  // 2. Bill discount, shared over the lines by their net value.
  const billDiscountTotal = input.billDiscount
    ? discountAmount(netSubtotal, input.billDiscount, 'bill')
    : 0
  const discountShares = allocate(
    billDiscountTotal,
    grossLines.map((row) => row.net)
  )
  const afterDiscount = grossLines.map((row, index) => row.net - (discountShares[index] ?? 0))
  const discountedSubtotal = netSubtotal - billDiscountTotal

  // 3. Service charge on what is left, shared over the lines the same way.
  const serviceCharge =
    config.serviceChargeBps > 0 ? percentOf(discountedSubtotal, config.serviceChargeBps) : 0
  const chargeShares = allocate(serviceCharge, afterDiscount)

  // 4. GST per rate.
  const lines: CalcLineResult[] = grossLines.map((row, index) => {
    const chargeShare = chargeShares[index] ?? 0
    return {
      id: row.line.id,
      gross: row.gross,
      itemDiscount: row.itemDiscount,
      billDiscountShare: discountShares[index] ?? 0,
      serviceChargeShare: chargeShare,
      taxableValue: (afterDiscount[index] ?? 0) + (config.serviceChargeTaxable ? chargeShare : 0)
    }
  })
  const slabs = new Map<number, number>()
  grossLines.forEach((row, index) => {
    const rate = row.line.taxRateBps
    if (rate === 0) return
    slabs.set(rate, (slabs.get(rate) ?? 0) + (lines[index]?.taxableValue ?? 0))
  })
  const taxes: BillTaxLine[] = []
  for (const rate of [...slabs.keys()].sort((a, b) => a - b)) {
    const taxableAmount = slabs.get(rate) ?? 0
    if (taxableAmount === 0) continue
    if (config.taxMode === 'INTRA_STATE') {
      // Both halves are worked out the same way so CGST always equals SGST.
      const half = mulDivRound(taxableAmount, rate, 20_000)
      taxes.push({ component: 'CGST', rateBps: rate, taxableAmount, taxAmount: half })
      taxes.push({ component: 'SGST', rateBps: rate, taxableAmount, taxAmount: half })
    } else {
      taxes.push({
        component: 'IGST',
        rateBps: rate,
        taxableAmount,
        taxAmount: percentOf(taxableAmount, rate)
      })
    }
  }
  const taxTotal = taxes.reduce((sum, tax) => sum + tax.taxAmount, 0)

  // 5. Round off and total.
  const preRoundTotal = discountedSubtotal + serviceCharge + taxTotal
  const grandTotal = roundToUnit(preRoundTotal, config.roundOffUnit)

  return {
    lines,
    subtotal,
    itemDiscountTotal,
    billDiscountTotal,
    discountedSubtotal,
    serviceCharge,
    taxes,
    taxTotal,
    preRoundTotal,
    roundOff: grandTotal - preRoundTotal,
    grandTotal
  }
}

// --- Payments ----------------------------------------------------------------------------

export interface PaymentRequest {
  method: string
  /** Paise that go against the bill. */
  amount: number
  /** Cash handed over; defaults to the amount. */
  tendered?: number | null
}

export interface PaymentAllocation {
  /** Paise now paid on the bill, earlier payments included. */
  paidTotal: number
  balance: number
  status: 'PENDING' | 'PARTIAL' | 'PAID'
  /** Change owed for the cash handed over, over all the new payments. */
  changeDue: number
}

/**
 * Applies new payments to a bill: any mix of methods, each for part of the balance. Only cash
 * may be handed over for more than its amount (the difference is change); the amounts themselves
 * may never add up to more than what is still owed.
 */
export function allocatePayments(
  grandTotal: number,
  alreadyPaid: number,
  requests: readonly PaymentRequest[]
): PaymentAllocation {
  assertWhole(grandTotal, 'The total')
  assertWhole(alreadyPaid, 'The amount paid')
  const balance = grandTotal - alreadyPaid
  if (balance < 0) throw new BillCalculationError('The bill is already overpaid.')

  let applied = 0
  let changeDue = 0
  for (const request of requests) {
    assertWhole(request.amount, 'A payment')
    if (request.amount < 1) throw new BillCalculationError('A payment must be more than zero.')
    const tendered = request.tendered ?? request.amount
    assertWhole(tendered, 'The cash handed over')
    if (tendered < request.amount) {
      throw new BillCalculationError('The cash handed over is less than the amount.')
    }
    if (tendered > request.amount) {
      if (request.method !== 'CASH') {
        throw new BillCalculationError('Only cash can be handed over for more than the amount.')
      }
      changeDue += tendered - request.amount
    }
    applied += request.amount
  }
  if (applied > balance) {
    throw new BillCalculationError('The payments add up to more than is owed on the bill.')
  }
  const paidTotal = alreadyPaid + applied
  return {
    paidTotal,
    balance: grandTotal - paidTotal,
    status: paidTotal >= grandTotal ? 'PAID' : paidTotal > 0 ? 'PARTIAL' : 'PENDING',
    changeDue
  }
}
