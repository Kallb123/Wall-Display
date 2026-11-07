import type { LayoutsService } from './service'

// Holds the running layouts service between the layouts plugin and useLayouts(). Not auto-imported.
let current: LayoutsService | undefined

export function setLayouts(service: LayoutsService | undefined): void {
  current = service
}

export function getLayouts(): LayoutsService | undefined {
  return current
}
