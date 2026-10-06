import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { changePasswordInputSchema } from '@shared/auth-schemas'
import { BrandLogo } from '@/components/BrandLogo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { WindowControls } from '@/components/WindowControls'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { UserMenu } from '@/modules/auth/UserMenu'
import { authService } from '@/services/auth.service'
import { defaultRouteFor, useAuthStore } from '@/stores/auth.store'

/** Own account: who you are and change your password. Forced after a reset or first sign-in. */
export function AccountPage() {
  const navigate = useNavigate()
  const session = useAuthStore((s) => s.session)
  const setSession = useAuthStore((s) => s.setSession)
  const [values, setValues] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const change = useMutation({
    mutationFn: authService.changePassword,
    onSuccess: (next) => {
      setSession(next)
      setValues({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setSaved(true)
      if (session?.user.mustChangePassword) void navigate(defaultRouteFor(next), { replace: true })
    }
  })

  if (!session) return null
  const forced = session.user.mustChangePassword

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    setSaved(false)
    const parsed = changePasswordInputSchema.safeParse(values)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    change.mutate(values)
  }

  const bind =
    (key: keyof typeof values) =>
    (event: { target: { value: string } }): void => {
      setValues((current) => ({ ...current, [key]: event.target.value }))
    }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-4">
        <BrandLogo />
        <div className="flex items-center gap-2">
          {!forced && (
            <Button variant="outline" asChild>
              <Link to={defaultRouteFor(session)}>Back to work</Link>
            </Button>
          )}
          <UserMenu />
          <WindowControls />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-lg space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{session.user.fullName}</CardTitle>
              <CardDescription>
                Signed in as <span className="font-medium">{session.user.username}</span> ·{' '}
                {session.user.roles.map((r) => r.name).join(', ')}
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{forced ? 'Choose a new password' : 'Change password'}</CardTitle>
              <CardDescription>
                {forced
                  ? 'For security you must set your own password before you continue.'
                  : 'At least 8 characters, with a letter and a number.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4" noValidate>
                <Field label="Current password" required error={errors.currentPassword}>
                  {(c) => (
                    <Input
                      {...c}
                      type="password"
                      autoComplete="current-password"
                      value={values.currentPassword}
                      onChange={bind('currentPassword')}
                    />
                  )}
                </Field>
                <Field label="New password" required error={errors.newPassword}>
                  {(c) => (
                    <Input
                      {...c}
                      type="password"
                      autoComplete="new-password"
                      value={values.newPassword}
                      onChange={bind('newPassword')}
                    />
                  )}
                </Field>
                <Field label="Confirm new password" required error={errors.confirmPassword}>
                  {(c) => (
                    <Input
                      {...c}
                      type="password"
                      autoComplete="new-password"
                      value={values.confirmPassword}
                      onChange={bind('confirmPassword')}
                    />
                  )}
                </Field>
                {change.isError && (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {toUserMessage(change.error)}
                  </p>
                )}
                {saved && !forced && (
                  <p role="status" className="text-sm font-medium text-success">
                    Password changed.
                  </p>
                )}
                <Button type="submit" disabled={change.isPending}>
                  {change.isPending && <Loader2 className="animate-spin" aria-hidden />}
                  Change password
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
