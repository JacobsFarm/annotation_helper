/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { Bridge } from '@shared/ipc'

declare global {
  interface Window {
    /** Exposed by the preload. The renderer wraps it in `lib/api`. */
    bridge: Bridge
  }
}

export {}
