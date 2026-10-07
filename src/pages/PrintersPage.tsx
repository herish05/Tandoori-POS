import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  createPrinterInputSchema,
  PAPER_WIDTHS,
  PRINTER_KIND_LABELS,
  PRINTER_KINDS,
  updatePrinterInputSchema,
  type PaperWidth,
  type PrinterConfig,
  type PrinterKind,
  type PrinterTestOutcome
} from '@shared/kitchen'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { KOT_KEYS } from '@/modules/kitchen/hooks'
import { stationService } from '@/services/menu.service'
import { printerService } from '@/services/kitchen.service'
import { usePermission } from '@/stores/auth.store'
import { MENU_KEYS } from '@/modules/menu/hooks'

function PrinterForm({ printer, onClose }: { printer: PrinterConfig | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const canSeeStations = usePermission('menu.view')
  const [name, setName] = useState(printer?.name ?? '')
  const [kind, setKind] = useState<PrinterKind>(printer?.kind ?? 'NETWORK')
  const [address, setAddress] = useState(printer?.address ?? '')
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(printer?.paperWidth ?? 80)
  const [stationId, setStationId] = useState(printer?.stationId ?? '')
  const [isDefault, setIsDefault] = useState(printer?.isDefault ?? false)
  const [isActive, setIsActive] = useState(printer?.isActive ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const stations = useQuery({
    queryKey: MENU_KEYS.stations,
    queryFn: stationService.list,
    enabled: canSeeStations,
    staleTime: 15_000
  })
  const devices = useQuery({
    queryKey: KOT_KEYS.systemDevices,
    queryFn: printerService.systemDevices,
    enabled: kind === 'SYSTEM',
    staleTime: 0,
    retry: false
  })

  const payload = {
    name,
    kind,
    address,
    paperWidth,
    stationId: stationId === '' ? null : stationId,
    isDefault: stationId === '' ? isDefault : false,
    isActive
  }
  const save = useMutation({
    mutationFn: (): Promise<PrinterConfig> =>
      printer
        ? printerService.update({ id: printer.id, ...payload })
        : printerService.create(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['printers'] })
      onClose()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = printer
      ? updatePrinterInputSchema.safeParse({ id: printer.id, ...payload })
      : createPrinterInputSchema.safeParse(payload)
    if (!result.success) {
      setErrors(fieldErrors(result.error))
      return
    }
    setErrors({})
    save.mutate()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Printer name" required error={errors.name} hint="For example Kitchen or Bar.">
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
      <Field label="Type" required error={errors.kind}>
        {(c) => (
          <Select
            {...c}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value === 'SYSTEM' ? 'SYSTEM' : 'NETWORK')
              setAddress('')
            }}
          >
            {PRINTER_KINDS.map((entry) => (
              <option key={entry} value={entry}>
                {PRINTER_KIND_LABELS[entry]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={kind === 'NETWORK' ? 'Address' : 'Printer on this computer'}
        required
        error={errors.address}
        hint={
          kind === 'NETWORK'
            ? 'IP address or host name of the printer, for example 192.168.1.50 (port 9100 is used unless you add :port).'
            : 'The name this computer uses for the printer.'
        }
      >
        {(c) =>
          kind === 'SYSTEM' && devices.data && devices.data.length > 0 ? (
            <Select
              {...c}
              value={address}
              onChange={(event) => {
                setAddress(event.target.value)
              }}
            >
              <option value="">Choose a printer</option>
              {devices.data.map((device) => (
                <option key={device} value={device}>
                  {device}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              {...c}
              value={address}
              onChange={(event) => {
                setAddress(event.target.value)
              }}
            />
          )
        }
      </Field>
      <Field label="Paper width" required error={errors.paperWidth}>
        {(c) => (
          <Select
            {...c}
            value={String(paperWidth)}
            onChange={(event) => {
              setPaperWidth(event.target.value === '58' ? 58 : 80)
            }}
          >
            {PAPER_WIDTHS.map((width) => (
              <option key={width} value={width}>
                {width} mm
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Prints tickets for"
        error={errors.stationId}
        hint="Choose a station, or leave on the default to print every ticket no other printer handles."
      >
        {(c) => (
          <Select
            {...c}
            value={stationId}
            disabled={!canSeeStations}
            onChange={(event) => {
              setStationId(event.target.value)
            }}
          >
            <option value="">Any station without its own printer</option>
            {stations.data?.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={stationId === '' && isDefault}
            disabled={stationId !== ''}
            onChange={(event) => {
              setIsDefault(event.target.checked)
            }}
          />
          Default printer
        </label>
        {errors.isDefault && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {errors.isDefault}
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => {
              setIsActive(event.target.checked)
            }}
          />
          In use
        </label>
      </div>
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
          {printer ? 'Save changes' : 'Add printer'}
        </Button>
      </div>
    </form>
  )
}

/** Admin: the printers that print kitchen tickets, with a test page for each. */
export function PrintersPage() {
  const queryClient = useQueryClient()
  const canManage = usePermission('printers.manage')
  const [editing, setEditing] = useState<PrinterConfig | 'new' | null>(null)
  const [deleting, setDeleting] = useState<PrinterConfig | null>(null)
  const [tests, setTests] = useState<Record<string, PrinterTestOutcome>>({})

  const printers = useQuery({
    queryKey: KOT_KEYS.printers,
    queryFn: printerService.list,
    staleTime: 0
  })
  const test = useMutation({
    mutationFn: async (printer: PrinterConfig) => ({
      id: printer.id,
      outcome: await printerService.test(printer.id)
    }),
    onSuccess: ({ id, outcome }) => {
      setTests((current) => ({ ...current, [id]: outcome }))
    }
  })
  const remove = useMutation({
    mutationFn: (printer: PrinterConfig) => printerService.remove(printer.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['printers'] })
      setDeleting(null)
    }
  })

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Printers</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Kitchen tickets print on the printer of their station, or on the default printer. When
            no printer can be reached, the ticket is shown on screen so it can still be printed, and
            the problem is recorded in the audit log.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setEditing('new')
            }}
          >
            <Plus /> Add printer
          </Button>
        )}
      </div>

      {printers.isPending && <Skeleton className="h-40" />}
      {printers.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(printers.error)}
        </p>
      )}
      {printers.data?.length === 0 && (
        <p className="rounded-lg border border-dashed bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">
          No printers yet. Without one, tickets are shown on screen and can be printed from this
          computer.
        </p>
      )}
      {printers.data && printers.data.length > 0 && (
        <ul className="divide-y rounded-lg border bg-card" aria-label="Printers">
          {printers.data.map((printer) => {
            const result = tests[printer.id]
            return (
              <li
                key={printer.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
                data-testid="printer-row"
              >
                <Printer className="size-5 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {printer.name} {printer.isDefault && <Badge variant="default">Default</Badge>}{' '}
                    {!printer.isActive && <Badge variant="secondary">Not in use</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {PRINTER_KIND_LABELS[printer.kind]} · {printer.address} · {printer.paperWidth}{' '}
                    mm · {printer.stationName ?? 'any station without its own printer'}
                  </p>
                  {result?.status === 'PRINTED' && (
                    <p role="status" className="text-xs font-medium text-success">
                      Test page sent.
                    </p>
                  )}
                  {result?.status === 'FAILED' && (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      Test failed: {result.error}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={test.isPending}
                      onClick={() => {
                        test.mutate(printer)
                      }}
                    >
                      {test.isPending && test.variables.id === printer.id && (
                        <Loader2 className="animate-spin" aria-hidden />
                      )}
                      Print test page
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${printer.name}`}
                      onClick={() => {
                        setEditing(printer)
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${printer.name}`}
                      onClick={() => {
                        remove.reset()
                        setDeleting(printer)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {test.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(test.error)}
        </p>
      )}

      <Dialog
        open={editing !== null}
        title={editing === 'new' || editing === null ? 'Add printer' : `Edit ${editing.name}`}
        onClose={() => {
          setEditing(null)
        }}
      >
        {editing !== null && (
          <PrinterForm
            printer={editing === 'new' ? null : editing}
            onClose={() => {
              setEditing(null)
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `Delete ${deleting.name}?` : 'Delete printer?'}
        message="Tickets for its station will print on the default printer instead. Tickets already printed are not affected."
        confirmLabel="Delete printer"
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
