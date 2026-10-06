import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  ADDON_KIND_LABELS,
  createItemInputSchema,
  FOOD_TYPE_LABELS,
  FOOD_TYPES,
  MAX_VARIANTS,
  updateItemInputSchema,
  type FoodType,
  type MenuItem
} from '@shared/menu'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney, paiseToInput, parseOptionalRupees, parseRupees } from '@/lib/money'
import {
  addonService,
  categoryService,
  itemService,
  stationService,
  taxCategoryService
} from '@/services/menu.service'
import { MENU_KEYS, useRefreshMenu } from './hooks'
import { ImageField } from './ImageField'

interface VariantRow {
  key: string
  id?: string
  name: string
  price: string
  costPrice: string
  isDefault: boolean
  isAvailable: boolean
}

const checkboxClass = 'size-4 accent-[hsl(var(--primary))]'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-md border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

interface ItemFormProps {
  item: MenuItem | null
  /** Category pre-selected for a new item (the one currently filtered). */
  defaultCategoryId?: string
  onClose: () => void
}

/** Create or edit one menu item with its variants, add-ons, station and tax category. */
export function ItemForm({ item, defaultCategoryId, onClose }: ItemFormProps) {
  const refresh = useRefreshMenu()
  const categories = useQuery({ queryKey: MENU_KEYS.categories, queryFn: categoryService.list })
  const stations = useQuery({ queryKey: MENU_KEYS.stations, queryFn: stationService.list })
  const taxes = useQuery({ queryKey: MENU_KEYS.taxCategories, queryFn: taxCategoryService.list })
  const addons = useQuery({ queryKey: MENU_KEYS.addons, queryFn: addonService.list })

  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? defaultCategoryId ?? '')
  const [foodType, setFoodType] = useState<FoodType>(item?.foodType ?? 'VEG')
  const [price, setPrice] = useState(item ? paiseToInput(item.price) : '')
  const [costPrice, setCostPrice] = useState(item ? paiseToInput(item.costPrice) : '')
  const [image, setImage] = useState<string | null>(item?.image ?? null)
  const [isAvailable, setIsAvailable] = useState(item?.isAvailable ?? true)
  const [isBestSeller, setIsBestSeller] = useState(item?.isBestSeller ?? false)
  const [stationId, setStationId] = useState(item?.stationId ?? '')
  const [taxCategoryId, setTaxCategoryId] = useState(item?.taxCategoryId ?? '')
  const [addonIds, setAddonIds] = useState<string[]>(item?.addons.map((addon) => addon.id) ?? [])
  const [variants, setVariants] = useState<VariantRow[]>(
    item?.variants.map((variant) => ({
      key: variant.id,
      id: variant.id,
      name: variant.name,
      price: paiseToInput(variant.price),
      costPrice: paiseToInput(variant.costPrice),
      isDefault: variant.isDefault,
      isAvailable: variant.isAvailable
    })) ?? []
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const hasVariants = variants.length > 0
  const defaultVariant = variants.find((variant) => variant.isDefault) ?? variants[0]

  const payload = {
    name,
    description,
    categoryId,
    price: defaultVariant ? parseRupees(defaultVariant.price) : parseRupees(price),
    costPrice: defaultVariant
      ? parseOptionalRupees(defaultVariant.costPrice)
      : parseOptionalRupees(costPrice),
    foodType,
    image,
    isAvailable,
    isBestSeller,
    stationId: stationId === '' ? null : stationId,
    taxCategoryId: taxCategoryId === '' ? null : taxCategoryId,
    addonIds,
    variants: variants.map((variant) => ({
      ...(variant.id ? { id: variant.id } : {}),
      name: variant.name,
      price: parseRupees(variant.price),
      costPrice: parseOptionalRupees(variant.costPrice),
      isDefault: variant.isDefault,
      isAvailable: variant.isAvailable
    }))
  }

  const save = useMutation({
    mutationFn: (): Promise<MenuItem> =>
      item ? itemService.update({ id: item.id, ...payload }) : itemService.create(payload),
    onSuccess: async () => {
      await refresh()
      onClose()
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const result = item
      ? updateItemInputSchema.safeParse({ id: item.id, ...payload })
      : createItemInputSchema.safeParse(payload)
    if (!result.success) {
      setErrors(fieldErrors(result.error))
      return
    }
    setErrors({})
    save.mutate()
  }

  const updateVariant = (key: string, patch: Partial<VariantRow>): void => {
    setVariants((current) =>
      current.map((variant) => (variant.key === key ? { ...variant, ...patch } : variant))
    )
  }
  const makeDefault = (key: string): void => {
    setVariants((current) =>
      current.map((variant) => ({ ...variant, isDefault: variant.key === key }))
    )
  }
  const addVariant = (): void => {
    setVariants((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        name: '',
        // The first variant starts from the price already typed for the item.
        price: current.length === 0 ? price : '',
        costPrice: current.length === 0 ? costPrice : '',
        isDefault: current.length === 0,
        isAvailable: true
      }
    ])
  }
  const removeVariant = (key: string): void => {
    setVariants((current) => {
      const rest = current.filter((variant) => variant.key !== key)
      const [first] = rest
      return first && !rest.some((variant) => variant.isDefault)
        ? rest.map((variant) => ({ ...variant, isDefault: variant.key === first.key }))
        : rest
    })
  }

  const activeCategories = (categories.data ?? []).filter(
    (category) => category.isActive || category.id === item?.categoryId
  )
  const chosenCategory = (categories.data ?? []).find((category) => category.id === categoryId)
  const stationChoices = (stations.data ?? []).filter(
    (station) => station.isActive || station.id === item?.stationId
  )
  const taxChoices = (taxes.data ?? []).filter(
    (tax) => tax.isActive || tax.id === item?.taxCategoryId
  )
  const addonChoices = (addons.data ?? []).filter(
    (addon) => addon.isActive || addonIds.includes(addon.id)
  )

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Item name" required error={errors.name}>
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
          <Field
            label="Category"
            required
            error={errors.categoryId}
            hint={
              categories.data?.length === 0
                ? 'Add a category first, in the Categories tab.'
                : undefined
            }
          >
            {(c) => (
              <Select
                {...c}
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value)
                }}
              >
                <option value="">Choose a category</option>
                {activeCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
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
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Type</legend>
          <div className="flex flex-wrap gap-4">
            {FOOD_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="food-type"
                  className={checkboxClass}
                  checked={foodType === type}
                  onChange={() => {
                    setFoodType(type)
                  }}
                />
                {FOOD_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
          {errors.foodType && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {errors.foodType}
            </p>
          )}
        </fieldset>
        <ImageField value={image} onChange={setImage} error={errors.image} />
      </Section>

      <Section title="Price">
        {hasVariants ? (
          <p className="text-sm text-muted-foreground">
            This item has variants, so each variant carries its own price. The item shows the price
            of the default variant
            {defaultVariant && !Number.isNaN(parseRupees(defaultVariant.price))
              ? ` (${formatMoney(parseRupees(defaultVariant.price))})`
              : ''}
            .
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Price (₹)" required error={errors.price}>
              {(c) => (
                <Input
                  {...c}
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => {
                    setPrice(event.target.value)
                  }}
                />
              )}
            </Field>
            <Field
              label="Cost price (₹)"
              error={errors.costPrice}
              hint="What it costs you to make. Optional."
            >
              {(c) => (
                <Input
                  {...c}
                  inputMode="decimal"
                  value={costPrice}
                  onChange={(event) => {
                    setCostPrice(event.target.value)
                  }}
                />
              )}
            </Field>
          </div>
        )}

        <div className="space-y-2">
          {variants.map((variant, index) => (
            <div
              key={variant.key}
              className="grid items-start gap-2 rounded-md bg-secondary/40 p-2 sm:grid-cols-[1fr_7rem_7rem_auto_auto]"
            >
              <Field label="Variant" error={errors[`variants.${String(index)}.name`]}>
                {(c) => (
                  <Input
                    {...c}
                    placeholder="e.g. Half"
                    value={variant.name}
                    onChange={(event) => {
                      updateVariant(variant.key, { name: event.target.value })
                    }}
                  />
                )}
              </Field>
              <Field label="Price (₹)" error={errors[`variants.${String(index)}.price`]}>
                {(c) => (
                  <Input
                    {...c}
                    inputMode="decimal"
                    value={variant.price}
                    onChange={(event) => {
                      updateVariant(variant.key, { price: event.target.value })
                    }}
                  />
                )}
              </Field>
              <Field label="Cost (₹)" error={errors[`variants.${String(index)}.costPrice`]}>
                {(c) => (
                  <Input
                    {...c}
                    inputMode="decimal"
                    value={variant.costPrice}
                    onChange={(event) => {
                      updateVariant(variant.key, { costPrice: event.target.value })
                    }}
                  />
                )}
              </Field>
              <label className="flex items-center gap-2 pt-8 text-sm">
                <input
                  type="radio"
                  name="default-variant"
                  className={checkboxClass}
                  checked={variant.isDefault}
                  onChange={() => {
                    makeDefault(variant.key)
                  }}
                />
                Default
              </label>
              <Button
                variant="ghost"
                size="icon"
                className="mt-6"
                aria-label={`Remove variant ${variant.name || String(index + 1)}`}
                onClick={() => {
                  removeVariant(variant.key)
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {errors.variants && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {errors.variants}
            </p>
          )}
          {variants.length < MAX_VARIANTS && (
            <Button variant="outline" size="sm" onClick={addVariant}>
              <Plus /> Add variant (half, full, large...)
            </Button>
          )}
        </div>
      </Section>

      <Section title="Kitchen and tax">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Kitchen station"
            error={errors.stationId}
            hint="Leave as the category's station unless this item is prepared elsewhere."
          >
            {(c) => (
              <Select
                {...c}
                value={stationId}
                onChange={(event) => {
                  setStationId(event.target.value)
                }}
              >
                <option value="">
                  Same as category ({chosenCategory?.stationName ?? 'no station'})
                </option>
                {stationChoices.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                    {station.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tax category" error={errors.taxCategoryId}>
            {(c) => (
              <Select
                {...c}
                value={taxCategoryId}
                onChange={(event) => {
                  setTaxCategoryId(event.target.value)
                }}
              >
                <option value="">No tax category</option>
                {taxChoices.map((tax) => (
                  <option key={tax.id} value={tax.id}>
                    {tax.name}
                    {tax.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Section>

      {addonChoices.length > 0 && (
        <Section title="Add-ons and modifiers">
          <div className="grid gap-2 sm:grid-cols-2">
            {addonChoices.map((addon) => (
              <label key={addon.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={addonIds.includes(addon.id)}
                  onChange={(event) => {
                    setAddonIds((current) =>
                      event.target.checked
                        ? [...current, addon.id]
                        : current.filter((id) => id !== addon.id)
                    )
                  }}
                />
                <span>
                  {addon.name}
                  <span className="text-muted-foreground">
                    {' '}
                    · {ADDON_KIND_LABELS[addon.kind]}
                    {addon.kind === 'ADDON' ? ` ${formatMoney(addon.price)}` : ''}
                    {addon.isActive ? '' : ' (inactive)'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {errors.addonIds && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {errors.addonIds}
            </p>
          )}
        </Section>
      )}

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={isAvailable}
            onChange={(event) => {
              setIsAvailable(event.target.checked)
            }}
          />
          Available to order
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={isBestSeller}
            onChange={(event) => {
              setIsBestSeller(event.target.checked)
            }}
          />
          Best seller
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
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {item ? 'Save changes' : 'Add item'}
        </Button>
      </div>
    </form>
  )
}
