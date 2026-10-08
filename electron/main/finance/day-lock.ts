import { and, eq, isNull } from 'drizzle-orm'
import type { Clock } from '../auth/types'
import type { DbExecutor } from '../db/client'
import { dayClosings } from '../db/schema'
import { AppError } from '../ipc/errors'
import { describeDate, localDateString } from './dates'

/**
 * Keeps closed days closed. A day that stands closed (see the day closing service) accepts no new
 * money records dated inside it. Services that record or void money call `assertOpen` with the
 * moment the record belongs to; it refuses when that moment falls on a closed day.
 */
export class DayLock {
  constructor(private readonly clock: Clock) {}

  /** Whether the day stands closed. */
  isClosed(db: DbExecutor, date: string): boolean {
    const [row] = db
      .select({ id: dayClosings.id })
      .from(dayClosings)
      .where(
        and(
          eq(dayClosings.businessDate, date),
          isNull(dayClosings.reopenedAt),
          isNull(dayClosings.deletedAt)
        )
      )
      .limit(1)
      .all()
    return row !== undefined
  }

  /** Throws unless the day of `at` (now if left out) is open. `doing` finishes "to ...". */
  assertOpen(db: DbExecutor, doing: string, at: Date | number = this.clock()): void {
    const date = localDateString(at)
    if (this.isClosed(db, date)) {
      const today = localDateString(this.clock())
      const name = date === today ? `Today (${describeDate(date)})` : describeDate(date)
      throw new AppError('CONFLICT', `${name} is closed. Ask a manager to reopen it to ${doing}.`)
    }
  }
}
