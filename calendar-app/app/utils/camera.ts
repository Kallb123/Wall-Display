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

/** A camera as the remote lists it: by id and name, and whether it is the one on the wall. */
export interface CameraRow {
  id: string
  name: string
  live: boolean
}

/**
 * The remote's camera list: each camera in the config, in config order, with
 * the one on the wall marked. A camera on the wall that the list doesn't have
 * (the config changed under it) goes first, so it can still be taken down.
 */
export function cameraRows(cameras: readonly { id: string, name: string }[], live: { id: string, name: string } | null): CameraRow[] {
  const rows = cameras.map(camera => ({ id: camera.id, name: camera.name, live: camera.id === live?.id }))
  if (live && !rows.some(row => row.live)) rows.unshift({ id: live.id, name: live.name, live: true })
  return rows
}
