import { and, eq, isNull } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { DbExecutor } from '../db/client'
import { customerAddresses, customers } from '../db/schema'
import { MAX_PHONE_DIGITS, MIN_PHONE_DIGITS, normalizePhone } from '@shared/customers'

export interface CustomerContact {
  name: string | null
  phone: string | null
  address: string | null
}

const sameText = (a: string, b: string): boolean =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Finds the customer behind a phone number, or records them on the spot; and remembers a
 * delivery address the first time it is used. The customer master therefore builds itself from
 * the orders and bookings staff already take. Returns null when there is no usable phone number.
 *
 * Runs inside the caller's transaction, so a failed order never leaves a stray customer behind.
 */
export function linkCustomer(
  tx: DbExecutor,
  audit: AuditService,
  auth: AuthContext,
  restaurantId: string,
  contact: CustomerContact,
  source: 'order' | 'reservation'
): string | null {
  if (!contact.phone) return null
  const phone = normalizePhone(contact.phone)
  if (phone.length < MIN_PHONE_DIGITS || phone.length > MAX_PHONE_DIGITS) return null

  let customer = tx
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.restaurantId, restaurantId),
        eq(customers.phone, phone),
        isNull(customers.deletedAt)
      )
    )
    .get()

  if (!customer) {
    const name = contact.name ?? `Customer ${phone}`
    customer = tx
      .insert(customers)
      .values({ restaurantId, name, phone })
      .returning({ id: customers.id })
      .get()
    audit.record(
      {
        action: 'customer.created',
        userId: auth.userId,
        username: auth.username,
        entityType: 'customer',
        entityId: customer.id,
        details: { source, phone }
      },
      tx
    )
  }

  if (contact.address) rememberAddress(tx, audit, auth, customer.id, contact.address)
  return customer.id
}

function rememberAddress(
  tx: DbExecutor,
  audit: AuditService,
  auth: AuthContext,
  customerId: string,
  address: string
): void {
  const saved = tx
    .select({ address: customerAddresses.address })
    .from(customerAddresses)
    .where(and(eq(customerAddresses.customerId, customerId), isNull(customerAddresses.deletedAt)))
    .all()
  if (saved.some((row) => sameText(row.address, address))) return

  const first = saved.length === 0
  const row = tx
    .insert(customerAddresses)
    .values({ customerId, label: first ? 'Home' : 'Other', address, isDefault: first })
    .returning({ id: customerAddresses.id })
    .get()
  audit.record(
    {
      action: 'customer.address_added',
      userId: auth.userId,
      username: auth.username,
      entityType: 'customer',
      entityId: customerId,
      details: { addressId: row.id, source: 'order' }
    },
    tx
  )
}
