import { useMutation, type UseQueryResult } from '@tanstack/react-query'
import { Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { useRefreshMenu } from './hooks'

interface ListRow {
  id: string
  name: string
  isActive: boolean
  isDemo: boolean
}

export interface MenuColumn<T> {
  header: string
  cell: (row: T) => ReactNode
}

interface MenuListPanelProps<T extends ListRow> {
  intro: string
  /** Singular, lower case: "station". */
  noun: string
  emptyText: string
  deleteHint: string
  /** Extra text shown under the name (a description, say). */
  detail?: (row: T) => string | null
  columns: MenuColumn<T>[]
  query: UseQueryResult<T[]>
  canManage: boolean
  renderForm: (row: T | null, onClose: () => void) => ReactNode
  onToggle: (row: T) => Promise<unknown>
  onDelete: (row: T) => Promise<unknown>
}

/** The shared list screen behind stations, categories, taxes and add-ons. */
export function MenuListPanel<T extends ListRow>({
  intro,
  noun,
  emptyText,
  deleteHint,
  detail,
  columns,
  query,
  canManage,
  renderForm,
  onToggle,
  onDelete
}: MenuListPanelProps<T>) {
  const refresh = useRefreshMenu()
  const [editing, setEditing] = useState<{ row: T | null } | null>(null)
  const [deleting, setDeleting] = useState<T | null>(null)
  const [notice, setNotice] = useState<string | undefined>()

  const toggle = useMutation({
    mutationFn: onToggle,
    onSuccess: async () => {
      setNotice(undefined)
      await refresh()
    },
    onError: (error) => {
      setNotice(toUserMessage(error))
    }
  })
  const remove = useMutation({
    mutationFn: onDelete,
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
    }
  })

  const rows = query.data

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{intro}</p>
        {canManage && (
          <Button
            onClick={() => {
              setEditing({ row: null })
            }}
          >
            <Plus /> Add {noun}
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
          {query.isPending && <Skeleton className="m-5 h-32" />}
          {query.isError && (
            <p role="alert" className="p-5 text-sm text-destructive">
              {toUserMessage(query.error)}
            </p>
          )}
          {rows?.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">{emptyText}</p>
          )}
          {rows && rows.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  {columns.map((column) => (
                    <th key={column.header} className="px-4 py-3">
                      {column.header}
                    </th>
                  ))}
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const extra = detail?.(row)
                  return (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">
                        <span className="flex flex-wrap items-center gap-2">
                          {row.name}
                          {row.isDemo && <Badge variant="outline">Sample</Badge>}
                        </span>
                        {extra && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {extra}
                          </span>
                        )}
                      </td>
                      {columns.map((column) => (
                        <td key={column.header} className="px-4 py-3">
                          {column.cell(row)}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        {row.isActive ? (
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
                              aria-label={`Edit ${row.name}`}
                              onClick={() => {
                                setEditing({ row })
                              }}
                            >
                              <Pencil /> Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={toggle.isPending}
                              aria-label={`${row.isActive ? 'Deactivate' : 'Activate'} ${row.name}`}
                              onClick={() => {
                                toggle.mutate(row)
                              }}
                            >
                              {row.isActive ? <PowerOff /> : <Power />}
                              {row.isActive ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Delete ${row.name}`}
                              onClick={() => {
                                remove.reset()
                                setDeleting(row)
                              }}
                            >
                              <Trash2 /> Delete
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={editing !== null}
        title={editing?.row ? `Edit ${noun}` : `Add ${noun}`}
        onClose={() => {
          setEditing(null)
        }}
      >
        {editing &&
          renderForm(editing.row, () => {
            setEditing(null)
          })}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${noun}`}
        message={`Delete ${deleting?.name ?? `this ${noun}`}? ${deleteHint}`}
        confirmLabel={`Delete ${noun}`}
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

/** Cancel / Save row and the shared error line under a form. */
export function FormFooter({
  error,
  pending,
  submitLabel,
  onClose
}: {
  error: unknown
  pending: boolean
  submitLabel: string
  onClose: () => void
}) {
  return (
    <>
      {error !== null && error !== undefined && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(error)}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </>
  )
}
