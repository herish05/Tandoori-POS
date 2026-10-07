import { z } from 'zod'
import type { OrderStatus, OrderType } from './orders'

/**
 * The customer master: people who order from the restaurant, their saved addresses and what
 * they have ordered. Shared by the renderer (instant feedback) and the main process (the checks).
 */

export const MIN_PHONE_DIGITS = 7
export const MAX_PHONE_DIGITS = 15

/**
 * The form a phone number is stored and compared in: digits only, without an Indian country
 * code (+91) or trunk prefix (0). "+91 98765-43210", "098765 43210" and "9876543210" all match.
 */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits
}

export const ADDRESS_LABELS = ['Home', 'Work', 'Other'] as const

// --- Response shapes -----------------------------------------------------------------------

export interface CustomerAddress {
  id: string
  label: string
  address: string
  landmark: string | null
  isDefault: boolean
}

export interface CustomerSummary {
  id: string
  name: string
  /** Normalised digits (see `normalizePhone`). */
  phone: string
  email: string | null
  notes: string | null
  /** Orders that were not cancelled. */
  orderCount: number
  /** Paise: what the customer has paid on bills. */
  totalSpent: number
  lastOrderAt: string | null
  createdAt: string
}

export interface CustomerOrderRef {
  id: string
  orderNumber: string
  type: OrderType
  status: OrderStatus
  subtotal: number
  createdAt: string
}

export interface CustomerDetail extends CustomerSummary {
  addresses: CustomerAddress[]
  /** The latest orders, newest first. */
  recentOrders: CustomerOrderRef[]
}

/** What the order screen needs to fill in a customer's details. */
export interface CustomerLookupResult {
  id: string
  name: string
  phone: string
  orderCount: number
  lastOrderAt: string | null
  addresses: CustomerAddress[]
}

// --- Validation ----------------------------------------------------------------------------

const idSchema = z.uuid()

const requiredText = (label: string, max: number) =>
  z
    .string(`${label} is required.`)
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${String(max)} characters.`)

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${String(max)} characters.`)
    .nullish()
    .transform((value) => (value === null || value === undefined || value === '' ? null : value))

const phoneSchema = z
  .string('Enter a phone number.')
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{3,20}$/, 'Enter a valid phone number.')
  .transform(normalizePhone)
  .refine(
    (digits) => digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS,
    'Enter a valid phone number.'
  )

const customerFields = {
  name: requiredText('Customer name', 80),
  phone: phoneSchema,
  email: optionalText('Email', 120).refine(
    (value) => value === null || z.email().safeParse(value).success,
    'Enter a valid email address.'
  ),
  notes: optionalText('Notes', 300)
}

export const createCustomerInputSchema = z.object(customerFields)
export const updateCustomerInputSchema = z.object({ id: idSchema, ...customerFields })

const addressFields = {
  label: requiredText('Label', 30).default('Home'),
  address: requiredText('Address', 300),
  landmark: optionalText('Landmark', 100),
  isDefault: z.boolean().default(false)
}

export const addAddressInputSchema = z.object({ customerId: idSchema, ...addressFields })
export const updateAddressInputSchema = z.object({ id: idSchema, ...addressFields })

export const customerFilterSchema = z.object({
  /** Matches the name or the phone number. */
  search: z.string().trim().max(60).optional(),
  limit: z.number().int().min(1).max(500).optional()
})

export const customerLookupInputSchema = z.object({
  query: z.string().trim().min(2, 'Type at least 2 characters.').max(60)
})

export type CreateCustomerInput = z.input<typeof createCustomerInputSchema>
export type UpdateCustomerInput = z.input<typeof updateCustomerInputSchema>
export type AddAddressInput = z.input<typeof addAddressInputSchema>
export type UpdateAddressInput = z.input<typeof updateAddressInputSchema>
export type CustomerFilterInput = z.input<typeof customerFilterSchema>
export type CustomerLookupInput = z.input<typeof customerLookupInputSchema>

export type CreateCustomerData = z.output<typeof createCustomerInputSchema>
export type UpdateCustomerData = z.output<typeof updateCustomerInputSchema>
export type AddAddressData = z.output<typeof addAddressInputSchema>
export type UpdateAddressData = z.output<typeof updateAddressInputSchema>
export type CustomerFilterData = z.output<typeof customerFilterSchema>
export type CustomerLookupData = z.output<typeof customerLookupInputSchema>
