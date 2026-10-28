import type { OpenDatabase } from './client'

// Holds the open database between the boot plugin and useDb(). Not auto-imported.
let current: OpenDatabase | undefined

export function setDb(handle: OpenDatabase | undefined): void {
  current = handle
}

export function getDb(): OpenDatabase | undefined {
  return current
}
