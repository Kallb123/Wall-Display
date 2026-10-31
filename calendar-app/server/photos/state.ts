import type { PhotoRotation } from './rotation'
import type { PhotoService } from './service'

// Holds the running photo service between the photos plugin and usePhotos(). Not auto-imported.
let current: PhotoService | undefined

export function setPhotos(service: PhotoService | undefined): void {
  current = service
}

export function getPhotos(): PhotoService | undefined {
  return current
}

// The photo frame's rotation timers, kept the same way.
let rotation: PhotoRotation | undefined

export function setPhotoRotation(next: PhotoRotation | undefined): void {
  rotation = next
}

export function getPhotoRotation(): PhotoRotation | undefined {
  return rotation
}
