import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Power, PowerOff } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  createTableInputSchema,
  MAX_TABLE_CAPACITY,
  TABLE_TYPE_LABELS,
  TABLE_TYPES,
  updateTableInputSchema,
  type AreaSummary,
  type DiningTable
} from '@shared/tables'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { areaService, tableService } from '@/services/tables.service'
import { TABLE_KEYS, useRefreshTables } from '../hooks'
import { TABLE_STATUS_META } from '../table-status'

interface TableFormValues {
  areaId: string
  tableNumber: string
  displayName: string
  capacity: string
  type: string
}

function TableForm({
  table,
  areas,
  defaultAreaId,
  onClose
}: {
  table: DiningTable | null
  areas: AreaSummary[]
  defaultAreaId: string
  onClose: () => void
}) {
  const refresh = useRefreshTables()
  const [values, setValues] = useState<TableFormValues>({
    areaId: table?.areaId ?? defaultAreaId,
    tableNumber: table?.tableNumber ?? '',
    displayName:
      table && table.displayName !== `Table ${table.tableNumber}` ? table.displayName : '',
    capacity: String(table?.capacity ?? 4),
    type: table?.type ?? 'AC'
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const payload = {
    areaId: values.areaId,
    tableNumber: values.tableNumber,
    displayName: values.displayName,
    capacity: values.capacity.trim() === '' ? Number.NaN : Number(values.capacity),
    type: values.type
  }

  const save = useMutation({
    mutationFn: (): Promise<DiningTable> => {
      const parsed = table
        ? updateTableInputSchema.parse({ id: table.id, ...payload })
        : createTableInputSchema.parse(payload)
      return 'id' in parsed ? tableService.update(parsed) : tableService.create(parsed)
    },
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const text =
    (key: keyof TableFormValues) =>
    (event: { target: { value: string } }): void => {
      setValues((current) => ({ ...current, [key]: event.target.value }))
    }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = table
      ? updateTableInputSchema.safeParse({ id: table.id, ...payload })
      : createTableInputSchema.safeParse(payload)
    if (!result.success) {
      setErrors(fieldErrors(result.error))
      return
    }
    setErrors({})
    save.mutate()
  }

  // Inactive areas can only be chosen if the table already lives in one.
  const choices = areas.filter((area) => area.isActive || area.id === table?.areaId)

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Table number"
          required
          error={errors.tableNumber}
          hint="Unique, e.g. 1, A4 or T12."
        >
          {(c) => <Input {...c} value={values.tableNumber} onChange={text('tableNumber')} />}
        </Field>
        <Field
          label="Display name"
          error={errors.displayName}
          hint="Optional. Defaults to “Table” plus the number."
        >
          {(c) => <Input {...c} value={values.displayName} onChange={text('displayName')} />}
        </Field>
      </div>
      <Field label="Area" required error={errors.areaId}>
        {(c) => (
          <Select {...c} value={values.areaId} onChange={text('areaId')}>
            {choices.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Seats"
          required
          error={errors.capacity}
          hint={`Up to ${String(MAX_TABLE_CAPACITY)} guests.`}
        >
          {(c) => (
            <Input {...c} inputMode="numeric" value={values.capacity} onChange={text('capacity')} />
          )}
        </Field>
        <Field label="Type" required error={errors.type}>
          {(c) => (
            <Select {...c} value={values.type} onChange={text('type')}>
              {TABLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TABLE_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {!table && (
        <p className="text-xs text-muted-foreground">
          The table is placed in the first free spot of its area. Arrange it on the Layout tab.
        </p>
      )}
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
          {table ? 'Save changes' : 'Add table'}
        </Button>
      </div>
    </form>
  )
}

/** Admin: create, edit and retire tables. */
export function TablesPanel({ canManage }: { canManage: boolean }) {
  const refresh = useRefreshTables()
  const tables = useQuery({ queryKey: TABLE_KEYS.list, queryFn: tableService.list, staleTime: 0 })
  const areas = useQuery({ queryKey: TABLE_KEYS.areas, queryFn: areaService.list, staleTime: 0 })
  const [areaFilter, setAreaFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [editing, setEditing] = useState<{ table: DiningTable | null } | null>(null)
  const [notice, setNotice] = useState<string | undefined>()

  const toggle = useMutation({
    mutationFn: (table: DiningTable) =>
      tableService.setActive({ id: table.id, isActive: !table.isActive }),
    onSuccess: async () => {
      setNotice(undefined)
      await refresh()
    },
    onError: (error) => {
      setNotice(toUserMessage(error))
    }
  })

  const areaList = areas.data ?? []
  const activeAreas = areaList.filter((area) => area.isActive)
  const rows = (tables.data ?? []).filter(
    (t) =>
      (areaFilter === '' || t.areaId === areaFilter) && (typeFilter === '' || t.type === typeFilter)
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label="Filter by area"
          className="w-48"
          value={areaFilter}
          onChange={(event) => {
            setAreaFilter(event.target.value)
          }}
        >
          <option value="">All areas</option>
          {areaList.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by type"
          className="w-40"
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value)
          }}
        >
          <option value="">All types</option>
          {TABLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {TABLE_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
        {canManage && (
          <Button
            className="ml-auto"
            disabled={activeAreas.length === 0}
            onClick={() => {
              setEditing({ table: null })
            }}
          >
            <Plus /> Add table
          </Button>
        )}
      </div>

      {areas.data && activeAreas.length === 0 && (
        <p className="rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">
          Add an active area on the Areas tab before adding tables.
        </p>
      )}
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
          {tables.isPending && <Skeleton className="m-5 h-40" />}
          {tables.isError && (
            <p role="alert" className="p-5 text-sm text-destructive">
              {toUserMessage(tables.error)}
            </p>
          )}
          {tables.data && rows.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {tables.data.length === 0 ? 'No tables yet.' : 'No tables match these filters.'}
            </p>
          )}
          {rows.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Table</th>
                  <th className="px-4 py-3">Area</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Seats</th>
                  <th className="px-4 py-3">Now</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((table) => (
                  <tr key={table.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">
                      {table.tableNumber}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {table.displayName}
                      </span>
                    </td>
                    <td className="px-4 py-3">{table.areaName}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{TABLE_TYPE_LABELS[table.type]}</Badge>
                    </td>
                    <td className="px-4 py-3">{table.capacity}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <span
                          className={`size-3 rounded-full ${TABLE_STATUS_META[table.status].swatch}`}
                          aria-hidden
                        />
                        {TABLE_STATUS_META[table.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {table.isActive ? (
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
                            aria-label={`Edit table ${table.tableNumber}`}
                            onClick={() => {
                              setEditing({ table })
                            }}
                          >
                            <Pencil /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={toggle.isPending}
                            aria-label={`${table.isActive ? 'Deactivate' : 'Activate'} table ${table.tableNumber}`}
                            onClick={() => {
                              toggle.mutate(table)
                            }}
                          >
                            {table.isActive ? <PowerOff /> : <Power />}
                            {table.isActive ? 'Deactivate' : 'Activate'}
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
        title={editing?.table ? 'Edit table' : 'Add table'}
        onClose={() => {
          setEditing(null)
        }}
      >
        {editing && (
          <TableForm
            table={editing.table}
            areas={areaList}
            defaultAreaId={
              areaFilter !== '' && activeAreas.some((a) => a.id === areaFilter)
                ? areaFilter
                : (activeAreas[0]?.id ?? '')
            }
            onClose={() => {
              setEditing(null)
            }}
          />
        )}
      </Dialog>
    </div>
  )
}
