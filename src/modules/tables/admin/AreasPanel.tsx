import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { createAreaInputSchema, updateAreaInputSchema, type AreaSummary } from '@shared/tables'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { areaService } from '@/services/tables.service'
import { TABLE_KEYS, useRefreshTables } from '../hooks'

interface AreaFormValues {
  name: string
  floor: string
  description: string
  sortOrder: string
}

function AreaForm({ area, onClose }: { area: AreaSummary | null; onClose: () => void }) {
  const refresh = useRefreshTables()
  const [values, setValues] = useState<AreaFormValues>({
    name: area?.name ?? '',
    floor: area?.floor ?? '',
    description: area?.description ?? '',
    sortOrder: String(area?.sortOrder ?? 0)
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const payload = {
    name: values.name,
    floor: values.floor,
    description: values.description,
    sortOrder: values.sortOrder.trim() === '' ? 0 : Number(values.sortOrder)
  }

  const save = useMutation({
    mutationFn: (): Promise<AreaSummary> =>
      area ? areaService.update({ id: area.id, ...payload }) : areaService.create(payload),
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const text =
    (key: keyof AreaFormValues) =>
    (event: { target: { value: string } }): void => {
      setValues((current) => ({ ...current, [key]: event.target.value }))
    }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = area
      ? updateAreaInputSchema.safeParse({ id: area.id, ...payload })
      : createAreaInputSchema.safeParse(payload)
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
        label="Area name"
        required
        error={errors.name}
        hint="For example Main hall, Family section or Terrace."
      >
        {(c) => <Input {...c} value={values.name} onChange={text('name')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Floor" error={errors.floor} hint="Optional, e.g. Ground floor.">
          {(c) => <Input {...c} value={values.floor} onChange={text('floor')} />}
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
              value={values.sortOrder}
              onChange={text('sortOrder')}
            />
          )}
        </Field>
      </div>
      <Field label="Description" error={errors.description}>
        {(c) => <Input {...c} value={values.description} onChange={text('description')} />}
      </Field>
      {save.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(save.error)}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {area ? 'Save changes' : 'Add area'}
        </Button>
      </div>
    </form>
  )
}

/** Admin: create, edit, retire and delete dining areas. */
export function AreasPanel({ canManage }: { canManage: boolean }) {
  const refresh = useRefreshTables()
  const areas = useQuery({ queryKey: TABLE_KEYS.areas, queryFn: areaService.list, staleTime: 0 })
  const [editing, setEditing] = useState<{ area: AreaSummary | null } | null>(null)
  const [deleting, setDeleting] = useState<AreaSummary | null>(null)
  const [notice, setNotice] = useState<string | undefined>()

  const toggle = useMutation({
    mutationFn: (area: AreaSummary) =>
      areaService.setActive({ id: area.id, isActive: !area.isActive }),
    onSuccess: async () => {
      setNotice(undefined)
      await refresh()
    },
    onError: (error) => {
      setNotice(toUserMessage(error))
    }
  })
  const remove = useMutation({
    mutationFn: (area: AreaSummary) => areaService.remove(area.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
    }
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Dining rooms, floors and terraces. Tables belong to an area.
        </p>
        {canManage && (
          <Button
            onClick={() => {
              setEditing({ area: null })
            }}
          >
            <Plus /> Add area
          </Button>
        )}
      </div>

      {notice && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {notice}
        </p>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {areas.isPending && <Skeleton className="m-5 h-32" />}
          {areas.isError && (
            <p role="alert" className="p-5 text-sm text-destructive">
              {toUserMessage(areas.error)}
            </p>
          )}
          {areas.data?.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No areas yet. Add your first area, then add tables to it.
            </p>
          )}
          {areas.data && areas.data.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Area</th>
                  <th className="px-4 py-3">Floor</th>
                  <th className="px-4 py-3">Tables</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {areas.data.map((area) => (
                  <tr key={area.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">
                      {area.name}
                      {area.description && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {area.description}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{area.floor ?? '—'}</td>
                    <td className="px-4 py-3">
                      {area.activeTableCount}
                      {area.tableCount !== area.activeTableCount && (
                        <span className="text-muted-foreground"> of {area.tableCount}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{area.sortOrder}</td>
                    <td className="px-4 py-3">
                      {area.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="destructive">Inactive</Badge>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${area.name}`}
                            onClick={() => {
                              setEditing({ area })
                            }}
                          >
                            <Pencil /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={toggle.isPending}
                            aria-label={`${area.isActive ? 'Deactivate' : 'Activate'} ${area.name}`}
                            onClick={() => {
                              toggle.mutate(area)
                            }}
                          >
                            {area.isActive ? <PowerOff /> : <Power />}
                            {area.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${area.name}`}
                            onClick={() => {
                              remove.reset()
                              setDeleting(area)
                            }}
                          >
                            <Trash2 /> Delete
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={editing !== null}
        title={editing?.area ? 'Edit area' : 'Add area'}
        onClose={() => {
          setEditing(null)
        }}
      >
        {editing && (
          <AreaForm
            area={editing.area}
            onClose={() => {
              setEditing(null)
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete area"
        message={`Delete ${deleting?.name ?? 'this area'}? This only works for an area with no tables. To hide an area that still has tables, deactivate it instead.`}
        confirmLabel="Delete area"
        destructive
        pending={remove.isPending}
        error={remove.isError ? toUserMessage(remove.error) : undefined}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting)
        }}
        onClose={() => {
          setDeleting(null)
        }}
      />
    </div>
  )
}
