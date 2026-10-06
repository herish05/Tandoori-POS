import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type SyntheticEvent } from 'react'
import {
  createStationInputSchema,
  updateStationInputSchema,
  type KitchenStation
} from '@shared/menu'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldErrors } from '@/lib/form'
import { stationService } from '@/services/menu.service'
import { MENU_KEYS, useRefreshMenu } from './hooks'
import { FormFooter, MenuListPanel } from './MenuListPanel'

function StationForm({
  station,
  onClose
}: {
  station: KitchenStation | null
  onClose: () => void
}) {
  const refresh = useRefreshMenu()
  const [name, setName] = useState(station?.name ?? '')
  const [description, setDescription] = useState(station?.description ?? '')
  const [sortOrder, setSortOrder] = useState(String(station?.sortOrder ?? 0))
  const [errors, setErrors] = useState<Record<string, string>>({})

  const payload = {
    name,
    description,
    sortOrder: sortOrder.trim() === '' ? 0 : Number(sortOrder)
  }
  const save = useMutation({
    mutationFn: (): Promise<KitchenStation> =>
      station
        ? stationService.update({ id: station.id, ...payload })
        : stationService.create(payload),
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = station
      ? updateStationInputSchema.safeParse({ id: station.id, ...payload })
      : createStationInputSchema.safeParse(payload)
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
        label="Station name"
        required
        error={errors.name}
        hint="Where tickets are printed or shown, for example Tandoor, Curry counter or Bar."
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
      <Field label="Display order" error={errors.sortOrder} hint="Smaller numbers are shown first.">
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
      <FormFooter
        error={save.error}
        pending={save.isPending}
        submitLabel={station ? 'Save changes' : 'Add station'}
        onClose={onClose}
      />
    </form>
  )
}

/** Admin: the kitchen stations (tandoor, curry counter, bar...) that receive tickets. */
export function StationsPanel({ canManage }: { canManage: boolean }) {
  const query = useQuery({
    queryKey: MENU_KEYS.stations,
    queryFn: stationService.list,
    staleTime: 0
  })
  return (
    <MenuListPanel<KitchenStation>
      intro="Kitchen stations receive the tickets for the items they prepare. Choose one per category, or override it for a single item."
      noun="station"
      emptyText="No stations yet. Add the places your food is prepared, such as a tandoor or a bar."
      deleteHint="This only works for a station that no category or item uses. To stop using one that is in use, change those categories and items first."
      detail={(row) => row.description}
      columns={[
        { header: 'In use by', cell: (row) => `${String(row.usageCount)} categories and items` },
        { header: 'Order', cell: (row) => row.sortOrder }
      ]}
      query={query}
      canManage={canManage}
      renderForm={(row, onClose) => <StationForm station={row} onClose={onClose} />}
      onToggle={(row) => stationService.setActive({ id: row.id, isActive: !row.isActive })}
      onDelete={(row) => stationService.remove(row.id)}
    />
  )
}
