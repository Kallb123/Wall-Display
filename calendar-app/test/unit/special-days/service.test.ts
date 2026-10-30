import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpecialDay, SpecialDaysResolution } from '../../../shared/special-days'
import { createSpecialDaysService } from '../../../server/special-days/service'

// The service under fake timers, with the clock frozen at a chosen instant, a
// list of days the test edits, and a stub for the log. Resolution itself is
// tested in test/unit/shared/special-days.test.ts; these tests are about when
// it happens and when anyone is told.

const HOUR = 60 * 60 * 1000
const LONDON = 'Europe/London'

function specialDay(overrides: Partial<SpecialDay> = {}): SpecialDay {
  return {
    id: 'christmas',
    name: 'Christmas',
    month: 12,
    day: 25,
    year: null,
    repeat: 'yearly',
    lead: 'day',
    lead_days: null,
    tile_art: null,
    takeover: true,
    full_art: null,
    greeting: 'Merry Christmas',
    palette: 'warm',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function setup(days: SpecialDay[], startAt: string, timeZone = LONDON) {
  vi.setSystemTime(new Date(startAt))
  const state = { days, failure: undefined as Error | undefined }
  const load = vi.fn(() => {
    if (state.failure) throw state.failure
    return state.days
  })
  const onChange = vi.fn<(resolution: SpecialDaysResolution) => void>()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const service = createSpecialDaysService({ load, timeZone, onChange, log })
  const last = () => onChange.mock.calls.at(-1)![0]
  return { service, state, load, onChange, log, last }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('starting', () => {
  it('has nothing before start(), and resolves for today when it starts', () => {
    const { service, onChange, last } = setup([specialDay({ month: 6, day: 15 })], '2026-06-15T09:00:00Z')

    expect(service.get()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    service.start()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(service.get()).toBe(last())
    expect(service.get()).toMatchObject({ today: '2026-06-15', current: { id: 'christmas' }, takeover: { id: 'christmas', date: '2026-06-15' } })
    service.stop()
  })

  it('takes today from the display time zone, not the process or UTC', () => {
    // 22:30 UTC on the 14th is already the 15th in Paris (UTC+2), but not in London (UTC+1) or New York.
    const zones = { 'Europe/Paris': '2026-06-15', 'Europe/London': '2026-06-14', 'America/New_York': '2026-06-14' }
    for (const [zone, today] of Object.entries(zones)) {
      const { service, last } = setup([], '2026-06-14T22:30:00Z', zone)
      service.start()
      expect(last().today).toBe(today)
      service.stop()
    }
  })

  it('starts only once', () => {
    const { service, load } = setup([], '2026-06-15T09:00:00Z')

    service.start()
    service.start()

    expect(load).toHaveBeenCalledTimes(1)
    service.stop()
  })
})

describe('local midnight', () => {
  it('starts a takeover at midnight on the day and ends it at midnight after', async () => {
    // 13:00 in London (BST) on the 14th. Midnight is 23:00 UTC.
    const { service, onChange, last } = setup([specialDay({ month: 6, day: 15 })], '2026-06-14T12:00:00Z')
    service.start()
    expect(last()).toMatchObject({ today: '2026-06-14', current: null, takeover: null })

    await vi.advanceTimersByTimeAsync(11 * HOUR - 1)
    expect(onChange).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(last()).toMatchObject({ today: '2026-06-15', current: { id: 'christmas' }, takeover: { id: 'christmas', date: '2026-06-15' } })

    await vi.advanceTimersByTimeAsync(24 * HOUR - 1)
    expect(onChange).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(last()).toMatchObject({ today: '2026-06-16', current: null, takeover: null })
    // The tile stays decorated once the day has passed.
    expect(last().tiles.map(tile => tile.date)).toContain('2026-06-15')
    service.stop()
  })

  it('does it again every night', async () => {
    const { service, onChange } = setup([], '2026-06-14T12:00:00Z')
    service.start()

    await vi.advanceTimersByTimeAsync(5 * 24 * HOUR)

    // The start, then one a night (the date is part of what the displays hold).
    expect(onChange).toHaveBeenCalledTimes(6)
    service.stop()
  })

  it('moves at midnight when the clocks go forward (2026-03-29, a 23 hour day)', async () => {
    // 22:00 GMT on the 28th. Midnight is 00:00 UTC, and the next one is 23:00 UTC on the 29th, as BST begins.
    const { service, onChange, last } = setup([specialDay({ month: 3, day: 29 })], '2026-03-28T22:00:00Z')
    service.start()

    await vi.advanceTimersByTimeAsync(2 * HOUR - 1)
    expect(last().today).toBe('2026-03-28')
    await vi.advanceTimersByTimeAsync(1)
    expect(last()).toMatchObject({ today: '2026-03-29', takeover: { id: 'christmas' } })

    await vi.advanceTimersByTimeAsync(23 * HOUR - 1)
    expect(last().today).toBe('2026-03-29')
    expect(last().takeover).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(last()).toMatchObject({ today: '2026-03-30', takeover: null })
    expect(onChange).toHaveBeenCalledTimes(3)
    service.stop()
  })

  it('moves at midnight when the clocks go back (2026-10-25, a 25 hour day)', async () => {
    // 21:00 BST on the 24th. Midnight is 23:00 UTC, and the next one is 00:00 UTC on the 26th, as GMT returns.
    const { service, onChange, last } = setup([specialDay({ month: 10, day: 25 })], '2026-10-24T20:00:00Z')
    service.start()

    await vi.advanceTimersByTimeAsync(3 * HOUR - 1)
    expect(last().today).toBe('2026-10-24')
    await vi.advanceTimersByTimeAsync(1)
    expect(last()).toMatchObject({ today: '2026-10-25', takeover: { id: 'christmas' } })

    // The takeover is still up an hour after the clocks fell back, when the wall read 00:00 again.
    await vi.advanceTimersByTimeAsync(25 * HOUR - 1)
    expect(last().today).toBe('2026-10-25')
    expect(last().takeover).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(last()).toMatchObject({ today: '2026-10-26', takeover: null })
    expect(onChange).toHaveBeenCalledTimes(3)
    service.stop()
  })

  it('does not tell anyone during the day, when only its hourly look happens', async () => {
    const { service, onChange, load } = setup([specialDay({ month: 6, day: 15 })], '2026-06-14T23:00:00Z')
    service.start()
    expect(onChange).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(23 * HOUR)

    expect(onChange).toHaveBeenCalledTimes(1)
    // It did look, though: it never waits longer than an hour.
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(23)
    service.stop()
  })

  it('notices a clock that jumped, within the hour', async () => {
    const { service, last } = setup([], '2026-06-14T12:00:00Z')
    service.start()

    // Setting the system time fires no timer, as a clock correction doesn't.
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z'))
    await vi.advanceTimersByTimeAsync(HOUR)

    expect(last().today).toBe('2026-06-20')
    service.stop()
  })

  it('waits a second at least when it wakes just before midnight', async () => {
    // 100 ms to go. Looking again at once would only see the same date.
    const { service, load, last } = setup([], '2026-06-14T22:59:59.900Z')
    service.start()
    expect(load).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    expect(last().today).toBe('2026-06-15')
    service.stop()
  })
})

describe('refresh', () => {
  it('tells the app when an edit changed the answer', () => {
    const { service, state, onChange, last } = setup([], '2026-06-15T09:00:00Z')
    service.start()
    expect(last()).toMatchObject({ current: null, takeover: null })

    state.days = [specialDay({ month: 6, day: 15 })]
    service.refresh()

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(last()).toMatchObject({ current: { id: 'christmas' }, takeover: { id: 'christmas' } })
    expect(service.get()).toBe(last())
    service.stop()
  })

  it('says nothing when nothing changed', () => {
    const { service, onChange } = setup([specialDay({ month: 6, day: 15 })], '2026-06-15T09:00:00Z')
    service.start()

    service.refresh()
    service.refresh()

    expect(onChange).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('says nothing for an edit the wall cannot see', () => {
    // A day a long way off with a day of lead: nothing on the wall changes when it is renamed.
    const { service, state, onChange } = setup([specialDay({ month: 12, day: 25 })], '2026-06-15T09:00:00Z')
    service.start()
    expect(onChange).toHaveBeenCalledTimes(1)

    state.days = [specialDay({ month: 12, day: 25, greeting: 'Happy Christmas' })]
    service.refresh()

    expect(onChange).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('keeps the midnight timer to a single one', async () => {
    const { service } = setup([], '2026-06-14T12:00:00Z')
    service.start()

    service.refresh()
    service.refresh()

    expect(vi.getTimerCount()).toBe(1)
    service.stop()
  })

  it('resolves once before start() and leaves the timing to start()', () => {
    const { service, onChange } = setup([specialDay({ month: 6, day: 15 })], '2026-06-15T09:00:00Z')

    service.refresh()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    service.start()
    expect(vi.getTimerCount()).toBe(1)
    service.stop()
  })
})

describe('a failing load', () => {
  it('keeps the last good resolution, and logs each distinct failure once', async () => {
    const { service, state, onChange, log } = setup([specialDay({ month: 6, day: 15 })], '2026-06-15T09:00:00Z')
    service.start()
    const good = service.get()

    state.failure = new Error('database is locked')
    service.refresh()
    service.refresh()
    await vi.advanceTimersByTimeAsync(3 * HOUR)

    expect(service.get()).toBe(good)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toContain('database is locked')

    state.failure = new Error('disk I/O error')
    service.refresh()
    expect(log.warn).toHaveBeenCalledTimes(2)
    service.stop()
  })

  it('has nothing to show if the first load fails, tries again, and says when it works', async () => {
    const { service, state, onChange, log } = setup([specialDay({ month: 6, day: 15 })], '2026-06-15T09:00:00Z')
    state.failure = new Error('database is locked')

    service.start()
    expect(service.get()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    state.failure = undefined
    await vi.advanceTimersByTimeAsync(HOUR)

    expect(service.get()).toMatchObject({ today: '2026-06-15', takeover: { id: 'christmas' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(log.info.mock.calls.some(([message]) => String(message).includes('working again'))).toBe(true)
    service.stop()
  })

  it('does not let a throwing onChange stop it', async () => {
    const { service, onChange, log } = setup([], '2026-06-14T12:00:00Z')
    onChange.mockImplementation(() => {
      throw new Error('hub is down')
    })

    expect(() => service.start()).not.toThrow()
    await vi.advanceTimersByTimeAsync(12 * HOUR)

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(log.error.mock.calls[0]![0]).toContain('hub is down')
    service.stop()
  })
})

describe('stop', () => {
  it('clears the timer and emits nothing after it', async () => {
    const { service, onChange, load } = setup([], '2026-06-14T12:00:00Z')
    service.start()
    expect(vi.getTimerCount()).toBe(1)

    service.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(3 * 24 * HOUR)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('ignores a refresh or a start after it', () => {
    const { service, load, onChange } = setup([], '2026-06-14T12:00:00Z')
    service.start()
    service.stop()

    service.refresh()
    service.start()

    expect(load).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
