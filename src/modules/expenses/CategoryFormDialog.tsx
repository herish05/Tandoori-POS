import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  createExpenseCategoryInputSchema,
  updateExpenseCategoryInputSchema,
  type ExpenseCategory
} from '@shared/expenses'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { expenseCategoryService } from '@/services/expenses.service'
import { useRefreshExpenses } from './hooks'

interface CategoryFormDialogProps {
  open: boolean
  /** The category being edited; null adds a new one. */
  category: ExpenseCategory | null
  onClose: () => void
}

/** Add or rename an expense category. */
export function CategoryFormDialog({ open, category, onClose }: CategoryFormDialogProps) {
  return (
    <Dialog open={open} title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      <CategoryForm key={category?.id ?? 'new'} category={category} onClose={onClose} />
    </Dialog>
  )
}

function CategoryForm({ category, onClose }: Omit<CategoryFormDialogProps, 'open'>) {
  const refresh = useRefreshExpenses()
  const [values, setValues] = useState({
    name: category?.name ?? '',
    description: category?.description ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const done = async (): Promise<void> => {
    await refresh()
    onClose()
  }
  const create = useMutation({ mutationFn: expenseCategoryService.create, onSuccess: done })
  const update = useMutation({ mutationFn: expenseCategoryService.update, onSuccess: done })
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  const text =
    (key: keyof typeof values) =>
    (event: { target: { value: string } }): void => {
      setValues((current) => ({ ...current, [key]: event.target.value }))
    }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const parsed = category
      ? updateExpenseCategoryInputSchema.safeParse({ id: category.id, ...values })
      : createExpenseCategoryInputSchema.safeParse(values)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    if (category) {
      update.mutate({ id: category.id, ...parsed.data })
    } else {
      create.mutate(parsed.data)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Category name" required error={errors.name}>
        {(c) => <Input {...c} autoFocus value={values.name} onChange={text('name')} />}
      </Field>
      <Field label="Description" error={errors.description}>
        {(c) => <Input {...c} value={values.description} onChange={text('description')} />}
      </Field>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {category ? 'Save changes' : 'Add category'}
        </Button>
      </div>
    </form>
  )
}
