import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { resolveRendererFile } from './renderer-path'
import { APP_HOST, APP_PROTOCOL } from './trusted-origin'

/** Content Security Policy for the bundled renderer. No remote code, no inline scripts. */
export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** Development needs inline scripts + websockets for Vite HMR / React refresh. */
export const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/** Must be called before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

/** Serves the built renderer from `app://tandoori-pos/` with a strict CSP. Call after ready. */
export function registerAppProtocol(rendererDir: string): void {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) {
      return new Response('Not found', { status: 404 })
    }
    const file = resolveRendererFile(rendererDir, url.pathname)
    if (!file) {
      return new Response('Not found', { status: 404 })
    }
    const upstream = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(upstream.headers)
    headers.set('Content-Security-Policy', PRODUCTION_CSP)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(upstream.body, { status: upstream.status, headers })
  })
}
