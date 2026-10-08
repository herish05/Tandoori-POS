import type {
  CashBook,
  CashBookFilterInput,
  CashEntry,
  CashEntryFilterInput,
  CashSummary,
  RecordCashEntryInput,
  VoidCashEntryInput
} from '@shared/cash'
import type {
  CreateExpenseCategoryInput,
  CreateExpenseInput,
  Expense,
  ExpenseCategory,
  ExpenseCategoryFilterInput,
  ExpenseFilterInput,
  ExpenseSummary,
  ExpenseSummaryFilterInput,
  SetExpenseCategoryActiveInput,
  UpdateExpenseCategoryInput,
  UpdateExpenseInput,
  VoidExpenseInput
} from '@shared/expenses'
import { getApi, unwrap } from '@/lib/ipc'

export const expenseCategoryService = {
  list: (filter: ExpenseCategoryFilterInput = {}): Promise<ExpenseCategory[]> =>
    unwrap(getApi().expenseCategories.list(filter)),
  create: (input: CreateExpenseCategoryInput): Promise<ExpenseCategory> =>
    unwrap(getApi().expenseCategories.create(input)),
  update: (input: UpdateExpenseCategoryInput): Promise<ExpenseCategory> =>
    unwrap(getApi().expenseCategories.update(input)),
  setActive: (input: SetExpenseCategoryActiveInput): Promise<ExpenseCategory> =>
    unwrap(getApi().expenseCategories.setActive(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().expenseCategories.delete(id))
}

export const expenseService = {
  list: (filter: ExpenseFilterInput = {}): Promise<Expense[]> =>
    unwrap(getApi().expenses.list(filter)),
  get: (id: string): Promise<Expense> => unwrap(getApi().expenses.get(id)),
  summary: (filter: ExpenseSummaryFilterInput = {}): Promise<ExpenseSummary> =>
    unwrap(getApi().expenses.summary(filter)),
  create: (input: CreateExpenseInput): Promise<Expense> => unwrap(getApi().expenses.create(input)),
  update: (input: UpdateExpenseInput): Promise<Expense> => unwrap(getApi().expenses.update(input)),
  void: (input: VoidExpenseInput): Promise<Expense> => unwrap(getApi().expenses.void(input))
}

export const cashService = {
  summary: (): Promise<CashSummary> => unwrap(getApi().cash.summary()),
  book: (filter: CashBookFilterInput = {}): Promise<CashBook> => unwrap(getApi().cash.book(filter)),
  listEntries: (filter: CashEntryFilterInput = {}): Promise<CashEntry[]> =>
    unwrap(getApi().cash.listEntries(filter)),
  recordEntry: (input: RecordCashEntryInput): Promise<CashEntry> =>
    unwrap(getApi().cash.recordEntry(input)),
  voidEntry: (input: VoidCashEntryInput): Promise<CashEntry> =>
    unwrap(getApi().cash.voidEntry(input))
}
