import type { DisplayControl } from './service'

// Holds the running display control between the control plugin and useDisplayControl(). Not auto-imported.
let current: DisplayControl | undefined

export function setDisplayControl(control: DisplayControl | undefined): void {
  current = control
}

export function getDisplayControl(): DisplayControl | undefined {
  return current
}
