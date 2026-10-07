import type {
  CreateInventoryItemInput,
  InventoryFilterInput,
  InventoryItem,
  InventorySummary,
  MovementFilterInput,
  Recipe,
  RecipeCoverage,
  SetInventoryItemActiveInput,
  SetRecipeInput,
  StockCountInput,
  StockInInput,
  StockMovement,
  UpdateInventoryItemInput,
  WastageInput
} from '@shared/inventory'
import { getApi, unwrap } from '@/lib/ipc'

export const inventoryService = {
  summary: (): Promise<InventorySummary> => unwrap(getApi().inventory.summary()),
  list: (filter: InventoryFilterInput = {}): Promise<InventoryItem[]> =>
    unwrap(getApi().inventory.list(filter)),
  create: (input: CreateInventoryItemInput): Promise<InventoryItem> =>
    unwrap(getApi().inventory.create(input)),
  update: (input: UpdateInventoryItemInput): Promise<InventoryItem> =>
    unwrap(getApi().inventory.update(input)),
  setActive: (input: SetInventoryItemActiveInput): Promise<InventoryItem> =>
    unwrap(getApi().inventory.setActive(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().inventory.delete(id)),
  stockIn: (input: StockInInput): Promise<InventoryItem> =>
    unwrap(getApi().inventory.stockIn(input)),
  wastage: (input: WastageInput): Promise<InventoryItem> =>
    unwrap(getApi().inventory.wastage(input)),
  count: (input: StockCountInput): Promise<InventoryItem> =>
    unwrap(getApi().inventory.count(input)),
  movements: (filter: MovementFilterInput = {}): Promise<StockMovement[]> =>
    unwrap(getApi().inventory.movements(filter))
}

export const recipeService = {
  coverage: (): Promise<RecipeCoverage[]> => unwrap(getApi().recipes.coverage()),
  get: (menuItemId: string): Promise<Recipe> => unwrap(getApi().recipes.get(menuItemId)),
  set: (input: SetRecipeInput): Promise<Recipe> => unwrap(getApi().recipes.set(input))
}
