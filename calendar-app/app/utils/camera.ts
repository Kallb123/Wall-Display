import type { CameraState } from '../../shared/display'

// What the wall needs to know about the camera in the state. The server takes a
// camera down at its `until` and tells the display, but a wall running from its
// cache (or one whose socket has lagged) must not keep a feed up, so the page
// asks too. Pure: no Nuxt imports.

/** Whether the camera should be on the wall at `now`: there is one, and its time has not come. */
export function isCameraShowing(camera: CameraState | null, now: Date): boolean {
  return camera !== null && Date.parse(camera.until) > now.getTime()
}

/** Whole seconds until the camera goes, at least 0. */
export function cameraSecondsLeft(camera: CameraState, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(camera.until) - now.getTime()) / 1000))
}
