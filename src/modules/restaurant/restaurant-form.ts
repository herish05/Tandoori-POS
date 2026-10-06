import type { RestaurantInput } from '@shared/auth-schemas'
import type { RestaurantProfile } from '@shared/domain'

/** Editable restaurant fields as plain strings (blank = not provided). */
export interface RestaurantFormValues {
  name: string
  legalName: string
  address: string
  city: string
  state: string
  country: string
  phone: string
  email: string
  gstin: string
  receiptFooter: string
  logo: string | null
}

export const EMPTY_RESTAURANT: RestaurantFormValues = {
  name: '',
  legalName: '',
  address: '',
  city: '',
  state: '',
  country: 'India',
  phone: '',
  email: '',
  gstin: '',
  receiptFooter: '',
  logo: null
}

export function toFormValues(profile: RestaurantProfile): RestaurantFormValues {
  return {
    name: profile.name,
    legalName: profile.legalName ?? '',
    address: profile.address,
    city: profile.city,
    state: profile.state,
    country: profile.country,
    phone: profile.phone,
    email: profile.email ?? '',
    gstin: profile.gstin ?? '',
    receiptFooter: profile.receiptFooter ?? '',
    logo: profile.logo
  }
}

/** Currency and time zone are fixed for this product (INR, Asia/Kolkata). */
export function toRestaurantInput(values: RestaurantFormValues): RestaurantInput {
  return { ...values, currency: 'INR', timezone: 'Asia/Kolkata' }
}
