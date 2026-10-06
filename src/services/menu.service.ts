import type {
  CreateAddonInput,
  CreateCategoryInput,
  CreateItemInput,
  CreateStationInput,
  CreateTaxCategoryInput,
  DemoMenuStatus,
  DemoRemoveResult,
  ItemFilterInput,
  KitchenStation,
  MenuAddon,
  MenuCategory,
  MenuItem,
  SetActiveMenuInput,
  SetAvailabilityInput,
  TaxCategory,
  UpdateAddonInput,
  UpdateCategoryInput,
  UpdateItemInput,
  UpdateStationInput,
  UpdateTaxCategoryInput
} from '@shared/menu'
import { getApi, unwrap } from '@/lib/ipc'

export const stationService = {
  list: (): Promise<KitchenStation[]> => unwrap(getApi().menu.stations.list()),
  create: (input: CreateStationInput): Promise<KitchenStation> =>
    unwrap(getApi().menu.stations.create(input)),
  update: (input: UpdateStationInput): Promise<KitchenStation> =>
    unwrap(getApi().menu.stations.update(input)),
  setActive: (input: SetActiveMenuInput): Promise<KitchenStation> =>
    unwrap(getApi().menu.stations.setActive(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().menu.stations.delete(id))
}

export const categoryService = {
  list: (): Promise<MenuCategory[]> => unwrap(getApi().menu.categories.list()),
  create: (input: CreateCategoryInput): Promise<MenuCategory> =>
    unwrap(getApi().menu.categories.create(input)),
  update: (input: UpdateCategoryInput): Promise<MenuCategory> =>
    unwrap(getApi().menu.categories.update(input)),
  setActive: (input: SetActiveMenuInput): Promise<MenuCategory> =>
    unwrap(getApi().menu.categories.setActive(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().menu.categories.delete(id))
}

export const taxCategoryService = {
  list: (): Promise<TaxCategory[]> => unwrap(getApi().menu.taxCategories.list()),
  create: (input: CreateTaxCategoryInput): Promise<TaxCategory> =>
    unwrap(getApi().menu.taxCategories.create(input)),
  update: (input: UpdateTaxCategoryInput): Promise<TaxCategory> =>
    unwrap(getApi().menu.taxCategories.update(input)),
  setActive: (input: SetActiveMenuInput): Promise<TaxCategory> =>
    unwrap(getApi().menu.taxCategories.setActive(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().menu.taxCategories.delete(id))
}

export const addonService = {
  list: (): Promise<MenuAddon[]> => unwrap(getApi().menu.addons.list()),
  create: (input: CreateAddonInput): Promise<MenuAddon> =>
    unwrap(getApi().menu.addons.create(input)),
  update: (input: UpdateAddonInput): Promise<MenuAddon> =>
    unwrap(getApi().menu.addons.update(input)),
  setActive: (input: SetActiveMenuInput): Promise<MenuAddon> =>
    unwrap(getApi().menu.addons.setActive(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().menu.addons.delete(id))
}

export const itemService = {
  list: (filter: ItemFilterInput): Promise<MenuItem[]> => unwrap(getApi().menu.items.list(filter)),
  create: (input: CreateItemInput): Promise<MenuItem> => unwrap(getApi().menu.items.create(input)),
  update: (input: UpdateItemInput): Promise<MenuItem> => unwrap(getApi().menu.items.update(input)),
  setActive: (input: SetActiveMenuInput): Promise<MenuItem> =>
    unwrap(getApi().menu.items.setActive(input)),
  setAvailability: (input: SetAvailabilityInput): Promise<MenuItem> =>
    unwrap(getApi().menu.items.setAvailability(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().menu.items.delete(id))
}

export const demoMenuService = {
  status: (): Promise<DemoMenuStatus> => unwrap(getApi().menu.demo.status()),
  load: (): Promise<DemoMenuStatus> => unwrap(getApi().menu.demo.load()),
  remove: (): Promise<DemoRemoveResult> => unwrap(getApi().menu.demo.remove())
}
