import type { OrderDetail, OrderType } from '@shared/orders'

export interface DetailsValues {
  guests: string
  customerName: string
  customerPhone: string
  deliveryAddress: string
  notes: string
  /** ISO time the customer was promised, or '' for none. */
  promisedAt: string
}

export const EMPTY_DETAILS: DetailsValues = {
  guests: '',
  customerName: '',
  customerPhone: '',
  deliveryAddress: '',
  notes: '',
  promisedAt: ''
}

export function detailsFromOrder(order: OrderDetail): DetailsValues {
  return {
    guests: order.guestCount === null ? '' : String(order.guestCount),
    customerName: order.customerName ?? '',
    customerPhone: order.customerPhone ?? '',
    deliveryAddress: order.deliveryAddress ?? '',
    notes: order.notes ?? '',
    promisedAt: order.promisedAt ?? ''
  }
}

/** The header fields of an order in the shape the server expects (blank means "not given"). */
export function detailsToInput(type: OrderType, values: DetailsValues) {
  const guests = values.guests.trim()
  return {
    guestCount: type === 'DINE_IN' && guests !== '' ? Number(guests) : null,
    customerName: values.customerName,
    customerPhone: values.customerPhone,
    deliveryAddress: type === 'DELIVERY' ? values.deliveryAddress : '',
    notes: values.notes,
    promisedAt: type === 'DINE_IN' ? '' : values.promisedAt
  }
}
