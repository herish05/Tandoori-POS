import { describe, expect, it } from 'vitest'
import { parseBuildEnv } from '@main/config/env'

describe('parseBuildEnv', () => {
  it('applies safe defaults when nothing is configured', () => {
    expect(parseBuildEnv({})).toEqual({
      appEnv: 'development',
      logLevel: 'info',
      cloudApiUrl: ''
    })
  })

  it('reads explicit values', () => {
    expect(
      parseBuildEnv({
        MAIN_VITE_APP_ENV: 'production',
        MAIN_VITE_LOG_LEVEL: 'warn',
        MAIN_VITE_CLOUD_API_URL: 'https://api.example.com'
      })
    ).toEqual({ appEnv: 'production', logLevel: 'warn', cloudApiUrl: 'https://api.example.com' })
  })

  it('rejects an unknown environment', () => {
    expect(() => parseBuildEnv({ MAIN_VITE_APP_ENV: 'qa' })).toThrow(/Invalid build environment/)
  })

  it('rejects a malformed cloud URL', () => {
    expect(() => parseBuildEnv({ MAIN_VITE_CLOUD_API_URL: 'not a url' })).toThrow(
      /MAIN_VITE_CLOUD_API_URL/
    )
  })
})
