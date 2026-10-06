/**
 * Decides whether an IPC message originates from our own renderer.
 * - Development: the Vite dev server origin.
 * - Production: the private `app://` protocol that serves the bundled renderer.
 * Any other frame (remote content, injected iframes) is rejected.
 */
export const APP_PROTOCOL = 'app'
export const APP_HOST = 'tandoori-pos'

export function isTrustedRendererUrl(url: string, devServerUrl: string | undefined): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (devServerUrl) {
    try {
      if (parsed.origin === new URL(devServerUrl).origin) return true
    } catch {
      return false
    }
  }
  return parsed.protocol === `${APP_PROTOCOL}:` && parsed.host === APP_HOST
}
