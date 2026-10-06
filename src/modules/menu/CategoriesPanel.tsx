import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type SyntheticEvent } from 'react'
import {
  createCategoryInputSchema,
  updateCategoryInputSchema,
  type MenuCategory
} from '@shared/menu'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { fieldErrors } from '@/lib/form'
import { categoryService, stationService } from '@/services/menu.service'
import { MENU_KEYS, useRefreshMenu } from './hooks'
import { FormFooter, MenuListPanel } from './MenuListPanel'

function CategoryForm({
  category,
  onClose
}: {
  category: MenuCategory | null
  onClose: () => void
}) {
  const refresh = useRefreshMenu()
  const stations = useQuery({ queryKey: MENU_KEYS.stations, queryFn: stationService.list })
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0))
  const [stationId, setStationId] = useState(category?.stationId ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const payload = {
    name,
    description,
    sortOrder: sortOrder.trim() === '' ? 0 : Number(sortOrder),
    stationId: stationId === '' ? null : stationId
  }
  const save = useMutation({
    mutationFn: (): Promise<MenuCategory> =>
      category
        ? categoryService.update({ id: category.id, ...payload })
        : categoryService.create(payload),
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = category
      ? updateCategoryInputSchema.safeParse({ id: category.id, ...payload })
      : createCategoryInputSchema.safeParse(payload)
    if (!result.success) {
      setErrors(fieldErrors(result.error))
      return
    }
    setErrors({})
    save.mutate()
  }

  const choices = (stations.data ?? []).filter(
    (station) => station.isActive || station.id === category?.stationId
  )

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field
        label="Category name"
        required
        error={errors.name}
        hint="For example Starters, Main course, Breads or Beverages."
      >
        {(c) => (
          <Input
            {...c}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        )}
      </Field>
      <Field label="Description" error={errors.description}>
        {(c) => (
          <Input
            {...c}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value)
            }}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Kitchen station"
          error={errors.stationId}
          hint="Items follow this unless they choose their own."
        >
          {(c) => (
            <Select
              {...c}
              value={stationId}
              onChange={(event) => {
                setStationId(event.target.value)
              }}
            >
              <option value="">No station</option>
              {choices.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                  {station.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Display order"
          error={errors.sortOrder}
          hint="Smaller numbers are shown first."
        >
          {(c) => (
            <Input
              {...c}
              inputMode="numeric"
              value={sortOrder}
              onChange={(event) => {
                setSortOrder(event.target.value)
              }}
            />
          )}
        </Field>
      </div>
      <FormFooter
        error={save.error}
        pending={save.isPending}
        submitLabel={category ? 'Save changes' : 'Add category'}
        onClose={onClose}
      />
    </form>
  )
}

/** Admin: the menu categories items are grouped under. */
export function CategoriesPanel({ canManage }: { canManage: boolean }) {
  const query = useQuery({
    queryKey: MENU_KEYS.categories,
    queryFn: categoryService.list,
    staleTime: 0
  })
  return (
    <MenuListPanel<MenuCategory>
      intro="Categories group your items on the menu and can send them all to one kitchen station."
      noun="category"
      emptyText="No categories yet. Add your first category, then add items to it."
      deleteHint="This only works for a category with no items. To hide a category that still has items, deactivate it instead."
      detail={(row) => row.description}
      columns={[
        { header: 'Station', cell: (row) => row.stationName ?? '—' },
        { header: 'Items', cell: (row) => row.itemCount },
        { header: 'Order', cell: (row) => row.sortOrder }
      ]}
      query={query}
      canManage={canManage}
      renderForm={(row, onClose) => <CategoryForm category={row} onClose={onClose} />}
      onToggle={(row) => categoryService.setActive({ id: row.id, isActive: !row.isActive })}
      onDelete={(row) => categoryService.remove(row.id)}
    />
  )
}
