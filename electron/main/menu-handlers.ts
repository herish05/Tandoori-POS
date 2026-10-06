import { IPC_CHANNELS } from '@shared/ipc-channels'
import { idInputSchema } from '@shared/auth-schemas'
import {
  createAddonInputSchema,
  createCategoryInputSchema,
  createItemInputSchema,
  createStationInputSchema,
  createTaxCategoryInputSchema,
  itemFilterSchema,
  setActiveMenuInputSchema,
  setAvailabilityInputSchema,
  updateAddonInputSchema,
  updateCategoryInputSchema,
  updateItemInputSchema,
  updateStationInputSchema,
  updateTaxCategoryInputSchema
} from '@shared/menu'
import { emptyInputSchema } from '@shared/schemas'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

const VIEW = { permissions: ['menu.view'] } as const
const MANAGE = { permissions: ['menu.manage'] } as const
const OPERATE = { permissions: ['menu.operate'] } as const

/** Menu handlers: kitchen stations, categories, tax categories, add-ons, items and the sample menu. */
export function registerMenuHandlers(registrar: IpcRegistrar, services: Services): void {
  const { stations, categories, taxCategories, addons, items, demoMenu } = services

  // --- Kitchen stations --------------------------------------------------------------------
  registrar.handleProtected(IPC_CHANNELS.stationsList, emptyInputSchema, VIEW, () =>
    stations.list()
  )
  registrar.handleProtected(
    IPC_CHANNELS.stationsCreate,
    createStationInputSchema,
    MANAGE,
    (input, ctx) => stations.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.stationsUpdate,
    updateStationInputSchema,
    MANAGE,
    (input, ctx) => stations.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.stationsSetActive,
    setActiveMenuInputSchema,
    MANAGE,
    (input, ctx) => stations.setActive(ctx, input)
  )
  registrar.handleProtected(IPC_CHANNELS.stationsDelete, idInputSchema, MANAGE, (input, ctx) => {
    stations.delete(ctx, input.id)
    return null
  })

  // --- Categories --------------------------------------------------------------------------
  registrar.handleProtected(IPC_CHANNELS.categoriesList, emptyInputSchema, VIEW, () =>
    categories.list()
  )
  registrar.handleProtected(
    IPC_CHANNELS.categoriesCreate,
    createCategoryInputSchema,
    MANAGE,
    (input, ctx) => categories.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.categoriesUpdate,
    updateCategoryInputSchema,
    MANAGE,
    (input, ctx) => categories.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.categoriesSetActive,
    setActiveMenuInputSchema,
    MANAGE,
    (input, ctx) => categories.setActive(ctx, input)
  )
  registrar.handleProtected(IPC_CHANNELS.categoriesDelete, idInputSchema, MANAGE, (input, ctx) => {
    categories.delete(ctx, input.id)
    return null
  })

  // --- Tax categories ----------------------------------------------------------------------
  registrar.handleProtected(IPC_CHANNELS.taxCategoriesList, emptyInputSchema, VIEW, () =>
    taxCategories.list()
  )
  registrar.handleProtected(
    IPC_CHANNELS.taxCategoriesCreate,
    createTaxCategoryInputSchema,
    MANAGE,
    (input, ctx) => taxCategories.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.taxCategoriesUpdate,
    updateTaxCategoryInputSchema,
    MANAGE,
    (input, ctx) => taxCategories.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.taxCategoriesSetActive,
    setActiveMenuInputSchema,
    MANAGE,
    (input, ctx) => taxCategories.setActive(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.taxCategoriesDelete,
    idInputSchema,
    MANAGE,
    (input, ctx) => {
      taxCategories.delete(ctx, input.id)
      return null
    }
  )

  // --- Add-ons and modifiers ---------------------------------------------------------------
  registrar.handleProtected(IPC_CHANNELS.addonsList, emptyInputSchema, VIEW, () => addons.list())
  registrar.handleProtected(
    IPC_CHANNELS.addonsCreate,
    createAddonInputSchema,
    MANAGE,
    (input, ctx) => addons.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.addonsUpdate,
    updateAddonInputSchema,
    MANAGE,
    (input, ctx) => addons.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.addonsSetActive,
    setActiveMenuInputSchema,
    MANAGE,
    (input, ctx) => addons.setActive(ctx, input)
  )
  registrar.handleProtected(IPC_CHANNELS.addonsDelete, idInputSchema, MANAGE, (input, ctx) => {
    addons.delete(ctx, input.id)
    return null
  })

  // --- Items -------------------------------------------------------------------------------
  registrar.handleProtected(IPC_CHANNELS.itemsList, itemFilterSchema, VIEW, (input) =>
    items.list(input)
  )
  registrar.handleProtected(IPC_CHANNELS.itemsCreate, createItemInputSchema, MANAGE, (input, ctx) =>
    items.create(ctx, input)
  )
  registrar.handleProtected(IPC_CHANNELS.itemsUpdate, updateItemInputSchema, MANAGE, (input, ctx) =>
    items.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.itemsSetActive,
    setActiveMenuInputSchema,
    MANAGE,
    (input, ctx) => items.setActive(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.itemsSetAvailability,
    setAvailabilityInputSchema,
    OPERATE,
    (input, ctx) => items.setAvailability(ctx, input)
  )
  registrar.handleProtected(IPC_CHANNELS.itemsDelete, idInputSchema, MANAGE, (input, ctx) => {
    items.delete(ctx, input.id)
    return null
  })

  // --- Sample menu -------------------------------------------------------------------------
  registrar.handleProtected(IPC_CHANNELS.demoStatus, emptyInputSchema, VIEW, () =>
    demoMenu.status()
  )
  registrar.handleProtected(IPC_CHANNELS.demoLoad, emptyInputSchema, MANAGE, (_input, ctx) =>
    demoMenu.load(ctx)
  )
  registrar.handleProtected(IPC_CHANNELS.demoRemove, emptyInputSchema, MANAGE, (_input, ctx) =>
    demoMenu.remove(ctx)
  )
}
