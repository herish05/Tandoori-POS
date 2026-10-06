import { app, type Session } from 'electron'
import type { Logger } from '../logging/log-manager'
import { DEVELOPMENT_CSP } from './app-protocol'
import { isTrustedRendererUrl } from './trusted-origin'

/** Applies the Electron security baseline to the default session. */
export function hardenSession(
  target: Session,
  options: { devServerUrl: string | undefined; securityLogger: Logger }
): void {
  // Deny every permission request (camera, geolocation, notifications, ...). Features that need
  // one (e.g. notifications for reservations) must opt in explicitly in a later phase.
  target.setPermissionRequestHandler((_wc, permission, callback) => {
    options.securityLogger.warn('Permission request denied', { permission })
    callback(false)
  })
  target.setPermissionCheckHandler(() => false)

  if (options.devServerUrl) {
    target.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [DEVELOPMENT_CSP]
        }
      })
    })
  }
}

/** Blocks navigation, popups and webviews for every web contents created by the app. */
export function hardenWebContents(options: {
  devServerUrl: string | undefined
  securityLogger: Logger
}): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererUrl(url, options.devServerUrl)) {
        event.preventDefault()
        options.securityLogger.warn('Blocked navigation', { url })
      }
    })
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
      options.securityLogger.warn('Blocked <webview> attachment')
    })
    contents.setWindowOpenHandler(({ url }) => {
      options.securityLogger.warn('Blocked window.open', { url })
      return { action: 'deny' }
    })
  })
}
