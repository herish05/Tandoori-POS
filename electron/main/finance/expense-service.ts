import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuditAction, AuthContext, Clock } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { expenseCategories, expenses, markModified, users } from '../db/schema'
import { AppError } from '../ipc/errors'
import { nextDocumentNumber } from '../orders/numbering'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import type {
  CreateExpenseCategoryData,
  CreateExpenseData,
  Expense,
  ExpenseCategory,
  ExpenseCategoryFilterData,
  ExpenseFilterData,
  ExpenseSummary,
  ExpenseSummaryFilterData,
  SetExpenseCategoryActiveData,
  UpdateExpenseCategoryData,
  UpdateExpenseData,
  VoidExpenseData
} from '@shared/expenses'
import { endOfLocalDay, isInFuture, monthOf, startOfLocalDay } from './dates'
import type { DayLock } from './day-lock'

type CategoryRow = typeof expenseCategories.$inferSelect
type ExpenseRow = typeof expenses.$inferSelect

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (match) => `\\${match}`)

/**
 * What the restaurant spends besides stock: categories the owner defines, and the expenses filed
 * under them. An expense can be corrected while it stands; a wrong one is voided with a reason
 * and stays on record. Expenses paid in cash show up in the cash book.
 */
export class ExpenseService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly lock: DayLock
  ) {}

  // --- Categories --------------------------------------------------------------------------

  listCategories(filter: ExpenseCategoryFilterData = {}): ExpenseCategory[] {
    const conditions: SQL[] = [isNull(expenseCategories.deletedAt)]
    if (!filter.includeInactive) conditions.push(eq(expenseCategories.isActive, true))
    const rows = this.db
      .select()
      .from(expenseCategories)
      .where(and(...conditions))
      .orderBy(asc(sql`lower(${expenseCategories.name})`))
      .all()
    const counts = this.categoryCounts(this.db)
    return rows.map((row) => this.toCategory(row, counts.get(row.id) ?? 0))
  }

  createCategory(auth: AuthContext, input: CreateExpenseCategoryData): ExpenseCategory {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      this.assertCategoryNameFree(tx, restaurantId, input.name)
      const row = tx
        .insert(expenseCategories)
        .values({ restaurantId, name: input.name, description: input.description })
        .returning()
        .get()
      this.record(tx, auth, 'expense_category.created', 'expense_category', row.id, {
        name: row.name
      })
      return row.id
    })
    return this.loadCategory(this.db, id)
  }

  updateCategory(auth: AuthContext, input: UpdateExpenseCategoryData): ExpenseCategory {
    this.db.transaction((tx) => {
      const current = this.requireCategory(tx, input.id)
      this.assertCategoryNameFree(tx, current.restaurantId, input.name, current.id)
      tx.update(expenseCategories)
        .set({
          name: input.name,
          description: input.description,
          ...markModified(expenseCategories)
        })
        .where(eq(expenseCategories.id, current.id))
        .run()
      this.record(tx, auth, 'expense_category.updated', 'expense_category', current.id, {
        name: input.name,
        previousName: current.name
      })
    })
    return this.loadCategory(this.db, input.id)
  }

  setCategoryActive(auth: AuthContext, input: SetExpenseCategoryActiveData): ExpenseCategory {
    this.db.transaction((tx) => {
      const current = this.requireCategory(tx, input.id)
      if (current.isActive === input.isActive) return
      tx.update(expenseCategories)
        .set({ isActive: input.isActive, ...markModified(expenseCategories) })
        .where(eq(expenseCategories.id, current.id))
        .run()
      this.record(
        tx,
        auth,
        input.isActive ? 'expense_category.activated' : 'expense_category.deactivated',
        'expense_category',
        current.id,
        { name: current.name }
      )
    })
    return this.loadCategory(this.db, input.id)
  }

  deleteCategory(auth: AuthContext, id: string): null {
    this.db.transaction((tx) => {
      const current = this.requireCategory(tx, id)
      const [used] = tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.categoryId, id), isNull(expenses.deletedAt)))
        .limit(1)
        .all()
      if (used) {
        throw new AppError(
          'CONFLICT',
          'Expenses are filed under this category. Deactivate it instead of deleting it.'
        )
      }
      tx.update(expenseCategories)
        .set({ deletedAt: new Date(this.clock()), ...markModified(expenseCategories) })
        .where(eq(expenseCategories.id, id))
        .run()
      this.record(tx, auth, 'expense_category.deleted', 'expense_category', id, {
        name: current.name
      })
    })
    return null
  }

  // --- Expenses: reads ---------------------------------------------------------------------

  list(filter: ExpenseFilterData = {}): Expense[] {
    const conditions: SQL[] = [isNull(expenses.deletedAt)]
    if (!filter.includeVoided) conditions.push(isNull(expenses.voidedAt))
    if (filter.categoryId) conditions.push(eq(expenses.categoryId, filter.categoryId))
    if (filter.method) conditions.push(eq(expenses.method, filter.method))
    if (filter.from) conditions.push(gte(expenses.spentAt, startOfLocalDay(filter.from)))
    if (filter.to) conditions.push(lt(expenses.spentAt, endOfLocalDay(filter.to)))
    if (filter.search) {
      const like = `%${escapeLike(filter.search)}%`
      const match = or(
        sql`${expenses.expenseNumber} like ${like} escape '\\'`,
        sql`${expenses.payee} like ${like} escape '\\'`,
        sql`${expenses.reference} like ${like} escape '\\'`,
        sql`${expenses.notes} like ${like} escape '\\'`,
        sql`${expenseCategories.name} like ${like} escape '\\'`
      )
      if (match) conditions.push(match)
    }
    const rows = this.db
      .select({ expense: expenses, categoryName: expenseCategories.name })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(and(...conditions))
      .orderBy(desc(expenses.spentAt), desc(expenses.createdAt))
      .limit(filter.limit ?? 500)
      .all()
    const names = this.userNames(
      this.db,
      rows.flatMap((row) => [row.expense.recordedBy, row.expense.voidedBy])
    )
    return rows.map((row) => this.toExpense(row.expense, row.categoryName, names))
  }

  get(id: string): Expense {
    return this.load(this.db, id)
  }

  /** Totals for a range of days (the current month by default), voided expenses left out. */
  summary(filter: ExpenseSummaryFilterData = {}): ExpenseSummary {
    const month = monthOf(this.clock())
    const from = filter.from ?? month.from
    const to = filter.to ?? month.to
    const inRange = and(
      isNull(expenses.deletedAt),
      isNull(expenses.voidedAt),
      gte(expenses.spentAt, startOfLocalDay(from)),
      lt(expenses.spentAt, endOfLocalDay(to))
    )
    const byCategory = this.db
      .select({
        categoryId: expenses.categoryId,
        name: expenseCategories.name,
        total: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
        count: sql<number>`count(*)`
      })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(inRange)
      .groupBy(expenses.categoryId, expenseCategories.name)
      .orderBy(desc(sql`sum(${expenses.amount})`))
      .all()
    const byMethod = this.db
      .select({
        method: expenses.method,
        total: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
        count: sql<number>`count(*)`
      })
      .from(expenses)
      .where(inRange)
      .groupBy(expenses.method)
      .orderBy(desc(sql`sum(${expenses.amount})`))
      .all()
    return {
      from,
      to,
      total: byCategory.reduce((sum, row) => sum + row.total, 0),
      count: byCategory.reduce((sum, row) => sum + row.count, 0),
      byCategory,
      byMethod
    }
  }

  // --- Expenses: changes -------------------------------------------------------------------

  create(auth: AuthContext, input: CreateExpenseData): Expense {
    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      const category = this.requireCategory(tx, input.categoryId)
      if (!category.isActive) {
        throw new AppError('VALIDATION_ERROR', 'That expense category is deactivated.')
      }
      const spentAt = this.spentAt(input.spentAt)
      this.lock.assertOpen(tx, 'record an expense', spentAt)
      const row = tx
        .insert(expenses)
        .values({
          restaurantId,
          expenseNumber: nextDocumentNumber(tx, restaurantId, 'EXP'),
          categoryId: category.id,
          amount: input.amount,
          method: input.method,
          payee: input.payee,
          reference: input.reference,
          notes: input.notes,
          spentAt,
          recordedBy: auth.userId
        })
        .returning()
        .get()
      this.record(tx, auth, 'expense.recorded', 'expense', row.id, {
        expenseNumber: row.expenseNumber,
        category: category.name,
        amount: row.amount,
        method: row.method
      })
      return row.id
    })
    return this.get(id)
  }

  update(auth: AuthContext, input: UpdateExpenseData): Expense {
    this.db.transaction((tx) => {
      const current = this.requireExpense(tx, input.id)
      if (current.voidedAt) throw new AppError('CONFLICT', 'A voided expense cannot be changed.')
      const category = this.requireCategory(tx, input.categoryId)
      if (!category.isActive && category.id !== current.categoryId) {
        throw new AppError('VALIDATION_ERROR', 'That expense category is deactivated.')
      }
      const spentAt = input.spentAt ? this.spentAt(input.spentAt) : current.spentAt
      this.lock.assertOpen(tx, 'change an expense', current.spentAt)
      this.lock.assertOpen(tx, 'move an expense into it', spentAt)
      tx.update(expenses)
        .set({
          categoryId: category.id,
          amount: input.amount,
          method: input.method,
          payee: input.payee,
          reference: input.reference,
          notes: input.notes,
          spentAt,
          ...markModified(expenses)
        })
        .where(eq(expenses.id, current.id))
        .run()
      this.record(tx, auth, 'expense.updated', 'expense', current.id, {
        expenseNumber: current.expenseNumber,
        amount: input.amount,
        previousAmount: current.amount,
        method: input.method,
        previousMethod: current.method
      })
    })
    return this.get(input.id)
  }

  voidExpense(auth: AuthContext, input: VoidExpenseData): Expense {
    this.db.transaction((tx) => {
      const current = this.requireExpense(tx, input.id)
      if (current.voidedAt) throw new AppError('CONFLICT', 'That expense is already voided.')
      this.lock.assertOpen(tx, 'void an expense', current.spentAt)
      tx.update(expenses)
        .set({
          voidedAt: new Date(this.clock()),
          voidedBy: auth.userId,
          voidReason: input.reason,
          ...markModified(expenses)
        })
        .where(eq(expenses.id, current.id))
        .run()
      this.record(tx, auth, 'expense.voided', 'expense', current.id, {
        expenseNumber: current.expenseNumber,
        amount: current.amount,
        reason: input.reason
      })
    })
    return this.get(input.id)
  }

  // --- Internals ---------------------------------------------------------------------------

  /** Resolves the time an expense was spent, and refuses a time that has not come yet. */
  private spentAt(value: string | undefined): Date {
    const now = this.clock()
    const at = value ? new Date(value) : new Date(now)
    if (isInFuture(at, now)) {
      throw new AppError('VALIDATION_ERROR', 'An expense cannot be dated in the future.')
    }
    return at
  }

  private categoryCounts(db: DbExecutor): Map<string, number> {
    const rows = db
      .select({ categoryId: expenses.categoryId, count: sql<number>`count(*)` })
      .from(expenses)
      .where(isNull(expenses.deletedAt))
      .groupBy(expenses.categoryId)
      .all()
    return new Map(rows.map((row) => [row.categoryId, row.count]))
  }

  private loadCategory(db: DbExecutor, id: string): ExpenseCategory {
    const row = this.requireCategory(db, id)
    return this.toCategory(row, this.categoryCounts(db).get(id) ?? 0)
  }

  private load(db: DbExecutor, id: string): Expense {
    const row = this.requireExpense(db, id)
    const category = this.requireCategory(db, row.categoryId)
    const names = this.userNames(db, [row.recordedBy, row.voidedBy])
    return this.toExpense(row, category.name, names)
  }

  private userNames(db: DbExecutor, ids: readonly (string | null)[]): Map<string, string> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))]
    if (unique.length === 0) return new Map()
    return new Map(
      db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.id, unique))
        .all()
        .map((user) => [user.id, user.fullName] as const)
    )
  }

  private toCategory(row: CategoryRow, expenseCount: number): ExpenseCategory {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isActive: row.isActive,
      expenseCount
    }
  }

  private toExpense(row: ExpenseRow, categoryName: string, names: Map<string, string>): Expense {
    return {
      id: row.id,
      expenseNumber: row.expenseNumber,
      categoryId: row.categoryId,
      categoryName,
      amount: row.amount,
      method: row.method,
      payee: row.payee,
      reference: row.reference,
      notes: row.notes,
      spentAt: row.spentAt.toISOString(),
      recordedBy: names.get(row.recordedBy) ?? null,
      createdAt: row.createdAt.toISOString(),
      voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
      voidedBy: row.voidedBy ? (names.get(row.voidedBy) ?? null) : null,
      voidReason: row.voidReason
    }
  }

  private requireCategory(db: DbExecutor, id: string): CategoryRow {
    const [row] = db
      .select()
      .from(expenseCategories)
      .where(and(eq(expenseCategories.id, id), isNull(expenseCategories.deletedAt)))
      .all()
    if (!row) throw new AppError('NOT_FOUND', 'That expense category no longer exists.')
    return row
  }

  private requireExpense(db: DbExecutor, id: string): ExpenseRow {
    const [row] = db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), isNull(expenses.deletedAt)))
      .all()
    if (!row) throw new AppError('NOT_FOUND', 'That expense no longer exists.')
    return row
  }

  private assertCategoryNameFree(
    db: DbExecutor,
    restaurantId: string,
    name: string,
    exceptId?: string
  ): void {
    const clash = db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(
        and(
          eq(expenseCategories.restaurantId, restaurantId),
          isNull(expenseCategories.deletedAt),
          sql`lower(${expenseCategories.name}) = lower(${name})`
        )
      )
      .all()
      .find((row) => row.id !== exceptId)
    if (clash) throw new AppError('CONFLICT', 'There is already a category with that name.')
  }

  private record(
    tx: DbExecutor,
    auth: AuthContext,
    action: AuditAction,
    entityType: 'expense' | 'expense_category',
    entityId: string,
    details: Record<string, unknown>
  ): void {
    this.audit.record(
      {
        action,
        userId: auth.userId,
        username: auth.username,
        entityType,
        entityId,
        details
      },
      tx
    )
  }
}
