import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type SyntheticEvent } from 'react'
import {
  ADDON_KIND_LABELS,
  ADDON_KINDS,
  createAddonInputSchema,
  updateAddonInputSchema,
  type AddonKind,
  type MenuAddon
} from '@shared/menu'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { fieldErrors } from '@/lib/form'
import { formatMoney, paiseToInput, parseOptionalRupees } from '@/lib/money'
import { addonService } from '@/services/menu.service'
import { MENU_KEYS, useRefreshMenu } from './hooks'
import { FormFooter, MenuListPanel } from './MenuListPanel'

function AddonForm({ addon, onClose }: { addon: MenuAddon | null; onClose: () => void }) {
  const refresh = useRefreshMenu()
  const [name, setName] = useState(addon?.name ?? '')
  const [kind, setKind] = useState<AddonKind>(addon?.kind ?? 'ADDON')
  const [price, setPrice] = useState(addon ? paiseToInput(addon.price) : '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const payload = {
    name,
    kind,
    price: kind === 'MODIFIER' ? 0 : parseOptionalRupees(price)
  }
  const save = useMutation({
    mutationFn: (): Promise<MenuAddon> =>
      addon ? addonService.update({ id: addon.id, ...payload }) : addonService.create(payload),
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = addon
      ? updateAddonInputSchema.safeParse({ id: addon.id, ...payload })
      : createAddonInputSchema.safeParse(payload)
    if (!result.success) {
      setErrors(fieldErrors(result.error))
      return
    }
    setErrors({})
    save.mutate()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field
        label="Name"
        required
        error={errors.name}
        hint="For example Extra cheese, Less spicy or No onion."
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Type"
          error={errors.kind}
          hint={
            kind === 'MODIFIER'
              ? 'A preference for the kitchen. Always free.'
              : 'An extra the guest pays for.'
          }
        >
          {(c) => (
            <Select
              {...c}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as AddonKind)
              }}
            >
              {ADDON_KINDS.map((value) => (
                <option key={value} value={value}>
                  {ADDON_KIND_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Price (₹)" error={errors.price} hint="Leave blank for free.">
          {(c) => (
            <Input
              {...c}
              inputMode="decimal"
              disabled={kind === 'MODIFIER'}
              value={kind === 'MODIFIER' ? '' : price}
              onChange={(event) => {
                setPrice(event.target.value)
              }}
            />
          )}
        </Field>
      </div>
      <FormFooter
        error={save.error}
        pending={save.isPending}
        submitLabel={addon ? 'Save changes' : 'Add'}
        onClose={onClose}
      />
    </form>
  )
}

/** Admin: priced add-ons and free modifiers that items can offer. */
export function AddonsPanel({ canManage }: { canManage: boolean }) {
  const query = useQuery({ queryKey: MENU_KEYS.addons, queryFn: addonService.list, staleTime: 0 })
  return (
    <MenuListPanel<MenuAddon>
      intro="Add-ons are paid extras; modifiers are free preferences. Offer them on any item from the item's form."
      noun="add-on"
      emptyText="No add-ons or modifiers yet."
      deleteHint="It will also be removed from every item that offers it."
      columns={[
        {
          header: 'Type',
          cell: (row) => (
            <Badge variant={row.kind === 'ADDON' ? 'secondary' : 'outline'}>
              {ADDON_KIND_LABELS[row.kind]}
            </Badge>
          )
        },
        {
          header: 'Price',
          cell: (row) => (row.kind === 'MODIFIER' ? 'Free' : formatMoney(row.price))
        },
        { header: 'Items', cell: (row) => row.itemCount }
      ]}
      query={query}
      canManage={canManage}
      renderForm={(row, onClose) => <AddonForm addon={row} onClose={onClose} />}
      onToggle={(row) => addonService.setActive({ id: row.id, isActive: !row.isActive })}
      onDelete={(row) => addonService.remove(row.id)}
    />
  )
}
