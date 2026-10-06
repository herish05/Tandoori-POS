import type {
  AuditQueryInput,
  ChangePasswordInput,
  CreateRoleInput,
  CreateStaffInput,
  LoginInput,
  ResetPasswordInput,
  RestaurantInput,
  SetupInput,
  UpdateRoleInput,
  UpdateStaffInput
} from '@shared/auth-schemas'
import type {
  AuditLogPage,
  PermissionInfo,
  RestaurantProfile,
  RoleRef,
  RoleSummary,
  SessionInfo,
  SessionSnapshot,
  SetupStatus,
  StaffMember
} from '@shared/domain'
import { getApi, unwrap } from '@/lib/ipc'

/** Typed wrappers over the preload API for sign-in, setup, staff, roles and the restaurant profile. */
export const authService = {
  getSetupStatus: (): Promise<SetupStatus> => unwrap(getApi().setup.getStatus()),
  completeSetup: (input: SetupInput): Promise<null> => unwrap(getApi().setup.complete(input)),

  login: (input: LoginInput): Promise<SessionInfo> => unwrap(getApi().auth.login(input)),
  logout: (): Promise<null> => unwrap(getApi().auth.logout()),
  getSession: (): Promise<SessionSnapshot> => unwrap(getApi().auth.getSession()),
  touch: (): Promise<null> => unwrap(getApi().auth.touch()),
  changePassword: (input: ChangePasswordInput): Promise<SessionInfo> =>
    unwrap(getApi().auth.changePassword(input))
}

export const restaurantService = {
  get: (): Promise<RestaurantProfile> => unwrap(getApi().restaurant.get()),
  update: (input: RestaurantInput): Promise<RestaurantProfile> =>
    unwrap(getApi().restaurant.update(input))
}

export const staffService = {
  list: (): Promise<StaffMember[]> => unwrap(getApi().users.list()),
  assignableRoles: (): Promise<RoleRef[]> => unwrap(getApi().users.assignableRoles()),
  create: (input: CreateStaffInput): Promise<StaffMember> => unwrap(getApi().users.create(input)),
  update: (input: UpdateStaffInput): Promise<StaffMember> => unwrap(getApi().users.update(input)),
  resetPassword: (input: ResetPasswordInput): Promise<null> =>
    unwrap(getApi().users.resetPassword(input))
}

export const roleService = {
  list: (): Promise<RoleSummary[]> => unwrap(getApi().roles.list()),
  permissions: (): Promise<PermissionInfo[]> => unwrap(getApi().permissions.list()),
  create: (input: CreateRoleInput): Promise<RoleSummary> => unwrap(getApi().roles.create(input)),
  update: (input: UpdateRoleInput): Promise<RoleSummary> => unwrap(getApi().roles.update(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().roles.delete(id))
}

export const auditService = {
  list: (query: AuditQueryInput): Promise<AuditLogPage> => unwrap(getApi().audit.list(query))
}
