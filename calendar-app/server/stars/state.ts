import type { StarsService } from './service'

// Holds the running stars service between the stars plugin and useStars(). Not auto-imported.
let current: StarsService | undefined

export function setStars(service: StarsService | undefined): void {
  current = service
}

export function getStars(): StarsService | undefined {
  return current
}
