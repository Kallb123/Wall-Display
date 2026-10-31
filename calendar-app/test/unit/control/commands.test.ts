import { describe, expect, it } from 'vitest'
import type { Command, DisplayState } from '../../../shared/display'
import { defaultDisplayState, expireState, nextExpiry, reduceCommand } from '../../../server/control/commands'
import type { ControlContext } from '../../../server/control/commands'

// The rules for what each command does and what time takes away, with a clock
// set by the test. Europe/London, while the process itself runs in Auckland.

const MINUTE = 60_000
const RETURN_MINUTES = 15

/** Wed 28 Oct 2026, 12:00 in London (GMT). */
const NOW = new Date('2026-10-28T12:00:00Z')

function ctx(now: Date | string = NOW, monthReturnMinutes = RETURN_MINUTES): ControlContext {
  return { now: new Date(now), timeZone: 'Europe/London', monthReturnMinutes }
}

function state(overrides: Partial<DisplayState> = {}): DisplayState {
  return { ...defaultDisplayState(), ...overrides }
}

/** A month pinned at `at`, which is the default now. */
function pinned(month: string, at: Date | string = NOW, overrides: Partial<DisplayState> = {}): DisplayState {
  return state({ view: 'month', month, month_set_at: new Date(at).toISOString(), ...overrides })
}

const setMonth = (month: string): Command => ({ type: 'set_month', month })

/** The pinned month after the commands, run one after the other from `start`. */
function monthAfter(start: DisplayState, now: string, ...commands: Command[]): string | null {
  return commands.reduce((current, command) => reduceCommand(current, command, ctx(now)), start).month
}

describe('the default state', () => {
  it('follows the current month in the month view, with the screen on', () => {
    expect(defaultDisplayState()).toMatchObject({ view: 'month', month: null, screen: 'on', overlay: null })
  })
})

describe('set_month', () => {
  it('pins a month and starts the return clock', () => {
    const next = reduceCommand(state(), setMonth('2026-12'), ctx())

    expect(next).toMatchObject({ view: 'month', month: '2026-12', month_set_at: NOW.toISOString() })
  })

  it('shows the month view, whatever view it was on', () => {
    expect(reduceCommand(state({ view: 'agenda' }), setMonth('2026-12'), ctx()).view).toBe('month')
    expect(reduceCommand(state({ view: 'photo' }), setMonth('next'), ctx()).view).toBe('month')
  })

  it('stores the current month as null, however it is asked for', () => {
    const away = pinned('2026-12')

    for (const month of ['current', '2026-10']) {
      expect(reduceCommand(away, setMonth(month), ctx())).toMatchObject({ month: null, month_set_at: null })
    }
  })

  it('steps with prev and next from the pinned month, or from the current one', () => {
    expect(monthAfter(state(), '2026-10-28T12:00:00Z', setMonth('next'))).toBe('2026-11')
    expect(monthAfter(state(), '2026-10-28T12:00:00Z', setMonth('prev'))).toBe('2026-09')
    expect(monthAfter(pinned('2026-12'), '2026-10-28T12:00:00Z', setMonth('next'))).toBe('2027-01')
    expect(monthAfter(pinned('2026-12'), '2026-10-28T12:00:00Z', setMonth('prev'))).toBe('2026-11')
  })

  it('goes back to null when prev or next lands on the current month', () => {
    expect(monthAfter(pinned('2026-11'), '2026-10-28T12:00:00Z', setMonth('prev'))).toBeNull()
    expect(monthAfter(pinned('2026-09'), '2026-10-28T12:00:00Z', setMonth('next'))).toBeNull()
  })

  it('clamps to 12 months either side of the current month', () => {
    expect(monthAfter(state(), '2026-10-28T12:00:00Z', setMonth('2028-01'))).toBe('2027-10')
    expect(monthAfter(state(), '2026-10-28T12:00:00Z', setMonth('2024-01'))).toBe('2025-10')
    expect(monthAfter(state(), '2026-10-28T12:00:00Z', setMonth('2027-10'))).toBe('2027-10')
    expect(monthAfter(state(), '2026-10-28T12:00:00Z', setMonth('2025-10'))).toBe('2025-10')
  })

  it('stays at the edge of the range when stepping past it', () => {
    expect(monthAfter(pinned('2027-10'), '2026-10-28T12:00:00Z', setMonth('next'))).toBe('2027-10')
    expect(monthAfter(pinned('2025-10'), '2026-10-28T12:00:00Z', setMonth('prev'))).toBe('2025-10')
  })

  it('works across the year boundary when it is December', () => {
    const december = '2026-12-10T12:00:00Z'

    expect(monthAfter(state(), december, setMonth('next'))).toBe('2027-01')
    // From January, prev is December, which is the current month.
    expect(monthAfter(pinned('2027-01', december), december, setMonth('prev'))).toBeNull()
    expect(monthAfter(state(), december, setMonth('2028-01'))).toBe('2027-12')
    expect(monthAfter(state(), december, setMonth('2025-11'))).toBe('2025-12')
  })

  it('works across the year boundary when it is January', () => {
    const january = '2027-01-10T12:00:00Z'

    expect(monthAfter(state(), january, setMonth('prev'))).toBe('2026-12')
    expect(monthAfter(pinned('2026-12', january), january, setMonth('next'))).toBeNull()
    expect(monthAfter(state(), january, setMonth('2025-12'))).toBe('2026-01')
    expect(monthAfter(state(), january, setMonth('2028-02'))).toBe('2028-01')
  })

  it('reads the current month in the display zone, not UTC', () => {
    // 23:30 UTC on 30 September is already 1 October in London.
    const lateSeptember = '2026-09-30T23:30:00Z'

    expect(monthAfter(state(), lateSeptember, setMonth('2026-10'))).toBeNull()
    expect(monthAfter(state(), lateSeptember, setMonth('next'))).toBe('2026-11')
  })

  it('restarts the return clock on every pick, even of the same month', () => {
    const first = reduceCommand(state(), setMonth('2026-12'), ctx(NOW))
    const later = new Date(NOW.getTime() + 10 * MINUTE)
    const again = reduceCommand(first, setMonth('2026-12'), ctx(later))

    expect(again.month_set_at).toBe(later.toISOString())
  })
})

describe('when the pinned month goes back to following the current month', () => {
  it('drops it when the view changes away from month', () => {
    const next = reduceCommand(pinned('2026-12'), { type: 'set_view', view: 'agenda' }, ctx())

    expect(next).toMatchObject({ view: 'agenda', month: null, month_set_at: null })
  })

  it('keeps it when the view is set to month again', () => {
    expect(reduceCommand(pinned('2026-12'), { type: 'set_view', view: 'month' }, ctx()).month).toBe('2026-12')
  })

  it('drops it for every other view', () => {
    for (const view of ['week', 'agenda', 'photo', 'night'] as const) {
      expect(reduceCommand(pinned('2026-12'), { type: 'set_view', view }, ctx()).month).toBeNull()
    }
  })

  it('goes back exactly at month_return_minutes, not before', () => {
    const start = pinned('2026-12')
    const edge = NOW.getTime() + RETURN_MINUTES * MINUTE

    expect(expireState(start, ctx(new Date(edge - 1))).month).toBe('2026-12')
    expect(expireState(start, ctx(new Date(edge))).month).toBeNull()
    expect(expireState(start, ctx(new Date(edge + 1))).month_set_at).toBeNull()
  })

  it('counts month_return_minutes from the display config', () => {
    const start = pinned('2026-12')

    expect(expireState(start, ctx(new Date(NOW.getTime() + 5 * MINUTE), 5)).month).toBeNull()
    expect(expireState(start, ctx(new Date(NOW.getTime() + 5 * MINUTE), 6)).month).toBe('2026-12')
  })

  it('restarts the clock when the month is changed again', () => {
    const later = new Date(NOW.getTime() + 10 * MINUTE)
    const moved = reduceCommand(pinned('2026-12'), setMonth('next'), ctx(later))
    const edge = later.getTime() + RETURN_MINUTES * MINUTE

    // The first pin would have gone back at 15 minutes; the second has until 25.
    expect(expireState(moved, ctx(new Date(NOW.getTime() + RETURN_MINUTES * MINUTE))).month).toBe('2027-01')
    expect(expireState(moved, ctx(new Date(edge - 1))).month).toBe('2027-01')
    expect(expireState(moved, ctx(new Date(edge))).month).toBeNull()
  })

  it('drops a month that has become the current month when the calendar rolls over', () => {
    const start = pinned('2026-11', '2026-10-31T23:55:00Z')

    expect(expireState(start, ctx('2026-10-31T23:58:00Z')).month).toBe('2026-11')
    // Midnight on 1 November in London (GMT again by then), well inside the 15 minutes.
    expect(expireState(start, ctx('2026-11-01T00:00:00Z'))).toMatchObject({ month: null, month_set_at: null })
  })

  it('drops a month that has fallen out of the 12-month range', () => {
    // Pinned long ago at the edge (a state stored before a restart, say) and the range has moved on.
    const stale = pinned('2027-10', '2026-10-28T12:00:00Z')

    expect(expireState(stale, ctx('2026-10-28T12:05:00Z')).month).toBe('2027-10')
    expect(expireState({ ...stale, month: '2028-01' }, ctx('2026-10-28T12:05:00Z')).month).toBeNull()
    expect(expireState({ ...stale, month: '2024-06' }, ctx('2026-10-28T12:05:00Z')).month).toBeNull()
  })

  it('drops a month that has nothing to count from', () => {
    expect(expireState(state({ month: '2026-12', month_set_at: null }), ctx()).month).toBeNull()
  })

  it('drops a month that is set while the view is not month', () => {
    expect(expireState(pinned('2026-12', NOW, { view: 'week' }), ctx())).toMatchObject({ month: null, month_set_at: null })
  })

  it('clears a set_at left without a month', () => {
    expect(expireState(state({ month: null, month_set_at: NOW.toISOString() }), ctx()).month_set_at).toBeNull()
  })
})

describe('next_view', () => {
  const viewsFrom = (view: DisplayState['view']) => reduceCommand(state({ view }), { type: 'next_view' }, ctx()).view

  it('cycles month, agenda, week and back', () => {
    expect(viewsFrom('month')).toBe('agenda')
    expect(viewsFrom('agenda')).toBe('week')
    expect(viewsFrom('week')).toBe('month')
  })

  it('goes to the first calendar view from photo and night', () => {
    expect(viewsFrom('photo')).toBe('month')
    expect(viewsFrom('night')).toBe('month')
  })

  it('drops the pinned month when it leaves the month view', () => {
    expect(reduceCommand(pinned('2026-12'), { type: 'next_view' }, ctx())).toMatchObject({ view: 'agenda', month: null, month_set_at: null })
  })
})

describe('the other commands', () => {
  it('set the screen, brightness and photo source', () => {
    expect(reduceCommand(state(), { type: 'set_screen', screen: 'off' }, ctx()).screen).toBe('off')
    expect(reduceCommand(state(), { type: 'set_brightness', brightness: 30 }, ctx()).brightness).toBe(30)
    expect(reduceCommand(state(), { type: 'set_photo_source', photo_source: 'google' }, ctx()).photo_source).toBe('google')
  })

  it('switch the automatic policies on and off', () => {
    expect(defaultDisplayState()).toMatchObject({ auto_presence: true, auto_brightness: true })

    const off = reduceCommand(state(), { type: 'set_auto_presence', auto_presence: false }, ctx())
    expect(off).toMatchObject({ auto_presence: false, auto_brightness: true })
    expect(reduceCommand(off, { type: 'set_auto_presence', auto_presence: true }, ctx()).auto_presence).toBe(true)

    const dim = reduceCommand(state(), { type: 'set_auto_brightness', auto_brightness: false }, ctx())
    expect(dim).toMatchObject({ auto_presence: true, auto_brightness: false })
    expect(reduceCommand(dim, { type: 'set_auto_brightness', auto_brightness: true }, ctx()).auto_brightness).toBe(true)
  })

  it('leave everything else as it was', () => {
    const start = pinned('2026-12', NOW, { brightness: 55 })

    expect(reduceCommand(start, { type: 'set_screen', screen: 'off' }, ctx())).toEqual({ ...start, screen: 'off' })
  })

  it('photo_next and refresh change nothing', () => {
    const start = pinned('2026-12')

    expect(reduceCommand(start, { type: 'photo_next' }, ctx())).toBe(start)
    expect(reduceCommand(start, { type: 'refresh' }, ctx())).toBe(start)
  })

  it('does not change the input state', () => {
    const start = pinned('2026-12')
    const copy = structuredClone(start)

    reduceCommand(start, { type: 'set_view', view: 'agenda' }, ctx())

    expect(start).toEqual(copy)
  })
})

describe('the overlay', () => {
  const overlay = (text: string, extra: { icon?: string, ttl?: number } = {}): Command => ({ type: 'set_overlay', overlay: { text, ...extra } })

  it('with a ttl lasts that many seconds', () => {
    const next = reduceCommand(state(), overlay('Bins out tonight', { icon: 'trash', ttl: 3600 }), ctx())

    expect(next.overlay).toEqual({ text: 'Bins out tonight', icon: 'trash', until: '2026-10-28T13:00:00.000Z' })
  })

  it('without a ttl stays until cleared, and without an icon has none', () => {
    const next = reduceCommand(state(), overlay('Hello'), ctx())

    expect(next.overlay).toEqual({ text: 'Hello', icon: null, until: null })
    expect(expireState(next, ctx('2030-01-01T00:00:00Z')).overlay).not.toBeNull()
  })

  it('goes at its until, not before', () => {
    const next = reduceCommand(state(), overlay('Hello', { ttl: 60 }), ctx())

    expect(expireState(next, ctx('2026-10-28T12:00:59.999Z')).overlay).not.toBeNull()
    expect(expireState(next, ctx('2026-10-28T12:01:00Z')).overlay).toBeNull()
  })

  it('is cleared by null', () => {
    const shown = reduceCommand(state(), overlay('Hello'), ctx())

    expect(reduceCommand(shown, { type: 'set_overlay', overlay: null }, ctx()).overlay).toBeNull()
  })

  it('is replaced by a new one', () => {
    const shown = reduceCommand(state(), overlay('One', { ttl: 60 }), ctx())

    expect(reduceCommand(shown, overlay('Two'), ctx()).overlay).toEqual({ text: 'Two', icon: null, until: null })
  })
})

describe('preview_special_day', () => {
  const previewDay = (id: string, seconds = 60): Command => ({ type: 'preview_special_day', id, seconds })
  const previewScene = (scene: string, seconds = 60): Command => ({ type: 'preview_special_day', scene, seconds })

  it('previews a special day for the seconds asked', () => {
    expect(reduceCommand(state(), previewDay('christmas', 90), ctx()).preview).toEqual({ special_day: 'christmas', until: '2026-10-28T12:01:30.000Z' })
  })

  it('previews a scene for the seconds asked', () => {
    expect(reduceCommand(state(), previewScene('birthday', 5), ctx()).preview).toEqual({ scene: 'birthday', until: '2026-10-28T12:00:05.000Z' })
  })

  it('has nothing running to begin with', () => {
    expect(defaultDisplayState().preview).toBeNull()
  })

  it('replaces a preview that is running, whichever kind it was', () => {
    const first = reduceCommand(state(), previewDay('christmas', 600), ctx())
    const second = reduceCommand(first, previewScene('birthday', 30), ctx())

    expect(second.preview).toEqual({ scene: 'birthday', until: '2026-10-28T12:00:30.000Z' })
    expect(reduceCommand(second, previewDay('easter'), ctx()).preview).toEqual({ special_day: 'easter', until: '2026-10-28T12:01:00.000Z' })
  })

  it('changes nothing else about the state', () => {
    const start = pinned('2026-12', NOW, { view: 'month', brightness: 40, overlay: { text: 'Hi', icon: null, until: null } })

    expect(reduceCommand(start, previewDay('christmas'), ctx())).toEqual({ ...start, preview: { special_day: 'christmas', until: '2026-10-28T12:01:00.000Z' } })
  })

  it('goes at its until, not before', () => {
    const next = reduceCommand(state(), previewDay('christmas'), ctx())

    expect(expireState(next, ctx('2026-10-28T12:00:59.999Z')).preview).not.toBeNull()
    expect(expireState(next, ctx('2026-10-28T12:01:00Z')).preview).toBeNull()
  })

  it('goes with an expired one on any other command, and the command still applies', () => {
    const next = reduceCommand(state(), previewScene('birthday', 5), ctx())

    expect(reduceCommand(next, { type: 'set_view', view: 'agenda' }, ctx('2026-10-28T12:00:10Z'))).toMatchObject({ view: 'agenda', preview: null })
  })

  it('is not stopped by other commands while it runs', () => {
    const next = reduceCommand(state(), previewDay('christmas'), ctx())

    expect(reduceCommand(next, { type: 'set_view', view: 'week' }, ctx('2026-10-28T12:00:30Z')).preview).toEqual(next.preview)
  })
})

describe('expireState', () => {
  it('returns the same object when nothing has changed', () => {
    const start = pinned('2026-12')

    const plain = state()

    expect(expireState(start, ctx())).toBe(start)
    expect(expireState(plain, ctx())).toBe(plain)
  })

  it('returns a new object, leaving the old one alone, when something expired', () => {
    const start = pinned('2026-12')

    const next = expireState(start, ctx('2026-10-28T13:00:00Z'))

    expect(next).not.toBe(start)
    expect(start.month).toBe('2026-12')
  })

  it('clears an ended preview and leaves a running one', () => {
    const start = state({ preview: { special_day: 'christmas', until: '2026-10-28T12:05:00.000Z' } })

    expect(expireState(start, ctx('2026-10-28T12:04:59Z'))).toBe(start)
    expect(expireState(start, ctx('2026-10-28T12:05:00Z')).preview).toBeNull()
  })

  it('expires the month and the overlay together', () => {
    const start = pinned('2026-12', NOW, { overlay: { text: 'Hi', icon: null, until: '2026-10-28T12:05:00Z' } })

    expect(expireState(start, ctx('2026-10-28T12:30:00Z'))).toMatchObject({ month: null, overlay: null })
  })
})

describe('nextExpiry', () => {
  it('is null with nothing to expire', () => {
    expect(nextExpiry(state(), ctx())).toBeNull()
    expect(nextExpiry(state({ overlay: { text: 'Hi', icon: null, until: null } }), ctx())).toBeNull()
  })

  it('is when the pinned month returns', () => {
    expect(nextExpiry(pinned('2026-12'), ctx())).toEqual(new Date(NOW.getTime() + RETURN_MINUTES * MINUTE))
  })

  it('is when the overlay ends', () => {
    expect(nextExpiry(state({ overlay: { text: 'Hi', icon: null, until: '2026-10-28T12:10:00.000Z' } }), ctx())).toEqual(new Date('2026-10-28T12:10:00Z'))
  })

  it('is when the preview ends', () => {
    expect(nextExpiry(state({ preview: { scene: 'birthday', until: '2026-10-28T12:01:00.000Z' } }), ctx())).toEqual(new Date('2026-10-28T12:01:00Z'))
  })

  it('is the earliest of the month, the overlay and the preview', () => {
    const preview = { special_day: 'christmas', until: '2026-10-28T12:01:00.000Z' }
    const overlay = { text: 'Hi', icon: null, until: '2026-10-28T12:05:00.000Z' }

    expect(nextExpiry(pinned('2026-12', NOW, { overlay, preview }), ctx())).toEqual(new Date('2026-10-28T12:01:00Z'))
    expect(nextExpiry(pinned('2026-12', NOW, { overlay, preview: { ...preview, until: '2026-10-28T12:09:00.000Z' } }), ctx())).toEqual(new Date('2026-10-28T12:05:00Z'))
  })

  it('is the earliest of the two', () => {
    const early = pinned('2026-12', NOW, { overlay: { text: 'Hi', icon: null, until: '2026-10-28T12:05:00.000Z' } })
    const late = pinned('2026-12', NOW, { overlay: { text: 'Hi', icon: null, until: '2026-10-28T14:00:00.000Z' } })

    expect(nextExpiry(early, ctx())).toEqual(new Date('2026-10-28T12:05:00Z'))
    expect(nextExpiry(late, ctx())).toEqual(new Date(NOW.getTime() + RETURN_MINUTES * MINUTE))
  })
})
