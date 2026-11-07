import type { DisplayState } from '../../shared/display'
import { viewShowsPhotos } from '../../shared/layouts'
import type { LayoutSummary } from '../../shared/layouts'
import type { EventBus } from '../events/bus'

// The photo frame's clock (architecture §5.1). The server decides when a display
// moves on to its next photo, so that the remote, Home Assistant and the button
// can all skip with one command and the wall has no timer of its own to drift.
// While a display's view shows photos (`photo`, the week and photo hybrid, or a custom layout with a photo pane), a timer for that display emits `photo.next`
// on the bus every `intervalSeconds`; the control plugin turns that into a
// socket message and the wall fetches its next photo. A `photo.next` from
// anywhere else (the `photo_next` command) restarts that display's timer, so a
// skip is never followed straight away by a scheduled change. Moving between
// photo views keeps the timer running, and leaving them all stops it. A change to
// the custom layouts is looked at again, as a photo pane may have been added to
// the layout on the wall, or taken out of it. The interval can be changed while it runs
// (`setIntervalSeconds`, from the settings page). Everything it touches comes in through the options, so a
// test uses fake timers and a bus of its own.

export interface PhotoRotationOptions {
  bus: EventBus
  /** The displays in the config. */
  displayIds: readonly string[]
  /** The current state of a display, for the ones already on a photo view when this starts. */
  getState: (displayId: string) => Pick<DisplayState, 'view' | 'layout'>
  /** The custom layouts there are now (PR 5.17), asked each time a view is judged. Default: none. */
  layouts?: () => readonly LayoutSummary[]
  /** Seconds between photos (`photos.interval_seconds`). */
  intervalSeconds: number
  /** For tests. Default: the console. */
  log?: Pick<Console, 'warn' | 'error'>
}

export interface PhotoRotation {
  /** Whether a display's timer is running. For tests. */
  isRunning: (displayId: string) => boolean
  /** Changes the interval: every running timer restarts with a whole new interval from now, and timers started later use it too. */
  setIntervalSeconds: (seconds: number) => void
  /** Stops every timer and listens to the bus no more. */
  stop: () => void
}

export function startPhotoRotation(options: PhotoRotationOptions): PhotoRotation {
  const { bus, getState, layouts = () => [], log = console } = options
  let intervalSeconds = options.intervalSeconds
  const known = new Set(options.displayIds)
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let stopped = false

  function clear(displayId: string): void {
    clearTimeout(timers.get(displayId))
    timers.delete(displayId)
  }

  /** (Re)starts a display's timer for a whole interval from now. */
  function arm(displayId: string): void {
    clear(displayId)
    if (stopped) return
    timers.set(displayId, setTimeout(() => {
      timers.delete(displayId)
      // The bus handler below arms the next wait, as it does for every `photo.next`; this is for the case where it does not get to.
      bus.emit('photo.next', { displayId })
      if (!stopped && !timers.has(displayId) && inPhotoView(displayId)) arm(displayId)
    }, intervalSeconds * 1000))
  }

  /** Whether a state shows photos, with its layout looked up in the library as it is now. */
  function showsPhotos(state: Pick<DisplayState, 'view' | 'layout'>): boolean {
    return viewShowsPhotos(state.view, state.layout === null ? null : layouts().find(layout => layout.id === state.layout))
  }

  function inPhotoView(displayId: string): boolean {
    try {
      return showsPhotos(getState(displayId))
    } catch (error) {
      log.error(`[photos] ${displayId}: could not read the state: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const unsubscribe = [
    // A change of view starts or stops the timer. Any other change (brightness, an overlay) leaves a running timer alone, so it is not pushed back by every one.
    bus.on('state.updated', ({ displayId, state }) => {
      if (!known.has(displayId)) return
      if (!showsPhotos(state)) clear(displayId)
      else if (!timers.has(displayId)) arm(displayId)
    }),
    // A layout gained or lost its photo pane, or was deleted: judge every display again, keeping a timer that is running.
    bus.on('layouts.updated', () => {
      for (const id of known) {
        if (!inPhotoView(id)) clear(id)
        else if (!timers.has(id)) arm(id)
      }
    }),
    // A skip, or the timer's own message: a whole interval from now. Off the photo view there is no timer to restart.
    bus.on('photo.next', ({ displayId }) => {
      if (!known.has(displayId)) return
      if (inPhotoView(displayId)) arm(displayId)
      else clear(displayId)
    }),
  ]

  for (const id of known) {
    if (inPhotoView(id)) arm(id)
  }

  return {
    isRunning: displayId => timers.has(displayId),
    setIntervalSeconds(seconds) {
      intervalSeconds = seconds
      for (const displayId of [...timers.keys()]) arm(displayId)
    },
    stop() {
      stopped = true
      for (const off of unsubscribe) off()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}
