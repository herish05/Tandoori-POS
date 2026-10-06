/// <reference types="vite/client" />
import type { TandooriApi } from '@shared/api'

declare global {
  interface Window {
    /** Injected by the Electron preload script. Undefined when opened in a plain browser. */
    tandoori?: TandooriApi
  }
}

export {}
