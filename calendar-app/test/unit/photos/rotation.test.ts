import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDisplayState } from '../../../server/control/commands'
import { createEventBus } from '../../../server/events/bus'
import { startPhotoRotation } from '../../../server/photos/rotation'
import type { PhotoRotation } from '../../../server/photos/rotation'
import type { View } from '../../../shared/display'

// The rotation timers with a real bus and fake timers. The views are a table
// the test changes, announced with `state.updated` as the control service does.

const INTERVAL = 60
const SECOND = 1000

function setup(views: Record<string, View> = { hallway: 'month', kitchen: 'month' }, intervalSeconds = INTERVAL) {
  const bus = createEventBus()
  const emitted: string[] = []
  bus.on('photo.next', ({ displayId }) => emitted.push(displayId))
  const log = { warn: vi.fn(), error: vi.fn() }
  const rotation = startPhotoRotation({
    bus,
    displayIds: Object.keys(views),
    getState: (id) => {
      if (!(id in views)) throw new Error(`Unknown display "${id}"`)
      return { view: views[id]! }
    },
    intervalSeconds,
    log,
  })
  running.push(rotation)
  /** Moves a display to `view`, announcing it as the control service does. */
  const setView = (id: string, view: View) => {
    views[id] = view
    bus.emit('state.updated', { displayId: id, state: { ...defaultDisplayState(), view } })
  }
  return { bus, emitted, rotation, setView, views, log }
}

const running: PhotoRotation[] = []

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const rotation of running.splice(0)) rotation.stop()
  vi.useRealTimers()
})

describe('the photo rotation', () => {
  it('does nothing while no display is on the photo view', () => {
    const { emitted, rotation } = setup()

    vi.advanceTimersByTime(10 * INTERVAL * SECOND)

    expect(emitted).toEqual([])
    expect(rotation.isRunning('hallway')).toBe(false)
  })

  it('emits photo.next every interval once the display is on the photo view', () => {
    const { emitted, setView } = setup()

    setView('hallway', 'photo')
    vi.advanceTimersByTime(INTERVAL * SECOND - 1)
    expect(emitted).toEqual([])

    vi.advanceTimersByTime(1)
    expect(emitted).toEqual(['hallway'])

    vi.advanceTimersByTime(INTERVAL * SECOND)
    vi.advanceTimersByTime(INTERVAL * SECOND)
    expect(emitted).toEqual(['hallway', 'hallway', 'hallway'])
  })

  it('starts at once for a display that is already on the photo view', () => {
    const { emitted, rotation } = setup({ hallway: 'photo', kitchen: 'agenda' })

    expect(rotation.isRunning('hallway')).toBe(true)
    expect(rotation.isRunning('kitchen')).toBe(false)
    vi.advanceTimersByTime(INTERVAL * SECOND)
    expect(emitted).toEqual(['hallway'])
  })

  it('keeps a timer for each display', () => {
    const { emitted, setView } = setup()

    setView('hallway', 'photo')
    vi.advanceTimersByTime(20 * SECOND)
    setView('kitchen', 'photo')
    vi.advanceTimersByTime(40 * SECOND)
    expect(emitted).toEqual(['hallway'])

    vi.advanceTimersByTime(20 * SECOND)
    expect(emitted).toEqual(['hallway', 'kitchen'])
  })

  it('stops when the display leaves the photo view, and starts afresh when it comes back', () => {
    const { emitted, rotation, setView } = setup()
    setView('hallway', 'photo')
    vi.advanceTimersByTime(50 * SECOND)

    setView('hallway', 'agenda')
    expect(rotation.isRunning('hallway')).toBe(false)
    vi.advanceTimersByTime(10 * INTERVAL * SECOND)
    expect(emitted).toEqual([])

    setView('hallway', 'photo')
    vi.advanceTimersByTime(INTERVAL * SECOND - 1)
    expect(emitted).toEqual([])
    vi.advanceTimersByTime(1)
    expect(emitted).toEqual(['hallway'])
  })

  it('is not pushed back by other changes to a display on the photo view', () => {
    const { emitted, setView } = setup()
    setView('hallway', 'photo')
    vi.advanceTimersByTime(50 * SECOND)

    setView('hallway', 'photo')
    setView('hallway', 'photo')
    vi.advanceTimersByTime(10 * SECOND)

    expect(emitted).toEqual(['hallway'])
  })

  it('restarts a display\'s timer when a photo.next comes from elsewhere', () => {
    const { bus, emitted } = setup({ hallway: 'photo', kitchen: 'photo' })
    vi.advanceTimersByTime(50 * SECOND)

    // The photo_next command: emitted at once, and the next change is a whole interval away.
    bus.emit('photo.next', { displayId: 'hallway' })
    expect(emitted).toEqual(['hallway'])
    vi.advanceTimersByTime(10 * SECOND)
    // The other display was not restarted.
    expect(emitted).toEqual(['hallway', 'kitchen'])

    vi.advanceTimersByTime(40 * SECOND)
    expect(emitted).toEqual(['hallway', 'kitchen'])
    vi.advanceTimersByTime(10 * SECOND)
    expect(emitted).toEqual(['hallway', 'kitchen', 'hallway'])
  })

  it('starts no timer for a photo.next on a display that is not on the photo view', () => {
    const { bus, emitted, rotation } = setup()

    bus.emit('photo.next', { displayId: 'hallway' })
    vi.advanceTimersByTime(10 * INTERVAL * SECOND)

    expect(rotation.isRunning('hallway')).toBe(false)
    expect(emitted).toEqual(['hallway'])
  })

  it('ignores a display that is not in the config', () => {
    const { bus, emitted, rotation } = setup()

    bus.emit('state.updated', { displayId: 'attic', state: { ...defaultDisplayState(), view: 'photo' } })
    bus.emit('photo.next', { displayId: 'attic' })
    vi.advanceTimersByTime(10 * INTERVAL * SECOND)

    expect(rotation.isRunning('attic')).toBe(false)
    expect(emitted).toEqual(['attic'])
  })

  it('uses the interval it is given', () => {
    const { emitted } = setup({ hallway: 'photo' }, 5)

    vi.advanceTimersByTime(12 * SECOND)

    expect(emitted).toEqual(['hallway', 'hallway'])
  })

  it('stops everything, and hears the bus no more', () => {
    const { bus, emitted, rotation, setView } = setup({ hallway: 'photo', kitchen: 'month' })

    rotation.stop()
    setView('kitchen', 'photo')
    bus.emit('photo.next', { displayId: 'hallway' })
    vi.advanceTimersByTime(10 * INTERVAL * SECOND)

    expect(emitted).toEqual(['hallway'])
    expect(rotation.isRunning('hallway')).toBe(false)
    expect(rotation.isRunning('kitchen')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('logs a state it cannot read and does not run for that display', () => {
    const { bus, log, rotation, views } = setup({ hallway: 'photo' })
    delete views.hallway

    bus.emit('photo.next', { displayId: 'hallway' })

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('could not read the state'))
    expect(rotation.isRunning('hallway')).toBe(false)
  })
})
