import { z } from 'zod'
import type { LogWriteInput, UserConfig } from './types'

export const logChannelSchema = z.enum(['app', 'security', 'sync', 'printer', 'database'])
export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])

export const userConfigSchema = z.object({
  posFullscreen: z.boolean().default(false),
  startMaximized: z.boolean().default(true)
}) satisfies z.ZodType<UserConfig>

export const userConfigPatchSchema = userConfigSchema.partial().strict()

export const logWriteSchema = z.object({
  channel: logChannelSchema,
  level: logLevelSchema,
  message: z.string().min(1).max(2000),
  context: z.record(z.string(), z.unknown()).optional()
}) satisfies z.ZodType<LogWriteInput>

export const emptyInputSchema = z.undefined()
