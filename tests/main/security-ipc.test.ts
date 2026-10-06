import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mapError, AppError } from '@main/ipc/errors'
import { resolveRendererFile } from '@main/security/renderer-path'
import { isTrustedRendererUrl } from '@main/security/trusted-origin'
import { z } from 'zod'

describe('isTrustedRendererUrl', () => {
  const dev = 'http://localhost:5173'

  it('accepts the dev server origin only in development', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/#/pos', dev)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/', undefined)).toBe(false)
  })

  it('accepts the private app protocol', () => {
    expect(isTrustedRendererUrl('app://tandoori-pos/index.html', undefined)).toBe(true)
  })

  it('rejects other origins, hosts and garbage', () => {
    expect(isTrustedRendererUrl('https://evil.example.com/', dev)).toBe(false)
    expect(isTrustedRendererUrl('app://evil/index.html', undefined)).toBe(false)
    expect(isTrustedRendererUrl('file:///etc/passwd', dev)).toBe(false)
    expect(isTrustedRendererUrl('not a url', dev)).toBe(false)
  })
})

describe('resolveRendererFile', () => {
  let root: string
  let outside: string
  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'tpos-renderer-'))
    root = join(base, 'renderer')
    outside = join(base, 'secret.txt')
    mkdirSync(join(root, 'assets'), { recursive: true })
    writeFileSync(join(root, 'index.html'), '<html></html>')
    writeFileSync(join(root, 'assets', 'app.js'), '1')
    writeFileSync(outside, 'secret')
  })
  afterEach(() => {
    rmSync(join(root, '..'), { recursive: true, force: true })
  })

  it('serves index.html for the root and known files', () => {
    expect(resolveRendererFile(root, '/')).toBe(join(root, 'index.html'))
    expect(resolveRendererFile(root, '/assets/app.js')).toBe(join(root, 'assets', 'app.js'))
  })

  it('refuses path traversal, including encoded forms', () => {
    expect(resolveRendererFile(root, '/../secret.txt')).toBeNull()
    expect(resolveRendererFile(root, '/%2e%2e/secret.txt')).toBeNull()
    expect(resolveRendererFile(root, '/assets/../../secret.txt')).toBeNull()
    expect(resolveRendererFile(root, '/%00')).toBeNull()
  })

  it('returns null for missing files and directories', () => {
    expect(resolveRendererFile(root, '/missing.js')).toBeNull()
    expect(resolveRendererFile(root, '/assets')).toBeNull()
  })
})

describe('mapError', () => {
  it('keeps AppError messages for staff', () => {
    const { payload } = mapError(new AppError('NOT_AVAILABLE', 'Window gone'))
    expect(payload).toMatchObject({ code: 'NOT_AVAILABLE', message: 'Window gone' })
    expect(payload.requestId).toHaveLength(8)
  })

  it('converts validation errors to a friendly message without leaking schema detail', () => {
    const result = z.object({ a: z.string() }).safeParse({ a: 1 })
    if (result.success) throw new Error('expected failure')
    const { payload } = mapError(result.error)
    expect(payload.code).toBe('VALIDATION_ERROR')
    expect(payload.message).not.toContain('expected')
  })

  it('hides internal error details but quotes a reference', () => {
    const { payload, technical } = mapError(new Error('SQLITE_CORRUPT: /home/ari/secret.db'))
    expect(payload.code).toBe('INTERNAL_ERROR')
    expect(payload.message).not.toContain('SQLITE')
    expect(payload.message).toContain(payload.requestId)
    expect(technical).toBeInstanceOf(Error)
  })
})
