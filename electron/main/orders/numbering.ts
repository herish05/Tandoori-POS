import { and, eq, sql } from 'drizzle-orm'
import type { DbExecutor } from '../db/client'
import { documentSequences, restaurants } from '../db/schema'

/** Document kinds numbered by the sequence table.  */
export type DocumentKind = 'ORD' | 'KOT' | 'BILL' | 'REF'

const FALLBACK_PREFIX = 'POS'
const MAX_PREFIX_LENGTH = 4

/**
 * Short code for a restaurant name: the first letter of each word ("Tandoori Bites" -> "TB"),
 * or the first two letters of a single-word name.
 */
export function derivePrefix(name: string): string {
  const words = name.toUpperCase().match(/[\p{L}\p{N}]+/gu) ?? []
  if (words.length === 0) return FALLBACK_PREFIX
  if (words.length === 1) return words[0].slice(0, 2)
  return words
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, MAX_PREFIX_LENGTH)
}

export function formatDocumentNumber(prefix: string, kind: DocumentKind, value: number): string {
  return `${prefix}-${kind}-${String(value).padStart(6, '0')}`
}

/**
 * Takes the next number for a document kind, e.g. TB-ORD-000001. Must be called inside the
 * transaction that stores the document: the counter moves with it, so a rolled-back order never
 * burns a number and two orders can never share one.
 */
export function nextDocumentNumber(
  tx: DbExecutor,
  restaurantId: string,
  kind: DocumentKind
): string {
  const existing = tx
    .select({ prefix: documentSequences.prefix })
    .from(documentSequences)
    .where(and(eq(documentSequences.restaurantId, restaurantId), eq(documentSequences.kind, kind)))
    .get()

  if (!existing) {
    const restaurant = tx
      .select({ name: restaurants.name })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .get()
    tx.insert(documentSequences)
      .values({
        restaurantId,
        kind,
        prefix: derivePrefix(restaurant?.name ?? ''),
        lastNumber: 0
      })
      .onConflictDoNothing()
      .run()
  }

  const row = tx
    .update(documentSequences)
    .set({ lastNumber: sql`${documentSequences.lastNumber} + 1` })
    .where(and(eq(documentSequences.restaurantId, restaurantId), eq(documentSequences.kind, kind)))
    .returning({ prefix: documentSequences.prefix, lastNumber: documentSequences.lastNumber })
    .get()
  return formatDocumentNumber(row.prefix, kind, row.lastNumber)
}
