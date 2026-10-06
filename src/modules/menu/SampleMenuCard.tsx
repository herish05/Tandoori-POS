import { useMutation, useQuery } from '@tanstack/react-query'
import { FlaskConical, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toUserMessage } from '@/lib/ipc'
import { demoMenuService } from '@/services/menu.service'
import { MENU_KEYS, useRefreshMenu } from './hooks'

/**
 * Lets an admin try the app with a sample menu. Sample rows are flagged and kept apart from
 * the real menu; this card never appears in a production build.
 */
export function SampleMenuCard({ menuIsEmpty }: { menuIsEmpty: boolean }) {
  const refresh = useRefreshMenu()
  const status = useQuery({ queryKey: MENU_KEYS.demo, queryFn: demoMenuService.status })
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<string | undefined>()

  const load = useMutation({
    mutationFn: demoMenuService.load,
    onSuccess: async () => {
      setNotice(undefined)
      await refresh()
    }
  })
  const remove = useMutation({
    mutationFn: demoMenuService.remove,
    onSuccess: async (result) => {
      setConfirming(false)
      setNotice(
        result.keptAsReal > 0
          ? `Sample items removed. ${String(result.keptAsReal)} sample categories, stations or tax categories are now used by your own items, so they were kept as real data.`
          : 'Sample items removed.'
      )
      await refresh()
    }
  })

  const data = status.data
  if (!data?.available) return null
  if (!data.loaded && !menuIsEmpty) return null

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <FlaskConical className="size-6 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-60 flex-1 space-y-1 text-sm">
          {data.loaded ? (
            <>
              <p className="font-semibold">
                A sample menu is loaded ({data.itemCount} items), for trying things out.
              </p>
              <p className="text-muted-foreground">
                It is kept apart from your real menu and can be removed at any time. Items you add
                yourself are never removed.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Want to try the app with a sample menu?</p>
              <p className="text-muted-foreground">
                Loads example categories, items, variants and add-ons so you can explore. Only
                offered in test builds, and only while your menu is empty.
              </p>
            </>
          )}
          {notice && <p className="font-medium text-foreground">{notice}</p>}
          {load.isError && (
            <p role="alert" className="font-medium text-destructive">
              {toUserMessage(load.error)}
            </p>
          )}
        </div>
        {data.loaded ? (
          <Button
            variant="outline"
            onClick={() => {
              remove.reset()
              setConfirming(true)
            }}
          >
            Remove sample data
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={load.isPending}
            onClick={() => {
              load.mutate()
            }}
          >
            {load.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Load sample menu
          </Button>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirming}
        title="Remove sample data"
        message="Remove all sample items, add-ons and the sample categories, stations and tax categories nobody else uses? Your own menu is not touched."
        confirmLabel="Remove sample data"
        destructive
        pending={remove.isPending}
        error={remove.isError ? toUserMessage(remove.error) : undefined}
        onConfirm={() => {
          remove.mutate()
        }}
        onClose={() => {
          setConfirming(false)
        }}
      />
    </Card>
  )
}
