import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Pencil, Plus } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  createStaffInputSchema,
  resetPasswordInputSchema,
  updateStaffInputSchema
} from '@shared/auth-schemas'
import type { RoleRef, StaffMember } from '@shared/domain'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { formatDateTime } from '@/lib/format'
import { staffService } from '@/services/auth.service'
import { usePermission, useAuthStore } from '@/stores/auth.store'

const STAFF_KEY = ['staff'] as const
const ASSIGNABLE_KEY = ['staff', 'assignable-roles'] as const

interface StaffFormValues {
  username: string
  password: string
  fullName: string
  email: string
  phone: string
  roleIds: string[]
  isActive: boolean
}

function RoleChecklist({
  roles,
  selected,
  disabled,
  error,
  onChange
}: {
  roles: RoleRef[]
  selected: string[]
  disabled?: boolean
  error?: string | undefined
  onChange: (ids: string[]) => void
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">
        Roles <span className="text-destructive">*</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {roles.map((role) => (
          <label key={role.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[hsl(var(--primary))]"
              checked={selected.includes(role.id)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...selected, role.id]
                    : selected.filter((id) => id !== role.id)
                )
              }}
            />
            {role.name}
          </label>
        ))}
      </div>
      {roles.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No roles are available to you. Create one under Roles first.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function StaffDialog({
  member,
  roles,
  isSelf,
  onClose
}: {
  member: StaffMember | null
  roles: RoleRef[]
  isSelf: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const editing = member !== null
  const [values, setValues] = useState<StaffFormValues>({
    username: member?.username ?? '',
    password: '',
    fullName: member?.fullName ?? '',
    email: member?.email ?? '',
    phone: member?.phone ?? '',
    roleIds: member?.roles.map((role) => role.id) ?? [],
    isActive: member?.isActive ?? true
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: (): Promise<StaffMember> =>
      member
        ? staffService.update({
            id: member.id,
            fullName: values.fullName,
            email: values.email,
            phone: values.phone,
            roleIds: values.roleIds,
            isActive: values.isActive
          })
        : staffService.create({
            username: values.username,
            password: values.password,
            fullName: values.fullName,
            email: values.email,
            phone: values.phone,
            roleIds: values.roleIds
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STAFF_KEY })
      onClose()
    }
  })

  const set = (patch: Partial<StaffFormValues>): void => {
    setValues((current) => ({ ...current, ...patch }))
  }
  const text =
    (key: 'username' | 'password' | 'fullName' | 'email' | 'phone') =>
    (event: { target: { value: string } }): void => {
      set({ [key]: event.target.value })
    }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = member
      ? updateStaffInputSchema.safeParse({ id: member.id, ...values })
      : createStaffInputSchema.safeParse(values)
    if (!result.success) {
      setErrors(fieldErrors(result.error))
      return
    }
    setErrors({})
    save.mutate()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Full name" required error={errors.fullName}>
        {(c) => <Input {...c} value={values.fullName} onChange={text('fullName')} />}
      </Field>
      {!editing && (
        <>
          <Field
            label="Username"
            required
            error={errors.username}
            hint="Used to sign in. Cannot be changed later."
          >
            {(c) => <Input {...c} value={values.username} onChange={text('username')} />}
          </Field>
          <Field
            label="Temporary password"
            required
            error={errors.password}
            hint="They will be asked to choose their own at first sign-in."
          >
            {(c) => (
              <Input
                {...c}
                type="password"
                autoComplete="new-password"
                value={values.password}
                onChange={text('password')}
              />
            )}
          </Field>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" error={errors.email}>
          {(c) => <Input {...c} type="email" value={values.email} onChange={text('email')} />}
        </Field>
        <Field label="Phone" error={errors.phone}>
          {(c) => <Input {...c} type="tel" value={values.phone} onChange={text('phone')} />}
        </Field>
      </div>
      <RoleChecklist
        roles={roles}
        selected={values.roleIds}
        disabled={isSelf}
        error={errors.roleIds}
        onChange={(roleIds) => {
          set({ roleIds })
        }}
      />
      {editing && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[hsl(var(--primary))]"
            checked={values.isActive}
            disabled={isSelf}
            onChange={(event) => {
              set({ isActive: event.target.checked })
            }}
          />
          Active (can sign in)
        </label>
      )}
      {isSelf && (
        <p className="text-xs text-muted-foreground">
          You cannot change your own roles or deactivate yourself.
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
          {editing ? 'Save changes' : 'Add staff member'}
        </Button>
      </div>
    </form>
  )
}

function ResetPasswordDialog({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const reset = useMutation({
    mutationFn: () => staffService.resetPassword({ id: member.id, newPassword: password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STAFF_KEY })
      onClose()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = resetPasswordInputSchema.safeParse({ id: member.id, newPassword: password })
    if (!result.success) {
      setError(fieldErrors(result.error).newPassword ?? 'Invalid password.')
      return
    }
    setError(undefined)
    reset.mutate()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {member.fullName} will be signed out and must choose a new password the next time they sign
        in.
      </p>
      <Field label="Temporary password" required error={error}>
        {(c) => (
          <Input
            {...c}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
            }}
          />
        )}
      </Field>
      {reset.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(reset.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={reset.isPending}>
          {reset.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Reset password
        </Button>
      </div>
    </form>
  )
}

export function StaffPage() {
  const canManage = usePermission('users.manage')
  const selfId = useAuthStore((s) => s.session?.user.id)
  const staff = useQuery({ queryKey: STAFF_KEY, queryFn: staffService.list })
  const assignable = useQuery({
    queryKey: ASSIGNABLE_KEY,
    queryFn: staffService.assignableRoles,
    enabled: canManage
  })
  const [dialog, setDialog] = useState<
    { kind: 'edit'; member: StaffMember | null } | { kind: 'reset'; member: StaffMember } | null
  >(null)

  const roles = assignable.data ?? []
  const canEditMember = (member: StaffMember): boolean =>
    canManage &&
    assignable.data !== undefined &&
    member.roles.every((role) => roles.some((r) => r.id === role.id))

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Staff</h2>
          <p className="text-sm text-muted-foreground">People who can sign in to Tandoori-POS.</p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setDialog({ kind: 'edit', member: null })
            }}
          >
            <Plus /> Add staff member
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {staff.isPending && <Skeleton className="m-5 h-40" />}
          {staff.isError && (
            <p role="alert" className="p-5 text-sm text-destructive">
              {toUserMessage(staff.error)}
            </p>
          )}
          {staff.data && (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Roles</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last sign-in</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {staff.data.map((member) => (
                  <tr key={member.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">
                      {member.fullName}
                      {member.id === selfId && (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{member.username}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {member.roles.map((role) => (
                          <Badge key={role.id} variant="secondary">
                            {role.name}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {member.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="destructive">Disabled</Badge>
                      )}
                      {member.mustChangePassword && (
                        <Badge variant="warning" className="ml-1">
                          Password change due
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {member.lastLoginAt ? formatDateTime(member.lastLoginAt) : 'Never'}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canEditMember(member)}
                            onClick={() => {
                              setDialog({ kind: 'edit', member })
                            }}
                            aria-label={`Edit ${member.fullName}`}
                          >
                            <Pencil /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canEditMember(member) || member.id === selfId}
                            onClick={() => {
                              setDialog({ kind: 'reset', member })
                            }}
                            aria-label={`Reset password for ${member.fullName}`}
                          >
                            <KeyRound /> Reset password
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
        title={dialog?.kind === 'edit' && dialog.member ? 'Edit staff member' : 'Add staff member'}
        onClose={() => {
          setDialog(null)
        }}
      >
        {dialog?.kind === 'edit' && (
          <StaffDialog
            member={dialog.member}
            roles={roles}
            isSelf={dialog.member?.id === selfId}
            onClose={() => {
              setDialog(null)
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={dialog?.kind === 'reset'}
        title="Reset password"
        onClose={() => {
          setDialog(null)
        }}
      >
        {dialog?.kind === 'reset' && (
          <ResetPasswordDialog
            member={dialog.member}
            onClose={() => {
              setDialog(null)
            }}
          />
        )}
      </Dialog>
    </div>
  )
}
