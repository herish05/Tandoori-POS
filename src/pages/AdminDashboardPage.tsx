import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { toUserMessage } from '@/lib/ipc'
import { useAppInfo, useHealth } from '@/modules/system/hooks'
import { HealthChecklist } from '@/modules/system/HealthChecklist'

/** Admin landing page. Shows real system status; business dashboards arrive with later phases. */
export function AdminDashboardPage() {
  const health = useHealth()
  const info = useAppInfo()

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>System status</CardTitle>
            {health.data && (
              <Badge variant={health.data.status === 'ok' ? 'success' : 'destructive'}>
                {health.data.status === 'ok' ? 'Healthy' : 'Attention needed'}
              </Badge>
            )}
          </div>
          <CardDescription>Checks run against this computer, not the cloud.</CardDescription>
        </CardHeader>
        <CardContent>
          {health.isPending && <Skeleton className="h-32 w-full" />}
          {health.isError && (
            <p role="alert" className="text-sm text-destructive">
              {toUserMessage(health.error)}
            </p>
          )}
          {health.data && <HealthChecklist report={health.data} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Application</CardTitle>
          <CardDescription>Version and runtime details for support.</CardDescription>
        </CardHeader>
        <CardContent>
          {info.isPending && <Skeleton className="h-32 w-full" />}
          {info.data && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" data-selectable>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{info.data.name}</dd>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-medium">{info.data.version}</dd>
              <dt className="text-muted-foreground">Environment</dt>
              <dd className="font-medium">{info.data.env}</dd>
              <dt className="text-muted-foreground">Platform</dt>
              <dd className="font-medium">
                {info.data.platform} ({info.data.arch})
              </dd>
              <dt className="text-muted-foreground">Electron</dt>
              <dd className="font-medium">{info.data.electronVersion}</dd>
              <dt className="text-muted-foreground">Chromium</dt>
              <dd className="font-medium">{info.data.chromeVersion}</dd>
              <dt className="text-muted-foreground">Node.js</dt>
              <dd className="font-medium">{info.data.nodeVersion}</dd>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
