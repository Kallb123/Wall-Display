import { describe, expect, it } from 'vitest'
import { commandSchema } from '../../../shared/display'
import type { CameraSummary, Command, CommandInput, DisplayState } from '../../../shared/display'
import { defaultDisplayState, expireState, nextExpiry, reduceCommand } from '../../../server/control/commands'
import type { ControlContext } from '../../../server/control/commands'

// `set_camera`: a camera's feed over the view for a while (the doorbell rang),
// waking the screen and putting it back to sleep afterwards.

const NOW = new Date('2026-10-28T12:00:00Z')
const SECOND = 1000

const FRONT_DOOR: CameraSummary = { id: 'front-door', name: 'Front door', url: 'http://go2rtc.local:1984/stream.html?src=front_door', kind: 'page' }
const GARDEN: CameraSummary = { id: 'garden', name: 'Garden', url: 'http://go2rtc.local:1984/api/stream.mjpeg?src=garden', kind: 'image' }

function ctx(now: Date | number = NOW, cameras: CameraSummary[] = [FRONT_DOOR, GARDEN]): ControlContext {
  return { now: new Date(now), timeZone: 'Europe/London', monthReturnMinutes: 15, weekStart: 'monday', photosConfigured: true, layouts: [], cameras }
}

function state(overrides: Partial<DisplayState> = {}): DisplayState {
  return { ...defaultDisplayState(), ...overrides }
}

/** The command with the schema's defaults filled in, as the API and the config hand it over. */
const command = (input: Omit<Extract<CommandInput, { type: 'set_camera' }>, 'type'>): Command => commandSchema.parse({ type: 'set_camera', ...input })

const later = (ms: number) => NOW.getTime() + ms

describe('the set_camera command', () => {
  it('fills in a minute and waking the screen', () => {
    expect(command({ camera: 'front-door' })).toEqual({ type: 'set_camera', camera: 'front-door', seconds: 60, wake: true })
  })

  it('refuses a time out of range, and leaves nothing out', () => {
    expect(commandSchema.safeParse({ type: 'set_camera', camera: 'front-door', seconds: 4 }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'set_camera', camera: 'front-door', seconds: 1801 }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'set_camera', camera: '' }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'set_camera' }).success).toBe(false)
  })
})

describe('showing a camera', () => {
  it('puts the camera from the config on the wall until its time is up', () => {
    const next = reduceCommand(state(), command({ camera: 'front-door', seconds: 90 }), ctx())

    expect(next.camera).toEqual({ ...FRONT_DOOR, until: new Date(later(90 * SECOND)).toISOString(), restore_screen: false })
    // Nothing else moves: the view carries on underneath.
    expect(next.view).toBe('month')
  })

  it('turns a screen that is off on, and off again when the camera goes', () => {
    const shown = reduceCommand(state({ screen: 'off' }), command({ camera: 'front-door', seconds: 30 }), ctx())
    expect(shown).toMatchObject({ screen: 'on', camera: { restore_screen: true } })

    expect(expireState(shown, ctx(later(29 * SECOND)))).toBe(shown)
    expect(expireState(shown, ctx(later(30 * SECOND)))).toMatchObject({ screen: 'off', camera: null })
  })

  it('leaves the screen alone without wake', () => {
    const shown = reduceCommand(state({ screen: 'off' }), command({ camera: 'front-door', wake: false }), ctx())

    expect(shown).toMatchObject({ screen: 'off', camera: { id: 'front-door', restore_screen: false } })
  })

  it('leaves a screen that was already on, on, when the camera goes', () => {
    const shown = reduceCommand(state(), command({ camera: 'front-door', seconds: 30 }), ctx())

    expect(expireState(shown, ctx(later(30 * SECOND)))).toMatchObject({ screen: 'on', camera: null })
  })

  it('starts the time again when shown again, and keeps the screen to turn off', () => {
    const first = reduceCommand(state({ screen: 'off' }), command({ camera: 'front-door', seconds: 30 }), ctx())
    const again = reduceCommand(first, command({ camera: 'garden', seconds: 30 }), ctx(later(20 * SECOND)))

    expect(again.camera).toMatchObject({ id: 'garden', kind: 'image', until: new Date(later(50 * SECOND)).toISOString(), restore_screen: true })
    expect(expireState(again, ctx(later(50 * SECOND)))).toMatchObject({ screen: 'off', camera: null })
  })

  it('changes nothing for a camera the config does not have', () => {
    const before = state()

    expect(reduceCommand(before, command({ camera: 'attic' }), ctx())).toEqual(before)
  })
})

describe('taking a camera down', () => {
  it('clears it, and turns the screen off again if the camera turned it on', () => {
    const shown = reduceCommand(state({ screen: 'off' }), command({ camera: 'front-door' }), ctx())

    expect(reduceCommand(shown, command({ camera: null }), ctx())).toMatchObject({ screen: 'off', camera: null })
  })

  it('does nothing with no camera up', () => {
    const before = state({ screen: 'off' })

    expect(reduceCommand(before, command({ camera: null }), ctx())).toEqual(before)
  })

  it('leaves the screen as someone set it while the camera was up', () => {
    const shown = reduceCommand(state({ screen: 'off' }), command({ camera: 'front-door', seconds: 30 }), ctx())
    // Someone turns it off and on again (or a policy says on): theirs is the last word.
    const chosen = reduceCommand(shown, { type: 'set_screen', screen: 'on' }, ctx(later(10 * SECOND)))
    expect(chosen.camera?.restore_screen).toBe(false)

    expect(expireState(chosen, ctx(later(30 * SECOND)))).toMatchObject({ screen: 'on', camera: null })
  })
})

describe('nextExpiry', () => {
  it('is when the camera goes', () => {
    const shown = reduceCommand(state(), command({ camera: 'front-door', seconds: 45 }), ctx())

    expect(nextExpiry(shown, ctx())).toEqual(new Date(later(45 * SECOND)))
  })

  it('is the sooner of the camera and an overlay', () => {
    const shown = reduceCommand(state({ overlay: { text: 'Bins', icon: null, until: new Date(later(10 * SECOND)).toISOString() } }), command({ camera: 'front-door' }), ctx())

    expect(nextExpiry(shown, ctx())).toEqual(new Date(later(10 * SECOND)))
  })
})
