import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { userConfigPatchSchema, userConfigSchema } from '@shared/schemas'
import type { UserConfig } from '@shared/types'

export interface UserConfigStoreLogger {
  warn: (message: string, context?: Record<string, unknown>) => void
}

/**
 * Persists user-editable settings as JSON on the local machine.
 * - Invalid or corrupt files never crash the app: defaults are used and the bad file is preserved.
 * - Writes are atomic (temp file + rename) so a power cut cannot leave a half-written file.
 */
export class UserConfigStore {
  private current: UserConfig

  constructor(
    private readonly filePath: string,
    private readonly logger: UserConfigStoreLogger
  ) {
    this.current = this.load()
  }

  get(): UserConfig {
    return { ...this.current }
  }

  update(patch: unknown): UserConfig {
    const validPatch = userConfigPatchSchema.parse(patch)
    const next = userConfigSchema.parse({ ...this.current, ...validPatch })
    this.write(next)
    this.current = next
    return this.get()
  }

  private load(): UserConfig {
    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('Could not read user config; using defaults', { error })
      }
      return userConfigSchema.parse({})
    }

    try {
      const parsed = userConfigSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
      this.logger.warn('User config failed validation; using defaults', {
        issues: parsed.error.issues
      })
    } catch (error) {
      this.logger.warn('User config is not valid JSON; using defaults', { error })
    }

    try {
      renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now().toString()}`)
    } catch {
      /* best effort: the preserved copy is only a diagnostic aid */
    }
    return userConfigSchema.parse({})
  }

  private write(config: UserConfig): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.filePath)
  }
}
