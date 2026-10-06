import { existsSync, statSync } from 'node:fs'
import { isAbsolute, normalize, relative, resolve } from 'node:path'

/**
 * Resolves a request path inside the renderer directory, refusing anything that escapes it
 * (path traversal). Returns null when the path is unsafe or does not exist.
 */
export function resolveRendererFile(rendererDir: string, requestPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const root = resolve(rendererDir)
  const relativePath =
    decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '')
  const candidate = resolve(root, normalize(relativePath))
  const rel = relative(root, candidate)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return null
  return candidate
}
