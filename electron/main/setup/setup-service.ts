import { randomUUID } from 'node:crypto'
import type { SetupData } from '@shared/auth-schemas'
import type { SetupStatus } from '@shared/domain'
import { OWNER_ROLE_NAME } from '@shared/permissions'
import type { AuditService } from '../auth/audit-service'
import { hashPassword } from '../auth/password'
import { syncPermissionCatalog } from '../auth/permission-catalog'
import type { AppDatabase } from '../db/client'
import { permissions, restaurants, rolePermissions, roles, userRoles, users } from '../db/schema'
import { AppError } from '../ipc/errors'
import type { Logger } from '../logging/log-manager'

/** First-time setup: creates the restaurant, the OWNER role and the first owner account. */
export class SetupService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly logger: Logger
  ) {}

  getStatus(): SetupStatus {
    const restaurant = this.db.select({ name: restaurants.name }).from(restaurants).get()
    return { isSetupComplete: restaurant !== undefined, restaurantName: restaurant?.name ?? null }
  }

  /**
   * Everything is written in one transaction: either the restaurant, role, owner and audit entry
   * all exist afterwards, or nothing changed. It can only ever succeed once.
   */
  async complete(input: SetupData): Promise<void> {
    if (this.getStatus().isSetupComplete) {
      throw new AppError('ALREADY_SETUP', 'This restaurant has already been set up.')
    }
    const passwordHash = await hashPassword(input.owner.password)

    this.db.transaction((tx) => {
      // Re-checked inside the transaction so two simultaneous requests cannot both succeed.
      if (tx.select({ id: restaurants.id }).from(restaurants).get()) {
        throw new AppError('ALREADY_SETUP', 'This restaurant has already been set up.')
      }

      const restaurantId = randomUUID()
      tx.insert(restaurants)
        .values({
          id: restaurantId,
          name: input.restaurant.name,
          legalName: input.restaurant.legalName,
          address: input.restaurant.address,
          city: input.restaurant.city,
          state: input.restaurant.state,
          country: input.restaurant.country,
          phone: input.restaurant.phone,
          email: input.restaurant.email,
          gstin: input.restaurant.gstin,
          currency: input.restaurant.currency,
          timezone: input.restaurant.timezone,
          receiptFooter: input.restaurant.receiptFooter,
          logo: input.restaurant.logo
        })
        .run()

      syncPermissionCatalog(tx)

      const ownerRoleId = randomUUID()
      tx.insert(roles)
        .values({
          id: ownerRoleId,
          restaurantId,
          name: OWNER_ROLE_NAME,
          description: 'Full access to everything.',
          isSystem: true
        })
        .run()
      // The catalogue sync above ran before the role existed; grant its permissions now.
      for (const permission of tx.select({ id: permissions.id }).from(permissions).all()) {
        tx.insert(rolePermissions)
          .values({ roleId: ownerRoleId, permissionId: permission.id })
          .run()
      }

      const ownerId = randomUUID()
      tx.insert(users)
        .values({
          id: ownerId,
          restaurantId,
          username: input.owner.username,
          fullName: input.owner.fullName,
          email: input.owner.email,
          phone: input.owner.phone,
          passwordHash,
          isActive: true,
          mustChangePassword: false,
          passwordChangedAt: new Date()
        })
        .run()
      tx.insert(userRoles).values({ userId: ownerId, roleId: ownerRoleId }).run()

      this.audit.record(
        {
          action: 'setup.completed',
          userId: ownerId,
          username: input.owner.username,
          entityType: 'restaurant',
          entityId: restaurantId,
          details: { restaurantName: input.restaurant.name }
        },
        tx
      )
    })

    this.logger.info('First-time setup completed')
  }
}
