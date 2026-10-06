import { Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { useAppInfo, useHealth } from '@/modules/system/hooks'
import { HealthChecklist } from '@/modules/system/HealthChecklist'
import { authService } from '@/services/auth.service'
import { systemService } from '@/services/system.service'
import { defaultRouteFor, useAuthStore } from '@/stores/auth.store'

/** First screen: verifies the local database and storage before letting anyone sign in. */
export function StartupPage() {
  const navigate = useNavigate()
  const health = useHealth()
  const appInfo = useAppInfo()
  const session = useAuthStore((s) => s.session)
  const healthy = health.data?.status === 'ok'
  const setup = useQuery({
    queryKey: ['system', 'setup-status'],
    queryFn: authService.getSetupStatus,
    enabled: healthy,
    staleTime: 0
  })

  // Healthy start-up: first run goes to the setup wizard, otherwise sign-in (or straight on if a
  // session is already open, e.g. after a window reload).
  useEffect(() => {
    if (!healthy || !setup.data) return
    if (!setup.data.isSetupComplete) void navigate('/setup', { replace: true })
    else void navigate(session ? defaultRouteFor(session) : '/login', { replace: true })
  }, [healthy, setup.data, session, navigate])

  const failed = health.isError || health.data?.status === 'failed' || setup.isError

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-navy p-8 text-navy-foreground">
      <BrandLogo tone="light" className="scale-125" />

      {(health.isPending || (healthy && setup.isPending)) && (
        <div className="flex w-80 flex-col items-center gap-4" role="status">
          <Loader2 className="size-6 animate-spin" aria-hidden />
          <p className="text-sm text-navy-foreground/80">Starting Tandoori-POS…</p>
          <Skeleton className="h-2 w-full bg-white/10" />
        </div>
      )}

      {failed && (
        <div className="w-full max-w-lg space-y-5 rounded-lg bg-white/5 p-6" role="alert">
          <div>
            <h1 className="text-lg font-bold">Tandoori-POS could not start safely</h1>
            <p className="mt-1 text-sm text-navy-foreground/70">
              {health.isError
                ? toUserMessage(health.error)
                : 'One or more start-up checks failed. Nothing has been changed or deleted.'}
            </p>
          </div>
          {health.data && <HealthChecklist report={health.data} tone="dark" />}
          <div className="flex gap-2">
            <Button
              onClick={() => {
                void health.refetch()
              }}
            >
              Try again
            </Button>
            <Button
              variant="outline"
              className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={() => {
                systemService.close().catch(() => {
                  window.close()
                })
              }}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {appInfo.data && (
        <p className="absolute bottom-4 text-xs text-navy-foreground/40">
          Version {appInfo.data.version} · {appInfo.data.env}
        </p>
      )}
    </div>
  )
}
