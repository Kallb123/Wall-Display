import type { DisplayState } from '../../shared/display'
import type { EventBus } from '../events/bus'

// The photo frame's clock (architecture §5.1). The server decides when a display
// moves on to its next photo, so that the remote, Home Assistant and the button
// can all skip with one command and the wall has no timer of its own to drift.
// While a display's view is `photo`, a timer for that display emits `photo.next`
// on the bus every `intervalSeconds`; the control plugin turns that into a
// socket message and the wall fetches its next photo. A `photo.next` from
// anywhere else (the `photo_next` command) restarts that display's timer, so a
// skip is never followed straight away by a scheduled change. Leaving the photo
// view stops the timer. Everything it touches comes in through the options, so a
// test uses fake timers and a bus of its own.

export interface PhotoRotationOptions {
  bus: EventBus
  /** The displays in the config. */
  displayIds: readonly string[]
  /** The current state of a display, for the ones already on the photo view when this starts. */
  getState: (displayId: string) => Pick<DisplayState, 'view'>
  /** Seconds between photos (`photos.interval_seconds`). */
  intervalSeconds: number
  /** For tests. Default: the console. */
  log?: Pick<Console, 'warn' | 'error'>
}

export interface PhotoRotation {
  /** Whether a display's timer is running. For tests. */
  isRunning: (displayId: string) => boolean
  /** Stops every timer and listens to the bus no more. */
  stop: () => void
}

export function startPhotoRotation(options: PhotoRotationOptions): PhotoRotation {
  const { bus, intervalSeconds, getState, log = console } = options
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

  function inPhotoView(displayId: string): boolean {
    try {
      return getState(displayId).view === 'photo'
    } catch (error) {
      log.error(`[photos] ${displayId}: could not read the state: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const unsubscribe = [
    // A change of view starts or stops the timer. Any other change (brightness, an overlay) leaves a running timer alone, so it is not pushed back by every one.
    bus.on('state.updated', ({ displayId, state }) => {
      if (!known.has(displayId)) return
      if (state.view !== 'photo') clear(displayId)
      else if (!timers.has(displayId)) arm(displayId)
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
    stop() {
      stopped = true
      for (const off of unsubscribe) off()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}
