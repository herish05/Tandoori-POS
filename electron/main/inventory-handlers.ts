import { IPC_CHANNELS } from '@shared/ipc-channels'
import { idInputSchema } from '@shared/auth-schemas'
import {
  createInventoryItemInputSchema,
  inventoryFilterSchema,
  movementFilterSchema,
  recipeGetInputSchema,
  setInventoryItemActiveInputSchema,
  setRecipeInputSchema,
  stockCountInputSchema,
  stockInInputSchema,
  updateInventoryItemInputSchema,
  wastageInputSchema
} from '@shared/inventory'
import { emptyInputSchema } from '@shared/schemas'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

const VIEW = { permissions: ['inventory.view'] } as const
const MANAGE = { permissions: ['inventory.manage'] } as const
const OPERATE = { permissions: ['inventory.operate'] } as const

/** Stock handlers: items, the ledger, stock in/wastage/counts and recipes. */
export function registerInventoryHandlers(registrar: IpcRegistrar, services: Services): void {
  const { inventory, recipes } = services

  registrar.handleProtected(IPC_CHANNELS.inventorySummary, emptyInputSchema, VIEW, () =>
    inventory.summary()
  )
  registrar.handleProtected(IPC_CHANNELS.inventoryList, inventoryFilterSchema, VIEW, (input) =>
    inventory.list(input)
  )
  registrar.handleProtected(IPC_CHANNELS.inventoryMovements, movementFilterSchema, VIEW, (input) =>
    inventory.movements(input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.inventoryCreate,
    createInventoryItemInputSchema,
    MANAGE,
    (input, ctx) => inventory.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.inventoryUpdate,
    updateInventoryItemInputSchema,
    MANAGE,
    (input, ctx) => inventory.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.inventorySetActive,
    setInventoryItemActiveInputSchema,
    MANAGE,
    (input, ctx) => inventory.setActive(ctx, input)
  )
  registrar.handleProtected(IPC_CHANNELS.inventoryDelete, idInputSchema, MANAGE, (input, ctx) =>
    inventory.delete(ctx, input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.inventoryStockIn,
    stockInInputSchema,
    OPERATE,
    (input, ctx) => inventory.stockIn(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.inventoryWastage,
    wastageInputSchema,
    OPERATE,
    (input, ctx) => inventory.wastage(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.inventoryCount,
    stockCountInputSchema,
    OPERATE,
    (input, ctx) => inventory.count(ctx, input)
  )

  registrar.handleProtected(IPC_CHANNELS.recipesCoverage, emptyInputSchema, VIEW, () =>
    recipes.coverage()
  )
  registrar.handleProtected(IPC_CHANNELS.recipesGet, recipeGetInputSchema, VIEW, (input) =>
    recipes.get(input.menuItemId)
  )
  registrar.handleProtected(IPC_CHANNELS.recipesSet, setRecipeInputSchema, MANAGE, (input, ctx) =>
    recipes.set(ctx, input)
  )
}
