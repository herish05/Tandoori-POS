import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserConfigStore } from '@main/config/user-config'

describe('UserConfigStore', () => {
  let dir: string
  let file: string
  const logger = { warn: vi.fn() }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tpos-config-'))
    file = join(dir, 'config.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns defaults when no file exists', () => {
    expect(new UserConfigStore(file, logger).get()).toEqual({
      posFullscreen: false,
      startMaximized: true
    })
  })

  it('persists updates and reloads them', () => {
    const store = new UserConfigStore(file, logger)
    store.update({ posFullscreen: true })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ posFullscreen: true })
    expect(new UserConfigStore(file, logger).get().posFullscreen).toBe(true)
  })

  it('rejects unknown keys and wrong types', () => {
    const store = new UserConfigStore(file, logger)
    expect(() => store.update({ isAdmin: true })).toThrow()
    expect(() => store.update({ posFullscreen: 'yes' })).toThrow()
    expect(store.get().posFullscreen).toBe(false)
  })

  it('recovers from a corrupt file, preserving it for diagnosis', () => {
    writeFileSync(file, '{ not json')
    const store = new UserConfigStore(file, logger)
    expect(store.get().startMaximized).toBe(true)
    expect(logger.warn).toHaveBeenCalled()
    expect(readdirSync(dir).some((n) => n.startsWith('config.json.corrupt-'))).toBe(true)
  })

  it('does not leave a temp file behind after writing', () => {
    new UserConfigStore(file, logger).update({ startMaximized: false })
    expect(readdirSync(dir)).toEqual(['config.json'])
  })
})
