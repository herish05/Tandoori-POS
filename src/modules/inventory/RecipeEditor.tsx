import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  UNIT_LABELS,
  costOfQuantity,
  formatQuantity,
  parseQuantity,
  setRecipeInputSchema,
  type InventoryItem,
  type RecipeScope
} from '@shared/inventory'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { inventoryService, recipeService } from '@/services/inventory.service'
import { INVENTORY_KEYS, useRefreshInventory } from './hooks'

interface RecipeEditorProps {
  menuItemId: string
  canManage: boolean
}

/** The recipe of one menu item: a tab per size, and the ingredient list of the chosen one. */
export function RecipeEditor({ menuItemId, canManage }: RecipeEditorProps) {
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  const recipe = useQuery({
    queryKey: INVENTORY_KEYS.recipe(menuItemId),
    queryFn: () => recipeService.get(menuItemId),
    staleTime: 0
  })
  const ingredients = useQuery({
    queryKey: INVENTORY_KEYS.list({ purpose: 'ingredients' }),
    queryFn: () => inventoryService.list({}),
    staleTime: 0
  })

  if (recipe.isPending || ingredients.isPending) return <Skeleton className="h-48 w-full" />
  if (recipe.isError || ingredients.isError) {
    return (
      <p role="alert" className="text-sm font-medium text-destructive">
        {toUserMessage(recipe.error ?? ingredients.error)}
      </p>
    )
  }

  const scopes = recipe.data.scopes
  const scope = scopes.find((entry) => entry.variantId === (chosen ?? null)) ?? scopes[0]
  const sized = scopes.length > 1

  return (
    <div className="space-y-4" data-testid="recipe-editor">
      <h3 className="text-lg font-bold">{recipe.data.itemName}</h3>
      {sized && (
        <div role="tablist" aria-label="Size" className="flex flex-wrap gap-1">
          {scopes.map((entry) => {
            const active = entry.variantId === (scope?.variantId ?? null)
            return (
              <button
                key={entry.variantId ?? 'shared'}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setChosen(entry.variantId)
                }}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'
                }`}
              >
                {entry.variantName ?? 'All sizes'}
                {entry.lines.length > 0 && ` (${String(entry.lines.length)})`}
              </button>
            )
          })}
        </div>
      )}
      {scope && (
        <ScopeEditor
          // A saved recipe arrives as new data, which starts the editor afresh.
          key={`${menuItemId}:${scope.variantId ?? 'shared'}:${JSON.stringify(scope.lines.map((l) => [l.inventoryItemId, l.quantity]))}`}
          menuItemId={menuItemId}
          scope={scope}
          sizeHint={sized && scope.variantId !== null}
          ingredients={ingredients.data.filter((entry) => entry.isActive)}
          canManage={canManage}
        />
      )}
    </div>
  )
}

type Ingredient = Pick<InventoryItem, 'id' | 'name' | 'unit' | 'unitCost'>

interface Row {
  inventoryItemId: string
  quantity: string
}

interface ScopeEditorProps {
  menuItemId: string
  scope: RecipeScope
  sizeHint: boolean
  ingredients: InventoryItem[]
  canManage: boolean
}

function ScopeEditor({ menuItemId, scope, sizeHint, ingredients, canManage }: ScopeEditorProps) {
  const refresh = useRefreshInventory()
  const [rows, setRows] = useState<Row[]>(
    scope.lines.map((line) => ({
      inventoryItemId: line.inventoryItemId,
      quantity: formatQuantity(line.quantity)
    }))
  )
  const [adding, setAdding] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: recipeService.set,
    onSuccess: async () => {
      await refresh()
    }
  })

  const byId = new Map<string, Ingredient>(ingredients.map((entry) => [entry.id, entry]))
  // Items already in the recipe stay selectable even if they were retired since.
  for (const line of scope.lines) {
    if (!byId.has(line.inventoryItemId)) {
      byId.set(line.inventoryItemId, {
        id: line.inventoryItemId,
        name: line.itemName,
        unit: line.unit,
        unitCost: line.quantity === 0 ? 0 : Math.round((line.cost * 1000) / line.quantity)
      })
    }
  }
  const available = ingredients.filter(
    (entry) => !rows.some((row) => row.inventoryItemId === entry.id)
  )

  const costOf = (row: Row): number => {
    const stock = byId.get(row.inventoryItemId)
    const milli = parseQuantity(row.quantity)
    return stock && milli !== null ? costOfQuantity(milli, stock.unitCost) : 0
  }
  const totalCost = rows.reduce((sum, row) => sum + costOf(row), 0)
  const margin = scope.price - totalCost

  const submit = (): void => {
    const lines: { inventoryItemId: string; quantity: number }[] = []
    for (const row of rows) {
      const quantity = parseQuantity(row.quantity)
      if (quantity === null || quantity < 1) {
        setProblem(
          `Enter a quantity above zero for ${byId.get(row.inventoryItemId)?.name ?? 'each ingredient'}.`
        )
        return
      }
      lines.push({ inventoryItemId: row.inventoryItemId, quantity })
    }
    const parsed = setRecipeInputSchema.safeParse({ menuItemId, variantId: scope.variantId, lines })
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the recipe.')
      return
    }
    setProblem(null)
    save.mutate(parsed.data)
  }

  const changed =
    JSON.stringify(rows.map((r) => [r.inventoryItemId, parseQuantity(r.quantity)])) !==
    JSON.stringify(scope.lines.map((l) => [l.inventoryItemId, l.quantity]))

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {sizeHint
          ? 'What one portion of this size uses. Leave it empty to use the "All sizes" recipe.'
          : 'What one portion uses. Stock is taken out when the order is sent to the kitchen.'}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          No ingredients yet. This item does not use up any stock.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Ingredient</th>
                <th className="px-3 py-2">Quantity per portion</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, index) => {
                const stock = byId.get(row.inventoryItemId)
                return (
                  <tr key={row.inventoryItemId}>
                    <td className="px-3 py-2 font-medium">{stock?.name ?? 'Unknown'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Input
                          className="w-28"
                          inputMode="decimal"
                          aria-label={`Quantity of ${stock?.name ?? 'ingredient'}`}
                          disabled={!canManage}
                          value={row.quantity}
                          onChange={(event) => {
                            setRows((current) =>
                              current.map((entry, at) =>
                                at === index ? { ...entry, quantity: event.target.value } : entry
                              )
                            )
                          }}
                        />
                        <span className="text-muted-foreground">
                          {stock ? UNIT_LABELS[stock.unit] : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{formatMoney(costOf(row))}</td>
                    <td className="px-3 py-2 text-right">
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${stock?.name ?? 'ingredient'}`}
                          onClick={() => {
                            setRows((current) => current.filter((_, at) => at !== index))
                          }}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <div className="flex items-center gap-2">
          <Select
            className="max-w-xs"
            aria-label="Add an ingredient"
            value={adding}
            onChange={(event) => {
              setAdding(event.target.value)
            }}
          >
            <option value="">Add an ingredient...</option>
            {available.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ({UNIT_LABELS[entry.unit]})
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            disabled={adding === ''}
            onClick={() => {
              setRows((current) => [...current, { inventoryItemId: adding, quantity: '' }])
              setAdding('')
            }}
          >
            <Plus /> Add
          </Button>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-3 rounded-md bg-secondary/40 p-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Selling price</dt>
          <dd className="font-semibold">{formatMoney(scope.price)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Ingredient cost</dt>
          <dd className="font-semibold">{formatMoney(totalCost)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Left after ingredients</dt>
          <dd className={margin < 0 ? 'font-semibold text-destructive' : 'font-semibold'}>
            {formatMoney(margin)}
            {scope.price > 0 && totalCost > 0 && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({String(Math.round((margin / scope.price) * 100))}%)
              </span>
            )}
          </dd>
        </div>
      </dl>

      {(problem ?? save.error) && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {problem ?? toUserMessage(save.error)}
        </p>
      )}
      {canManage && (
        <div className="flex justify-end">
          <Button disabled={save.isPending || !changed} onClick={submit}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Save recipe
          </Button>
        </div>
      )}
    </div>
  )
}
