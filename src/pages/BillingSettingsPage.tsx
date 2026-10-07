import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import {
  MAX_SERVICE_CHARGE_BPS,
  ROUND_OFF_LABELS,
  ROUND_OFF_UNITS,
  TAX_MODE_LABELS,
  TAX_MODES,
  updateBillingSettingsInputSchema,
  type BillingSettings,
  type RoundOffUnit,
  type TaxMode
} from '@shared/billing'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import {
  bpsToInput,
  formatPercent,
  paiseToInput,
  parseOptionalRupees,
  parsePercentToBps
} from '@/lib/money'
import { BILL_KEYS } from '@/modules/billing/hooks'
import { billingSettingsService } from '@/services/billing.service'
import { usePermission } from '@/stores/auth.store'

const percentOrNaN = (text: string): number => (text.trim() === '' ? 0 : parsePercentToBps(text))

function SettingsForm({ settings }: { settings: BillingSettings }) {
  const queryClient = useQueryClient()
  const canManage = usePermission('billing.manage')
  const [taxMode, setTaxMode] = useState<TaxMode>(settings.taxMode)
  const [serviceCharge, setServiceCharge] = useState(bpsToInput(settings.serviceChargeBps))
  const [dineInOnly, setDineInOnly] = useState(settings.serviceChargeDineInOnly)
  const [taxable, setTaxable] = useState(settings.serviceChargeTaxable)
  const [roundOffUnit, setRoundOffUnit] = useState<RoundOffUnit>(settings.roundOffUnit)
  const [deliveryCharge, setDeliveryCharge] = useState(paiseToInput(settings.deliveryCharge))
  const [deliveryFreeAbove, setDeliveryFreeAbove] = useState(
    paiseToInput(settings.deliveryFreeAbove)
  )
  const [deliveryTax, setDeliveryTax] = useState(bpsToInput(settings.deliveryChargeTaxBps))
  const [packagingCharge, setPackagingCharge] = useState(paiseToInput(settings.packagingCharge))
  const [packagingTax, setPackagingTax] = useState(bpsToInput(settings.packagingChargeTaxBps))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [autoPrint, setAutoPrint] = useState(settings.autoPrintReceipt)
  const [savedAt, setSavedAt] = useState(false)

  const save = useMutation({
    mutationFn: billingSettingsService.update,
    onSuccess: (next) => {
      queryClient.setQueryData(BILL_KEYS.settings, next)
      setSavedAt(true)
    }
  })

  const submit = (): void => {
    const bps = serviceCharge.trim() === '' ? 0 : parsePercentToBps(serviceCharge)
    const parsed = updateBillingSettingsInputSchema.safeParse({
      taxMode,
      serviceChargeBps: Number.isNaN(bps) ? undefined : bps,
      serviceChargeDineInOnly: dineInOnly,
      serviceChargeTaxable: taxable,
      roundOffUnit,
      autoPrintReceipt: autoPrint,
      deliveryCharge: parseOptionalRupees(deliveryCharge),
      deliveryFreeAbove: parseOptionalRupees(deliveryFreeAbove),
      deliveryChargeTaxBps: percentOrNaN(deliveryTax),
      packagingCharge: parseOptionalRupees(packagingCharge),
      packagingChargeTaxBps: percentOrNaN(packagingTax)
    })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    setSavedAt(false)
    save.mutate(parsed.data)
  }

  return (
    <form
      className="max-w-xl space-y-5 rounded-lg border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Field
        label="GST on bills"
        hint="Each menu item carries its own GST rate; this chooses how it is shown."
      >
        {(control) => (
          <Select
            {...control}
            disabled={!canManage}
            value={taxMode}
            onChange={(event) => {
              setTaxMode(TAX_MODES.find((entry) => entry === event.target.value) ?? 'INTRA_STATE')
            }}
          >
            {TAX_MODES.map((entry) => (
              <option key={entry} value={entry}>
                {TAX_MODE_LABELS[entry]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label="Service charge (%)"
        hint={`Leave 0 for none. Up to ${formatPercent(MAX_SERVICE_CHARGE_BPS)}.`}
        error={errors.serviceChargeBps}
      >
        {(control) => (
          <Input
            {...control}
            className="w-32"
            inputMode="decimal"
            disabled={!canManage}
            value={serviceCharge}
            onChange={(event) => {
              setServiceCharge(event.target.value)
              setSavedAt(false)
            }}
          />
        )}
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={!canManage}
          checked={dineInOnly}
          onChange={(event) => {
            setDineInOnly(event.target.checked)
            setSavedAt(false)
          }}
        />
        Charge the service charge on dine-in orders only
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={!canManage}
          checked={taxable}
          onChange={(event) => {
            setTaxable(event.target.checked)
            setSavedAt(false)
          }}
        />
        Charge GST on the service charge
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={!canManage}
          checked={autoPrint}
          onChange={(event) => {
            setAutoPrint(event.target.checked)
            setSavedAt(false)
          }}
        />
        Print the receipt automatically after payment
      </label>

      <fieldset className="space-y-3 rounded-md border p-4">
        <legend className="px-1 text-sm font-semibold">Delivery and packaging</legend>
        <p className="text-xs text-muted-foreground">
          Flat charges added to delivery and takeaway bills. They are not discounted and carry no
          service charge. Leave 0 for none.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ['Delivery charge (Rs)', deliveryCharge, setDeliveryCharge, 'deliveryCharge'],
              [
                'Free delivery above (Rs)',
                deliveryFreeAbove,
                setDeliveryFreeAbove,
                'deliveryFreeAbove'
              ],
              ['GST on delivery (%)', deliveryTax, setDeliveryTax, 'deliveryChargeTaxBps'],
              ['Packaging charge (Rs)', packagingCharge, setPackagingCharge, 'packagingCharge'],
              ['GST on packaging (%)', packagingTax, setPackagingTax, 'packagingChargeTaxBps']
            ] as const
          ).map(([label, value, setter, key]) => (
            <Field key={key} label={label} error={errors[key]}>
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  disabled={!canManage}
                  value={value}
                  onChange={(event) => {
                    setter(event.target.value)
                    setSavedAt(false)
                  }}
                />
              )}
            </Field>
          ))}
        </div>
      </fieldset>

      <Field label="Round off the total">
        {(control) => (
          <Select
            {...control}
            disabled={!canManage}
            value={String(roundOffUnit)}
            onChange={(event) => {
              setRoundOffUnit(
                ROUND_OFF_UNITS.find((entry) => String(entry) === event.target.value) ?? 100
              )
              setSavedAt(false)
            }}
          >
            {ROUND_OFF_UNITS.map((entry) => (
              <option key={entry} value={entry}>
                {ROUND_OFF_LABELS[entry]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {save.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(save.error)}
        </p>
      )}
      {savedAt && (
        <p role="status" className="text-sm font-medium text-success">
          Saved. New bills use these settings; bills already generated keep theirs.
        </p>
      )}
      {canManage ? (
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Save settings
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          You can view these settings but not change them.
        </p>
      )}
    </form>
  )
}

/** Admin: how bills are calculated: GST split, service charge and round-off. */
export function BillingSettingsPage() {
  const settings = useQuery({
    queryKey: BILL_KEYS.settings,
    queryFn: billingSettingsService.get,
    staleTime: 0
  })
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">Billing settings</h2>
        <p className="text-sm text-muted-foreground">
          Menu prices are before tax. These settings decide how GST, the service charge and rounding
          are added to a bill when it is generated.
        </p>
      </div>
      {settings.isPending && <Skeleton className="h-72 max-w-xl" />}
      {settings.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(settings.error)}
        </p>
      )}
      {settings.isSuccess && <SettingsForm settings={settings.data} />}
    </div>
  )
}
