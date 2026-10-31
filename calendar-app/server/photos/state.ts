import type { PhotoService } from './service'

// Holds the running photo service between the photos plugin and usePhotos(). Not auto-imported.
let current: PhotoService | undefined

export function setPhotos(service: PhotoService | undefined): void {
  current = service
}

export function getPhotos(): PhotoService | undefined {
  return current
}
