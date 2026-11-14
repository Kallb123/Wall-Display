import type { PhotoPoolsService } from './service'

// Holds the running photo pools service between the photo pools plugin and usePhotoPools(). Not auto-imported.
let current: PhotoPoolsService | undefined

export function setPhotoPools(service: PhotoPoolsService | undefined): void {
  current = service
}

export function getPhotoPools(): PhotoPoolsService | undefined {
  return current
}
