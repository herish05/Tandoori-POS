import { useMutation, useQuery } from '@tanstack/react-query'
import { Eye, Printer } from 'lucide-react'
import { useState } from 'react'
import {
  KOT_PRINT_STATUS_LABELS,
  KOT_STATUS_LABELS,
  KOT_STATUSES,
  type KotStatus
} from '@shared/kitchen'
import { ORDER_TYPE_LABELS } from '@shared/orders'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/ipc'
import { KOT_KEYS, useRefreshKots } from '@/modules/kitchen/hooks'
import { KOT_PRINT_TONE, KOT_STATUS_TONE } from '@/modules/kitchen/kot-status'
import { KotPreviewDialog } from '@/modules/kitchen/KotPreviewDialog'
import { useDebouncedValue } from '@/modules/menu/hooks'
import { kotService } from '@/services/kitchen.service'
import { usePermission } from '@/stores/auth.store'

/** Admin: the history of kitchen tickets, newest first, with a preview and reprint for each. */
export function KotsPage() {
  const canKitchen = usePermission('kitchen.operate')
  const canOrders = usePermission('orders.operate')
  const canPrint = canKitchen || canOrders
  const refresh = useRefreshKots()
  const [status, setStatus] = useState<KotStatus | ''>('')
  const [search, setSearch] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewNotice, setPreviewNotice] = useState<string | null>(null)
  const debounced = useDebouncedValue(search.trim())

  const filter = {
    ...(status ? { statuses: [status] } : {}),
    ...(debounced ? { search: debounced } : {}),
    limit: 200
  }
  const tickets = useQuery({
    queryKey: KOT_KEYS.list(filter),
    queryFn: () => kotService.list(filter),
    staleTime: 0,
    refetchInterval: 10_000
  })
  const reprint = useMutation({
    mutationFn: (id: string) => kotService.print(id),
    onSuccess: async (result) => {
      await refresh()
      if (result.status === 'FAILED') {
        setPreviewNotice(result.error)
        setPreviewId(result.kotId)
      }
    }
  })

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">Kitchen tickets</h2>
        <p className="text-sm text-muted-foreground">
          Every kitchen order ticket (KOT) that was issued. Printed tickets are never changed; later
          items get an additional ticket.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-xs font-medium">
          Search
          <Input
            className="w-56"
            placeholder="Ticket or order number"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          Status
          <Select
            className="w-44"
            value={status}
            onChange={(event) => {
              const next = KOT_STATUSES.find((entry) => entry === event.target.value)
              setStatus(next ?? '')
            }}
          >
            <option value="">Any status</option>
            {KOT_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {KOT_STATUS_LABELS[entry]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {tickets.isPending && <Skeleton className="h-48" />}
      {tickets.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(tickets.error)}
        </p>
      )}
      {tickets.data?.length === 0 && (
        <p className="rounded-lg border border-dashed bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">
          No tickets match. Tickets appear here when an order is sent to the kitchen.
        </p>
      )}
      {tickets.data && tickets.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Station</th>
                <th className="px-3 py-2">Items</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Printing</th>
                <th className="px-3 py-2">Issued</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {tickets.data.map((kot) => (
                <tr key={kot.id} data-testid="kot-row">
                  <td className="px-3 py-2 font-semibold">
                    {kot.kotNumber}
                    {kot.isAdditional && (
                      <Badge variant="outline" className="ml-2">
                        Additional
                      </Badge>
                    )}
                    {kot.revision > 0 && (
                      <Badge variant="warning" className="ml-2">
                        Revised
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {kot.orderNumber}
                    <span className="block text-xs text-muted-foreground">
                      {kot.orderType === 'DINE_IN'
                        ? (kot.tableName ?? kot.tableNumber)
                        : ORDER_TYPE_LABELS[kot.orderType]}
                    </span>
                  </td>
                  <td className="px-3 py-2">{kot.stationName}</td>
                  <td className="px-3 py-2">{kot.itemCount}</td>
                  <td className="px-3 py-2">
                    <Badge variant={KOT_STATUS_TONE[kot.status]}>
                      {KOT_STATUS_LABELS[kot.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={KOT_PRINT_TONE[kot.printStatus]}>
                      {KOT_PRINT_STATUS_LABELS[kot.printStatus]}
                    </Badge>
                    {kot.printCount > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">×{kot.printCount}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDateTime(kot.createdAt)}
                    <span className="block">{kot.createdByName}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPreviewNotice(null)
                          setPreviewId(kot.id)
                        }}
                      >
                        <Eye /> View
                      </Button>
                      {canPrint && kot.status !== 'CANCELLED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={reprint.isPending}
                          onClick={() => {
                            reprint.mutate(kot.id)
                          }}
                        >
                          <Printer /> Reprint
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reprint.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(reprint.error)}
        </p>
      )}

      <KotPreviewDialog
        kotId={previewId}
        notice={previewNotice}
        canPrint={canPrint}
        onClose={() => {
          setPreviewId(null)
        }}
      />
    </div>
  )
}
