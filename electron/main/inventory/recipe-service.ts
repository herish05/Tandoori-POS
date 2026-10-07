import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import {
  categories,
  inventoryItems,
  markModified,
  menuItems,
  menuVariants,
  recipeLines
} from '../db/schema'
import { AppError } from '../ipc/errors'
import {
  costOfQuantity,
  type Recipe,
  type RecipeCoverage,
  type RecipeLine,
  type RecipeScope,
  type SetRecipeData
} from '@shared/inventory'

type MenuItemRow = typeof menuItems.$inferSelect

/** What each menu item uses: the ingredients of one portion, for the item or for one size. */
export class RecipeService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  // --- Reads -------------------------------------------------------------------------------

  /** Every menu item with the number of ingredients in its recipes, so gaps are easy to see. */
  coverage(): RecipeCoverage[] {
    const counts = new Map(
      this.db
        .select({
          id: recipeLines.menuItemId,
          total: sql<number>`count(*)`
        })
        .from(recipeLines)
        .where(isNull(recipeLines.deletedAt))
        .groupBy(recipeLines.menuItemId)
        .all()
        .map((row) => [row.id, row.total])
    )
    return this.db
      .select({
        id: menuItems.id,
        name: menuItems.name,
        isActive: menuItems.isActive,
        categoryName: categories.name
      })
      .from(menuItems)
      .innerJoin(categories, eq(categories.id, menuItems.categoryId))
      .where(isNull(menuItems.deletedAt))
      .orderBy(asc(categories.sortOrder), asc(categories.name), asc(menuItems.name))
      .all()
      .map((row) => ({
        menuItemId: row.id,
        itemName: row.name,
        categoryName: row.categoryName,
        isActive: row.isActive,
        lineCount: counts.get(row.id) ?? 0
      }))
  }

  get(menuItemId: string): Recipe {
    return this.load(this.db, this.requireMenuItem(this.db, menuItemId))
  }

  // --- Writes ------------------------------------------------------------------------------

  /**
   * Replaces the recipe of the item (or of one size). Lines that stay keep their record, so only
   * what really changed is touched.
   */
  set(auth: AuthContext, input: SetRecipeData): Recipe {
    this.db.transaction((tx) => {
      const item = this.requireMenuItem(tx, input.menuItemId)
      if (input.variantId !== null) {
        const variant = tx
          .select({ id: menuVariants.id })
          .from(menuVariants)
          .where(
            and(
              eq(menuVariants.id, input.variantId),
              eq(menuVariants.menuItemId, item.id),
              isNull(menuVariants.deletedAt)
            )
          )
          .get()
        if (!variant) throw new AppError('NOT_FOUND', 'That size no longer exists on this item.')
      }

      const ingredientIds = input.lines.map((line) => line.inventoryItemId)
      if (ingredientIds.length > 0) {
        const found = tx
          .select({ id: inventoryItems.id, isActive: inventoryItems.isActive })
          .from(inventoryItems)
          .where(and(inArray(inventoryItems.id, ingredientIds), isNull(inventoryItems.deletedAt)))
          .all()
        if (found.length !== ingredientIds.length) {
          throw new AppError('NOT_FOUND', 'One of the ingredients no longer exists.')
        }
        const inactive = found.find((row) => !row.isActive)
        const existingIds = new Set(
          this.scopeLines(tx, item.id, input.variantId).map((row) => row.inventoryItemId)
        )
        if (inactive && !existingIds.has(inactive.id)) {
          throw new AppError('CONFLICT', 'An inactive stock item cannot be added to a recipe.')
        }
      }

      const existing = this.scopeLines(tx, item.id, input.variantId)
      const wanted = new Map(input.lines.map((line) => [line.inventoryItemId, line.quantity]))
      let added = 0
      let changed = 0
      let removed = 0
      for (const row of existing) {
        const quantity = wanted.get(row.inventoryItemId)
        if (quantity === undefined) {
          tx.update(recipeLines)
            .set({ deletedAt: new Date(), ...markModified(recipeLines) })
            .where(eq(recipeLines.id, row.id))
            .run()
          removed += 1
        } else if (quantity !== row.quantity) {
          tx.update(recipeLines)
            .set({ quantity, ...markModified(recipeLines) })
            .where(eq(recipeLines.id, row.id))
            .run()
          changed += 1
        }
      }
      const kept = new Set(existing.map((row) => row.inventoryItemId))
      for (const line of input.lines) {
        if (kept.has(line.inventoryItemId)) continue
        tx.insert(recipeLines)
          .values({
            menuItemId: item.id,
            variantId: input.variantId,
            inventoryItemId: line.inventoryItemId,
            quantity: line.quantity
          })
          .run()
        added += 1
      }

      if (added + changed + removed > 0) {
        this.audit.record(
          {
            action: 'inventory.recipe_updated',
            userId: auth.userId,
            username: auth.username,
            entityType: 'menu_item',
            entityId: item.id,
            details: {
              item: item.name,
              variantId: input.variantId,
              ingredients: input.lines.length,
              added,
              changed,
              removed
            }
          },
          tx
        )
      }
    })
    return this.get(input.menuItemId)
  }

  // --- Internals ---------------------------------------------------------------------------

  private scopeLines(db: DbExecutor, menuItemId: string, variantId: string | null) {
    return db
      .select()
      .from(recipeLines)
      .where(
        and(
          eq(recipeLines.menuItemId, menuItemId),
          variantId === null ? isNull(recipeLines.variantId) : eq(recipeLines.variantId, variantId),
          isNull(recipeLines.deletedAt)
        )
      )
      .all()
  }

  private requireMenuItem(db: DbExecutor, id: string): MenuItemRow {
    const row = db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.id, id), isNull(menuItems.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That menu item no longer exists.')
    return row
  }

  private load(db: DbExecutor, item: MenuItemRow): Recipe {
    const variants = db
      .select()
      .from(menuVariants)
      .where(and(eq(menuVariants.menuItemId, item.id), isNull(menuVariants.deletedAt)))
      .orderBy(asc(menuVariants.sortOrder), asc(menuVariants.name))
      .all()
    const rows = db
      .select({
        line: recipeLines,
        name: inventoryItems.name,
        unit: inventoryItems.unit,
        unitCost: inventoryItems.unitCost
      })
      .from(recipeLines)
      .innerJoin(inventoryItems, eq(inventoryItems.id, recipeLines.inventoryItemId))
      .where(and(eq(recipeLines.menuItemId, item.id), isNull(recipeLines.deletedAt)))
      .orderBy(asc(inventoryItems.name))
      .all()

    const linesFor = (variantId: string | null): RecipeLine[] =>
      rows
        .filter(({ line }) => line.variantId === variantId)
        .map(({ line, name, unit, unitCost }) => ({
          id: line.id,
          inventoryItemId: line.inventoryItemId,
          itemName: name,
          unit,
          quantity: line.quantity,
          cost: costOfQuantity(line.quantity, unitCost)
        }))
    const scope = (
      variantId: string | null,
      variantName: string | null,
      price: number
    ): RecipeScope => {
      const lines = linesFor(variantId)
      return {
        variantId,
        variantName,
        price,
        lines,
        cost: lines.reduce((sum, line) => sum + line.cost, 0)
      }
    }

    return {
      menuItemId: item.id,
      itemName: item.name,
      scopes: [
        scope(null, null, item.price),
        ...variants.map((variant) => scope(variant.id, variant.name, variant.price))
      ]
    }
  }
}
