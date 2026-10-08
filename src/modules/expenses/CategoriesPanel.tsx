import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toUserMessage } from '@/lib/ipc'
import { expenseCategoryService } from '@/services/expenses.service'
import type { ExpenseCategory } from '@shared/expenses'
import { CategoryFormDialog } from './CategoryFormDialog'
import { EXPENSE_KEYS, useRefreshExpenses } from './hooks'

/** The expense categories: add, rename, switch off and delete. */
export function CategoriesPanel() {
  const refresh = useRefreshExpenses()
  const [form, setForm] = useState<'closed' | 'new' | ExpenseCategory>('closed')
  const [removing, setRemoving] = useState<ExpenseCategory | null>(null)

  const categories = useQuery({
    queryKey: EXPENSE_KEYS.categories(true),
    queryFn: () => expenseCategoryService.list({ includeInactive: true }),
    staleTime: 0
  })
  const toggle = useMutation({ mutationFn: expenseCategoryService.setActive, onSuccess: refresh })
  const remove = useMutation({
    mutationFn: expenseCategoryService.remove,
    onSuccess: async () => {
      await refresh()
      setRemoving(null)
    }
  })

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" data-testid="expense-categories">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Expense categories</h3>
          <p className="text-sm text-muted-foreground">
            Rent, gas, salaries, repairs: whatever you spend on. A category with expenses can be
            deactivated but not deleted.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setForm('new')
          }}
        >
          <Plus /> Add category
        </Button>
      </div>
      {categories.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(categories.error)}
        </p>
      )}
      {toggle.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(toggle.error)}
        </p>
      )}
      {categories.isSuccess && categories.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No categories yet. Add one before recording an expense.
        </p>
      )}
      {categories.isSuccess && categories.data.length > 0 && (
        <ul className="divide-y rounded-md border">
          {categories.data.map((category) => (
            <li key={category.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{category.name}</div>
                {category.description && (
                  <div className="text-xs text-muted-foreground">{category.description}</div>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {category.expenseCount} expense{category.expenseCount === 1 ? '' : 's'}
              </span>
              {category.isActive ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="secondary">Deactivated</Badge>
              )}
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setForm(category)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={toggle.isPending}
                  onClick={() => {
                    toggle.mutate({ id: category.id, isActive: !category.isActive })
                  }}
                >
                  {category.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    remove.reset()
                    setRemoving(category)
                  }}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CategoryFormDialog
        open={form !== 'closed'}
        category={form === 'closed' || form === 'new' ? null : form}
        onClose={() => {
          setForm('closed')
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Delete category"
        message={`Delete ${removing?.name ?? 'this category'}? A category with any expense on record cannot be deleted; deactivate it instead.`}
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        error={remove.isError ? toUserMessage(remove.error) : undefined}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id)
        }}
        onClose={() => {
          setRemoving(null)
        }}
      />
    </section>
  )
}
