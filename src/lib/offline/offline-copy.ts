declare global {
  interface Window {
    /** Set by public/sw.js on the stored on-the-road copy it serves offline. */
    __offlineCopy?: number
  }
}

/** True when this page is the service worker's stored copy, not fresh from the network. */
export function isOfflineCopy(): boolean {
  return window.__offlineCopy === 1
}
