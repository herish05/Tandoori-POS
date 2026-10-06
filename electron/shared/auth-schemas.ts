import { z } from 'zod'
import { PERMISSION_CODES } from './permissions'

/**
 * Validation shared by the renderer (instant feedback) and the main process (the real check).
 * Text inputs are trimmed; empty optional fields become `null`.
 */

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,18}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/
const LOGO_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/

/** Largest accepted logo, as a data URL (about 350 KB of image). */
export const MAX_LOGO_DATA_URL_LENGTH = 480_000

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${String(max)} characters.`)

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${String(max)} characters.`)
    .nullish()
    .transform((value) => (value === null || value === undefined || value === '' ? null : value))

const optionalPattern = (message: string, pattern: RegExp, transform: (v: string) => string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value ? transform(value) : null))
    .refine((value) => value === null || pattern.test(value), message)

const isValidTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-IN', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${String(PASSWORD_MIN_LENGTH)} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${String(PASSWORD_MAX_LENGTH)} characters.`)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/\d/, 'Password must contain at least one number.')

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    USERNAME_PATTERN,
    'Username must be 3-32 characters: letters, numbers, dot, dash or underscore.'
  )

export const restaurantInputSchema = z.object({
  name: requiredText('Restaurant name', 120),
  legalName: optionalText('Legal name', 160),
  address: requiredText('Address', 240),
  city: requiredText('City', 80),
  state: requiredText('State', 80),
  country: requiredText('Country', 80),
  phone: z.string().trim().regex(PHONE_PATTERN, 'Enter a valid phone number.'),
  email: optionalPattern('Enter a valid email address.', EMAIL_PATTERN, (v) => v),
  gstin: optionalPattern('Enter a valid 15-character GSTIN.', GSTIN_PATTERN, (v) =>
    v.toUpperCase()
  ),
  currency: z.literal('INR').default('INR'),
  timezone: z
    .string()
    .trim()
    .refine(isValidTimeZone, 'Choose a valid time zone.')
    .default('Asia/Kolkata'),
  receiptFooter: optionalText('Receipt footer', 240),
  logo: z
    .string()
    .max(MAX_LOGO_DATA_URL_LENGTH, 'The logo is too large. Use an image under 350 KB.')
    .regex(LOGO_PATTERN, 'The logo must be a PNG, JPEG or WebP image.')
    .nullish()
    .transform((value) => value ?? null)
})

export type RestaurantInput = z.input<typeof restaurantInputSchema>

const ownerSchema = z
  .object({
    username: usernameSchema,
    fullName: requiredText('Full name', 80).min(2, 'Full name is too short.'),
    email: optionalPattern('Enter a valid email address.', EMAIL_PATTERN, (v) => v),
    phone: optionalPattern('Enter a valid phone number.', PHONE_PATTERN, (v) => v),
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((owner) => owner.password === owner.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.'
  })
  .refine((owner) => owner.password.toLowerCase() !== owner.username, {
    path: ['password'],
    message: 'Password must not be the same as the username.'
  })

export const setupInputSchema = z.object({
  restaurant: restaurantInputSchema,
  owner: ownerSchema
})

export type SetupInput = z.input<typeof setupInputSchema>
export type OwnerAccountInput = z.input<typeof ownerSchema>

export const loginInputSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Enter your username.').max(64),
  password: z.string().min(1, 'Enter your password.').max(256)
})

export type LoginInput = z.input<typeof loginInputSchema>

export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(256),
    newPassword: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.'
  })
  .refine((input) => input.newPassword !== input.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one.'
  })

export type ChangePasswordInput = z.input<typeof changePasswordInputSchema>

const idSchema = z.uuid()
export const idInputSchema = z.object({ id: idSchema })

const staffFields = {
  fullName: requiredText('Full name', 80).min(2, 'Full name is too short.'),
  email: optionalPattern('Enter a valid email address.', EMAIL_PATTERN, (v) => v),
  phone: optionalPattern('Enter a valid phone number.', PHONE_PATTERN, (v) => v),
  roleIds: z.array(idSchema).min(1, 'Choose at least one role.').max(10)
}

export const createStaffInputSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  ...staffFields
})
export type CreateStaffInput = z.input<typeof createStaffInputSchema>

export const updateStaffInputSchema = z.object({
  id: idSchema,
  isActive: z.boolean(),
  ...staffFields
})
export type UpdateStaffInput = z.input<typeof updateStaffInputSchema>

export const resetPasswordInputSchema = z.object({ id: idSchema, newPassword: passwordSchema })
export type ResetPasswordInput = z.input<typeof resetPasswordInputSchema>

const roleFields = {
  name: requiredText('Role name', 40).min(2, 'Role name is too short.'),
  description: optionalText('Description', 200),
  permissions: z.array(z.enum(PERMISSION_CODES)).max(PERMISSION_CODES.length)
}

export const createRoleInputSchema = z.object(roleFields)
export type CreateRoleInput = z.input<typeof createRoleInputSchema>

export const updateRoleInputSchema = z.object({ id: idSchema, ...roleFields })
export type UpdateRoleInput = z.input<typeof updateRoleInputSchema>

export const auditQueryInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
  /** Matches actions that start with this text, e.g. `auth.`. */
  actionPrefix: z.string().trim().max(64).optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE']).optional()
})
export type AuditQueryInput = z.input<typeof auditQueryInputSchema>

/** Parsed (output) shapes: what handlers and services receive after validation. */
export type RestaurantData = z.output<typeof restaurantInputSchema>
export type SetupData = z.output<typeof setupInputSchema>
export type LoginData = z.output<typeof loginInputSchema>
export type ChangePasswordData = z.output<typeof changePasswordInputSchema>
export type CreateStaffData = z.output<typeof createStaffInputSchema>
export type UpdateStaffData = z.output<typeof updateStaffInputSchema>
export type ResetPasswordData = z.output<typeof resetPasswordInputSchema>
export type CreateRoleData = z.output<typeof createRoleInputSchema>
export type UpdateRoleData = z.output<typeof updateRoleInputSchema>
export type AuditQueryData = z.output<typeof auditQueryInputSchema>
