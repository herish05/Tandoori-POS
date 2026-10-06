import { IPC_CHANNELS } from '@shared/ipc-channels'
import {
  auditQueryInputSchema,
  changePasswordInputSchema,
  createRoleInputSchema,
  createStaffInputSchema,
  idInputSchema,
  loginInputSchema,
  resetPasswordInputSchema,
  restaurantInputSchema,
  setupInputSchema,
  updateRoleInputSchema,
  updateStaffInputSchema
} from '@shared/auth-schemas'
import { emptyInputSchema } from '@shared/schemas'
import { listPermissionInfo } from './auth/role-service'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

/**
 * Sign-in, setup, staff, roles, restaurant profile and audit handlers.
 * Each protected handler declares the permissions it needs; the registrar enforces them
 * before the handler runs.
 */
export function registerAuthHandlers(registrar: IpcRegistrar, services: Services): void {
  const { setup, auth, restaurant, users, roles, audit } = services

  // --- Public: needed before anyone can be signed in -------------------------------------------
  registrar.handle(IPC_CHANNELS.setupGetStatus, emptyInputSchema, () => setup.getStatus())
  registrar.handle(IPC_CHANNELS.setupComplete, setupInputSchema, async (input) => {
    await setup.complete(input)
    return null
  })
  registrar.handle(IPC_CHANNELS.authLogin, loginInputSchema, (input) => auth.login(input))
  registrar.handle(IPC_CHANNELS.authLogout, emptyInputSchema, () => {
    auth.logout()
    return null
  })
  registrar.handle(IPC_CHANNELS.authGetSession, emptyInputSchema, () => auth.peek())

  // --- Any signed-in user ------------------------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.authTouch,
    emptyInputSchema,
    { allowPasswordChange: true },
    () => null
  )
  registrar.handleProtected(
    IPC_CHANNELS.authChangePassword,
    changePasswordInputSchema,
    { allowPasswordChange: true },
    (input, ctx) => auth.changePassword(ctx, input)
  )

  // --- Restaurant ---------------------------------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.restaurantGet,
    emptyInputSchema,
    { permissions: ['restaurant.view'] },
    () => restaurant.get()
  )
  registrar.handleProtected(
    IPC_CHANNELS.restaurantUpdate,
    restaurantInputSchema,
    { permissions: ['restaurant.manage'] },
    (input, ctx) => restaurant.update(ctx, input)
  )

  // --- Staff ----------------------------------------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.usersList,
    emptyInputSchema,
    { permissions: ['users.view'] },
    () => users.list()
  )
  registrar.handleProtected(
    IPC_CHANNELS.usersAssignableRoles,
    emptyInputSchema,
    { permissions: ['users.manage'] },
    (_, ctx) => users.assignableRoles(ctx)
  )
  registrar.handleProtected(
    IPC_CHANNELS.usersCreate,
    createStaffInputSchema,
    { permissions: ['users.manage'] },
    (input, ctx) => users.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.usersUpdate,
    updateStaffInputSchema,
    { permissions: ['users.manage'] },
    (input, ctx) => users.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.usersResetPassword,
    resetPasswordInputSchema,
    { permissions: ['users.manage'] },
    async (input, ctx) => {
      await users.resetPassword(ctx, input)
      return null
    }
  )

  // --- Roles ------------------------------------------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.rolesList,
    emptyInputSchema,
    { permissions: ['roles.view'] },
    () => roles.list()
  )
  registrar.handleProtected(
    IPC_CHANNELS.permissionsList,
    emptyInputSchema,
    { permissions: ['roles.view'] },
    () => listPermissionInfo()
  )
  registrar.handleProtected(
    IPC_CHANNELS.rolesCreate,
    createRoleInputSchema,
    { permissions: ['roles.manage'] },
    (input, ctx) => roles.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.rolesUpdate,
    updateRoleInputSchema,
    { permissions: ['roles.manage'] },
    (input, ctx) => roles.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.rolesDelete,
    idInputSchema,
    { permissions: ['roles.manage'] },
    (input, ctx) => {
      roles.delete(ctx, input.id)
      return null
    }
  )

  // --- Audit ------------------------------------------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.auditList,
    auditQueryInputSchema,
    { permissions: ['audit.view'] },
    (input) => audit.list(input)
  )
}
