import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type SyntheticEvent } from 'react'
import {
  createTaxCategoryInputSchema,
  updateTaxCategoryInputSchema,
  type TaxCategory
} from '@shared/menu'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldErrors } from '@/lib/form'
import { bpsToInput, formatPercent, parsePercentToBps } from '@/lib/money'
import { taxCategoryService } from '@/services/menu.service'
import { MENU_KEYS, useRefreshMenu } from './hooks'
import { FormFooter, MenuListPanel } from './MenuListPanel'

function TaxForm({ tax, onClose }: { tax: TaxCategory | null; onClose: () => void }) {
  const refresh = useRefreshMenu()
  const [name, setName] = useState(tax?.name ?? '')
  const [rate, setRate] = useState(tax ? bpsToInput(tax.rateBps) : '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const payload = { name, rateBps: parsePercentToBps(rate) }
  const save = useMutation({
    mutationFn: (): Promise<TaxCategory> =>
      tax
        ? taxCategoryService.update({ id: tax.id, ...payload })
        : taxCategoryService.create(payload),
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = tax
      ? updateTaxCategoryInputSchema.safeParse({ id: tax.id, ...payload })
      : createTaxCategoryInputSchema.safeParse(payload)
    if (!result.success) {
      setErrors(fieldErrors(result.error))
      return
    }
    setErrors({})
    save.mutate()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Tax name" required error={errors.name} hint="For example Food or Beverages.">
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
      <Field
        label="Rate (%)"
        required
        error={errors.rateBps}
        hint="Up to two decimals, for example 5 or 2.5."
      >
        {(c) => (
          <Input
            {...c}
            inputMode="decimal"
            value={rate}
            onChange={(event) => {
              setRate(event.target.value)
            }}
          />
        )}
      </Field>
      <FormFooter
        error={save.error}
        pending={save.isPending}
        submitLabel={tax ? 'Save changes' : 'Add tax category'}
        onClose={onClose}
      />
    </form>
  )
}

/** Admin: tax categories that items can be assigned to (billing applies them later). */
export function TaxesPanel({ canManage }: { canManage: boolean }) {
  const query = useQuery({
    queryKey: MENU_KEYS.taxCategories,
    queryFn: taxCategoryService.list,
    staleTime: 0
  })
  return (
    <MenuListPanel<TaxCategory>
      intro="Tax categories group items by the tax rate that applies to them. The rate is kept with the item and used when bills are generated."
      noun="tax category"
      emptyText="No tax categories yet. Add the rates that apply to your items."
      deleteHint="This only works for a tax category no item uses. Deactivate it instead to stop offering it."
      columns={[
        { header: 'Rate', cell: (row) => formatPercent(row.rateBps) },
        { header: 'Items', cell: (row) => row.itemCount }
      ]}
      query={query}
      canManage={canManage}
      renderForm={(row, onClose) => <TaxForm tax={row} onClose={onClose} />}
      onToggle={(row) => taxCategoryService.setActive({ id: row.id, isActive: !row.isActive })}
      onDelete={(row) => taxCategoryService.remove(row.id)}
    />
  )
}
