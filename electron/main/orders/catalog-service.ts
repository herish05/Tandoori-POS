import type { PosCatalog, PosCategory, PosItem } from '@shared/orders'
import type { CategoryService } from '../menu/category-service'
import type { ItemService } from '../menu/item-service'

/**
 * The menu as the ordering screen needs it: only what can be ordered today, without cost prices
 * or pictures (staff who take orders do not need either, and the payload stays small).
 * Sold-out items are included, marked unavailable, so the screen can show them greyed out.
 */
export class OrderCatalogService {
  constructor(
    private readonly items: ItemService,
    private readonly categories: CategoryService
  ) {}

  get(): PosCatalog {
    const activeCategories = this.categories.list().filter((category) => category.isActive)
    const allowed = new Set(activeCategories.map((category) => category.id))

    const items = this.items
      .list({ status: 'ACTIVE' })
      .filter((item) => allowed.has(item.categoryId))
      .map((item): PosItem => {
        const variants = item.variants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          price: variant.price,
          isDefault: variant.isDefault,
          isAvailable: variant.isAvailable
        }))
        // An item whose every variant is sold out cannot be ordered either.
        const orderable =
          item.isAvailable && (variants.length === 0 || variants.some((v) => v.isAvailable))
        return {
          id: item.id,
          name: item.name,
          description: item.description,
          categoryId: item.categoryId,
          foodType: item.foodType,
          price: item.price,
          isAvailable: orderable,
          isBestSeller: item.isBestSeller,
          variants,
          addons: item.addons
            .filter((addon) => addon.isActive)
            .map((addon) => ({
              id: addon.id,
              name: addon.name,
              kind: addon.kind,
              price: addon.price
            }))
        }
      })

    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1)

    const categories: PosCategory[] = activeCategories
      .filter((category) => counts.has(category.id))
      .map((category) => ({
        id: category.id,
        name: category.name,
        itemCount: counts.get(category.id) ?? 0
      }))
    return { categories, items }
  }
}
