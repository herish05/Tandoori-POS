import { IPC_CHANNELS } from '@shared/ipc-channels'
import { idInputSchema } from '@shared/auth-schemas'
import {
  cashBookFilterSchema,
  cashEntryFilterSchema,
  recordCashEntryInputSchema,
  voidCashEntryInputSchema
} from '@shared/cash'
import {
  closeDayInputSchema,
  dayClosingFilterSchema,
  dayStatusInputSchema,
  reopenDayInputSchema
} from '@shared/day-closing'
import {
  createExpenseCategoryInputSchema,
  createExpenseInputSchema,
  expenseCategoryFilterSchema,
  expenseFilterSchema,
  expenseSummaryFilterSchema,
  setExpenseCategoryActiveInputSchema,
  updateExpenseCategoryInputSchema,
  updateExpenseInputSchema,
  voidExpenseInputSchema
} from '@shared/expenses'
import { emptyInputSchema } from '@shared/schemas'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

const EXPENSES_VIEW = { permissions: ['expenses.view'] } as const
const EXPENSES_OPERATE = { permissions: ['expenses.operate'] } as const
const EXPENSES_MANAGE = { permissions: ['expenses.manage'] } as const
const CASH_VIEW = { permissions: ['cash.view'] } as const
const CASH_MANAGE = { permissions: ['cash.manage'] } as const
const DAY_VIEW = { permissions: ['day.view'] } as const
const DAY_CLOSE = { permissions: ['day.close'] } as const
const DAY_REOPEN = { permissions: ['day.reopen'] } as const

/** Expense, cash drawer and day closing handlers. */
export function registerFinanceHandlers(registrar: IpcRegistrar, services: Services): void {
  const { expenses, cash, dayClosing } = services

  registrar.handleProtected(
    IPC_CHANNELS.expenseCategoriesList,
    expenseCategoryFilterSchema,
    EXPENSES_VIEW,
    (input) => expenses.listCategories(input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.expenseCategoriesCreate,
    createExpenseCategoryInputSchema,
    EXPENSES_MANAGE,
    (input, ctx) => expenses.createCategory(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.expenseCategoriesUpdate,
    updateExpenseCategoryInputSchema,
    EXPENSES_MANAGE,
    (input, ctx) => expenses.updateCategory(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.expenseCategoriesSetActive,
    setExpenseCategoryActiveInputSchema,
    EXPENSES_MANAGE,
    (input, ctx) => expenses.setCategoryActive(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.expenseCategoriesDelete,
    idInputSchema,
    EXPENSES_MANAGE,
    (input, ctx) => expenses.deleteCategory(ctx, input.id)
  )

  registrar.handleProtected(
    IPC_CHANNELS.expensesList,
    expenseFilterSchema,
    EXPENSES_VIEW,
    (input) => expenses.list(input)
  )
  registrar.handleProtected(IPC_CHANNELS.expensesGet, idInputSchema, EXPENSES_VIEW, (input) =>
    expenses.get(input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.expensesSummary,
    expenseSummaryFilterSchema,
    EXPENSES_VIEW,
    (input) => expenses.summary(input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.expensesCreate,
    createExpenseInputSchema,
    EXPENSES_OPERATE,
    (input, ctx) => expenses.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.expensesUpdate,
    updateExpenseInputSchema,
    EXPENSES_OPERATE,
    (input, ctx) => expenses.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.expensesVoid,
    voidExpenseInputSchema,
    EXPENSES_OPERATE,
    (input, ctx) => expenses.voidExpense(ctx, input)
  )

  registrar.handleProtected(IPC_CHANNELS.cashSummary, emptyInputSchema, CASH_VIEW, () =>
    cash.summary()
  )
  registrar.handleProtected(IPC_CHANNELS.cashBook, cashBookFilterSchema, CASH_VIEW, (input) =>
    cash.book(input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.cashEntriesList,
    cashEntryFilterSchema,
    CASH_VIEW,
    (input) => cash.listEntries(input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.cashRecordEntry,
    recordCashEntryInputSchema,
    CASH_MANAGE,
    (input, ctx) => cash.recordEntry(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.cashVoidEntry,
    voidCashEntryInputSchema,
    CASH_MANAGE,
    (input, ctx) => cash.voidEntry(ctx, input)
  )

  registrar.handleProtected(IPC_CHANNELS.dayOverview, emptyInputSchema, DAY_VIEW, () =>
    dayClosing.overview()
  )
  registrar.handleProtected(IPC_CHANNELS.dayStatus, dayStatusInputSchema, DAY_VIEW, (input) =>
    dayClosing.status(input)
  )
  registrar.handleProtected(IPC_CHANNELS.dayList, dayClosingFilterSchema, DAY_VIEW, (input) =>
    dayClosing.list(input)
  )
  registrar.handleProtected(IPC_CHANNELS.dayGet, idInputSchema, DAY_VIEW, (input) =>
    dayClosing.get(input.id)
  )
  registrar.handleProtected(IPC_CHANNELS.dayClose, closeDayInputSchema, DAY_CLOSE, (input, ctx) =>
    dayClosing.close(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.dayReopen,
    reopenDayInputSchema,
    DAY_REOPEN,
    (input, ctx) => dayClosing.reopen(ctx, input)
  )
}
