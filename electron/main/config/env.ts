import { z } from 'zod'
import { logLevelSchema } from '@shared/schemas'
import type { AppEnv, LogLevel } from '@shared/types'

const buildEnvSchema = z.object({
  MAIN_VITE_APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  MAIN_VITE_LOG_LEVEL: logLevelSchema.default('info'),
  MAIN_VITE_CLOUD_API_URL: z.union([z.literal(''), z.url()]).default('')
})

export interface BuildEnv {
  appEnv: AppEnv
  logLevel: LogLevel
  /** Empty string means "no cloud configured": the POS runs purely locally. */
  cloudApiUrl: string
}

/**
 * Parses the build-time environment (`MAIN_VITE_*`). Fails fast with a readable message
 * so that a bad build configuration is never silently ignored.
 */
export function parseBuildEnv(raw: unknown): BuildEnv {
  const parsed = buildEnvSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid build environment configuration: ${issues}`)
  }
  return {
    appEnv: parsed.data.MAIN_VITE_APP_ENV,
    logLevel: parsed.data.MAIN_VITE_LOG_LEVEL,
    cloudApiUrl: parsed.data.MAIN_VITE_CLOUD_API_URL
  }
}
