import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { ConnectivityIndicator } from '@/components/ConnectivityIndicator'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { WindowControls } from '@/components/WindowControls'
import { toUserMessage } from '@/lib/ipc'
import { authService } from '@/services/auth.service'
import { defaultRouteFor, useAuthStore } from '@/stores/auth.store'

interface LocationState {
  from?: string
  justSetup?: boolean
}

/** Staff sign-in. Works with no internet: credentials are checked against the local database. */
export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as LocationState
  const session = useAuthStore((s) => s.session)
  const expired = useAuthStore((s) => s.expired)
  const setSession = useAuthStore((s) => s.setSession)

  const setup = useQuery({
    queryKey: ['system', 'setup-status'],
    queryFn: authService.getSetupStatus,
    staleTime: 0
  })

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    mutationFn: authService.login,
    onSuccess: (next) => {
      setSession(next)
      const target = state.from && state.from !== '/login' ? state.from : defaultRouteFor(next)
      void navigate(next.user.mustChangePassword ? '/account' : target, { replace: true })
    },
    onError: () => {
      setPassword('')
    }
  })

  if (session) return <Navigate to={defaultRouteFor(session)} replace />
  if (setup.data && !setup.isFetching && !setup.data.isSetupComplete)
    return <Navigate to="/setup" replace />

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    login.mutate({ username, password })
  }

  return (
    <div className="flex h-full flex-col bg-navy text-navy-foreground">
      <div className="flex items-center justify-end gap-2 p-3">
        <ConnectivityIndicator />
        <WindowControls tone="dark" />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex flex-col items-center gap-2">
          <BrandLogo tone="light" className="scale-125" />
          {setup.data?.restaurantName && (
            <p className="mt-2 text-sm text-navy-foreground/70">{setup.data.restaurantName}</p>
          )}
        </div>

        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription>Use your staff account to start your shift.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit} noValidate>
              {state.justSetup && (
                <p
                  role="status"
                  className="rounded-md bg-success/15 px-3 py-2 text-sm font-medium text-success"
                >
                  Setup complete. Sign in with the owner account you just created.
                </p>
              )}
              {expired && (
                <p
                  role="status"
                  className="rounded-md bg-warning/15 px-3 py-2 text-sm font-medium text-warning"
                >
                  Your session ended for security. Please sign in again.
                </p>
              )}
              <Field label="Username">
                {(control) => (
                  <Input
                    {...control}
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value)
                    }}
                  />
                )}
              </Field>
              <Field label="Password">
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                    }}
                  />
                )}
              </Field>
              {login.isError && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {toUserMessage(login.error)}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={login.isPending || !username || !password || setup.isPending}
              >
                {login.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
