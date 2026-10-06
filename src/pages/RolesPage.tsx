import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { createRoleInputSchema } from '@shared/auth-schemas'
import type { PermissionInfo, RoleSummary } from '@shared/domain'
import { ALSO_IMPLIED, type PermissionCode } from '@shared/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { roleService } from '@/services/auth.service'
import { hasPermission, useAuthStore, usePermission } from '@/stores/auth.store'

const ROLES_KEY = ['roles'] as const
const PERMISSIONS_KEY = ['roles', 'permissions'] as const

/**
 * "x.manage" and "x.operate" imply "x.view": ticking either ticks view, unticking view clears
 * the others. A few permissions imply more (see `ALSO_IMPLIED`): ticking "Manage the menu" also
 * ticks "Mark items sold out", and clearing that clears "Manage the menu".
 */
function toggle(selected: PermissionCode[], code: PermissionCode, on: boolean): PermissionCode[] {
  const next = new Set(selected)
  const [area, level] = code.split('.')
  if (on) {
    next.add(code)
    if (level === 'manage' || level === 'operate') next.add(`${area ?? ''}.view` as PermissionCode)
    for (const extra of ALSO_IMPLIED[code] ?? []) next.add(extra)
  } else {
    next.delete(code)
    if (level === 'view') {
      next.delete(`${area ?? ''}.manage` as PermissionCode)
      next.delete(`${area ?? ''}.operate` as PermissionCode)
    }
    for (const [stronger, implied] of Object.entries(ALSO_IMPLIED)) {
      if (implied.includes(code)) next.delete(stronger as PermissionCode)
    }
  }
  return [...next]
}

function RoleEditor({
  role,
  permissions,
  onClose
}: {
  role: RoleSummary | null
  permissions: PermissionInfo[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const session = useAuthStore((s) => s.session)
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [selected, setSelected] = useState<PermissionCode[]>(role?.permissions ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: () =>
      role
        ? roleService.update({ id: role.id, name, description, permissions: selected })
        : roleService.create({ name, description, permissions: selected }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ROLES_KEY }),
        queryClient.invalidateQueries({ queryKey: ['staff'] })
      ])
      onClose()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = createRoleInputSchema.safeParse({ name, description, permissions: selected })
    if (!result.success) {
      setErrors(fieldErrors(result.error))
      return
    }
    setErrors({})
    save.mutate()
  }

  const groups = [...new Set(permissions.map((p) => p.group))]

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Role name" required error={errors.name}>
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
          <Textarea
            {...c}
            rows={2}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value)
            }}
          />
        )}
      </Field>

      <div className="space-y-3">
        <p className="text-sm font-medium">Access</p>
        {groups.map((group) => (
          <fieldset key={group} className="rounded-md border p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {group}
            </legend>
            <div className="space-y-2">
              {permissions
                .filter((p) => p.group === group)
                .map((permission) => {
                  const heldByMe = hasPermission(session, permission.code)
                  return (
                    <label key={permission.code} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                        checked={selected.includes(permission.code)}
                        disabled={!heldByMe}
                        onChange={(event) => {
                          setSelected((current) =>
                            toggle(current, permission.code, event.target.checked)
                          )
                        }}
                      />
                      <span>
                        <span className="font-medium">{permission.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {permission.description}
                          {!heldByMe && ' (you do not hold this access, so you cannot grant it)'}
                        </span>
                      </span>
                    </label>
                  )
                })}
            </div>
          </fieldset>
        ))}
      </div>

      {save.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(save.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {role ? 'Save role' : 'Create role'}
        </Button>
      </div>
    </form>
  )
}

function DeleteRole({ role, onClose }: { role: RoleSummary; onClose: () => void }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => roleService.remove(role.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ROLES_KEY }),
        queryClient.invalidateQueries({ queryKey: ['staff'] })
      ])
      onClose()
    }
  })
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Delete the <span className="font-semibold">{role.name}</span> role? This cannot be undone.
      </p>
      {remove.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(remove.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate()
          }}
        >
          {remove.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Delete role
        </Button>
      </div>
    </div>
  )
}

export function RolesPage() {
  const canManage = usePermission('roles.manage')
  const roles = useQuery({ queryKey: ROLES_KEY, queryFn: roleService.list })
  const permissions = useQuery({ queryKey: PERMISSIONS_KEY, queryFn: roleService.permissions })
  const [dialog, setDialog] = useState<
    { kind: 'edit'; role: RoleSummary | null } | { kind: 'delete'; role: RoleSummary } | null
  >(null)
  const close = (): void => {
    setDialog(null)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Roles</h2>
          <p className="text-sm text-muted-foreground">
            A role decides which parts of the app a person can use.
          </p>
        </div>
        {canManage && (
          <Button
            disabled={!permissions.data}
            onClick={() => {
              setDialog({ kind: 'edit', role: null })
            }}
          >
            <Plus /> New role
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {roles.isPending && <Skeleton className="m-5 h-32" />}
          {roles.isError && (
            <p role="alert" className="p-5 text-sm text-destructive">
              {toUserMessage(roles.error)}
            </p>
          )}
          {roles.data && (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Access</th>
                  <th className="px-4 py-3">Staff</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {roles.data.map((role) => (
                  <tr key={role.id} className="border-b align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-1.5 font-medium">
                        {role.name}
                        {role.isSystem && (
                          <Lock
                            className="size-3.5 text-muted-foreground"
                            aria-label="Built-in role"
                          />
                        )}
                      </p>
                      {role.description && (
                        <p className="text-xs text-muted-foreground">{role.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {role.permissions.length === 0 && (
                          <span className="text-xs text-muted-foreground">No access</span>
                        )}
                        {role.permissions.map((code) => (
                          <Badge key={code} variant="outline">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">{role.userCount}</td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={role.isSystem || !permissions.data}
                            onClick={() => {
                              setDialog({ kind: 'edit', role })
                            }}
                            aria-label={`Edit ${role.name}`}
                          >
                            <Pencil /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={role.isSystem}
                            onClick={() => {
                              setDialog({ kind: 'delete', role })
                            }}
                            aria-label={`Delete ${role.name}`}
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
        open={dialog?.kind === 'edit'}
        title={dialog?.kind === 'edit' && dialog.role ? 'Edit role' : 'New role'}
        className="max-w-2xl"
        onClose={close}
      >
        {dialog?.kind === 'edit' && permissions.data && (
          <RoleEditor role={dialog.role} permissions={permissions.data} onClose={close} />
        )}
      </Dialog>
      <Dialog open={dialog?.kind === 'delete'} title="Delete role" onClose={close}>
        {dialog?.kind === 'delete' && <DeleteRole role={dialog.role} onClose={close} />}
      </Dialog>
    </div>
  )
}
