import { describe, expect, it } from 'vitest'
import { NIGHT_SPOTS, nightAlarm, nightFirstEvent, nightPosition } from '../../../app/utils/night'
import type { CalendarEvent } from '../../../shared/types/events'

const LONDON = 'Europe/London'
// Wed 28 Oct 2026, 22:30 in London (the clocks went back on the 25th, so that is 22:30Z).
const NOW = new Date('2026-10-28T22:30:00Z')

let nextId = 1

function timed(start: string, end: string, title = 'Event', id = nextId++): CalendarEvent {
  return { id, calendar_id: 'family', title, display_title: title, location: null, start, end, all_day: false, start_date: null, end_date: null, people: [] }
}

function allDay(first: string, after: string, title = 'All day', id = nextId++): CalendarEvent {
  return { ...timed(`${first}T00:00:00.000Z`, `${after}T00:00:00.000Z`, title, id), all_day: true, start_date: first, end_date: after }
}

describe('nightFirstEvent', () => {
  it('is null with no events', () => {
    expect(nightFirstEvent([], NOW, LONDON)).toBeNull()
  })

  it('is the earliest timed event to come, whatever the order given, with its day and time', () => {
    const later = timed('2026-10-29T15:00:00Z', '2026-10-29T16:00:00Z', 'Later')
    const sooner = timed('2026-10-29T08:30:00Z', '2026-10-29T09:30:00Z', 'Swimming')

    const found = nightFirstEvent([later, sooner], NOW, LONDON)

    expect(found).toMatchObject({ day: 'Tomorrow', time: '08:30' })
    expect(found?.event.display_title).toBe('Swimming')
  })

  it('calls an event later this evening Today', () => {
    const late = timed('2026-10-28T23:15:00Z', '2026-10-28T23:45:00Z', 'Late call')

    expect(nightFirstEvent([late], NOW, LONDON)).toMatchObject({ day: 'Today', time: '23:15' })
  })

  it('leaves out all-day events, even when one starts first', () => {
    const birthday = allDay('2026-10-29', '2026-10-30', 'Birthday')
    const swimming = timed('2026-10-29T08:30:00Z', '2026-10-29T09:30:00Z', 'Swimming')

    expect(nightFirstEvent([birthday, swimming], NOW, LONDON)?.event.display_title).toBe('Swimming')
    expect(nightFirstEvent([birthday], NOW, LONDON)).toBeNull()
  })

  it('leaves out an event that is over or already on, and counts one that starts exactly now as on', () => {
    const over = timed('2026-10-28T20:00:00Z', '2026-10-28T21:00:00Z', 'Over')
    const on = timed('2026-10-28T22:00:00Z', '2026-10-28T23:00:00Z', 'On')
    const starts = timed('2026-10-28T22:30:00Z', '2026-10-28T23:00:00Z', 'Starts')

    expect(nightFirstEvent([over, on, starts], NOW, LONDON)).toBeNull()
  })

  it('looks 24 hours ahead and no further', () => {
    const justInside = timed('2026-10-29T22:29:00Z', '2026-10-29T23:00:00Z', 'Just inside')
    const exactly = timed('2026-10-29T22:30:00Z', '2026-10-29T23:00:00Z', 'Exactly a day')
    const beyond = timed('2026-10-30T08:00:00Z', '2026-10-30T09:00:00Z', 'Beyond')

    expect(nightFirstEvent([exactly, beyond], NOW, LONDON)).toBeNull()
    expect(nightFirstEvent([exactly, beyond, justInside], NOW, LONDON)?.event.display_title).toBe('Just inside')
  })

  it('takes the day from the display\'s time zone, not UTC', () => {
    // 23:30 in London on the 28th is 23:30Z: still Today. In Auckland (UTC+13) it is 12:30 on the 29th.
    const event = timed('2026-10-28T23:30:00Z', '2026-10-29T00:30:00Z', 'Late')

    expect(nightFirstEvent([event], NOW, LONDON)).toMatchObject({ day: 'Today', time: '23:30' })
    expect(nightFirstEvent([event], NOW, 'Pacific/Auckland')).toMatchObject({ day: 'Today', time: '12:30' })
  })

  it('breaks a tie by the lower id', () => {
    const a = timed('2026-10-29T08:30:00Z', '2026-10-29T09:00:00Z', 'A', 20)
    const b = timed('2026-10-29T08:30:00Z', '2026-10-29T09:00:00Z', 'B', 10)

    expect(nightFirstEvent([a, b], NOW, LONDON)?.event.display_title).toBe('B')
  })
})

describe('nightAlarm', () => {
  it('is null for none, or for one not heard yet', () => {
    expect(nightAlarm(null, NOW, LONDON)).toBeNull()
    expect(nightAlarm(undefined, NOW, LONDON)).toBeNull()
  })

  it('is the time and Tomorrow for an alarm in the morning', () => {
    expect(nightAlarm('2026-10-29T06:45:00.000Z', NOW, LONDON)).toEqual({ day: 'Tomorrow', time: '06:45' })
  })

  it('is Today for one later on the same date', () => {
    expect(nightAlarm('2026-10-28T23:50:00.000Z', NOW, LONDON)).toEqual({ day: 'Today', time: '23:50' })
    // After midnight, the morning's alarm is today's.
    expect(nightAlarm('2026-10-29T06:45:00.000Z', new Date('2026-10-29T01:00:00Z'), LONDON)).toEqual({ day: 'Today', time: '06:45' })
  })

  it('shows the time in the display\'s zone whatever offset the alarm was written with', () => {
    expect(nightAlarm('2026-10-29T07:45:00+01:00', NOW, LONDON)).toEqual({ day: 'Tomorrow', time: '06:45' })
  })

  it('is null for an alarm in the past, now, or a day or more away', () => {
    expect(nightAlarm('2026-10-28T21:00:00.000Z', NOW, LONDON)).toBeNull()
    expect(nightAlarm('2026-10-28T22:30:00.000Z', NOW, LONDON)).toBeNull()
    expect(nightAlarm('2026-10-29T22:30:00.000Z', NOW, LONDON)).toBeNull()
    expect(nightAlarm('2026-10-31T06:45:00.000Z', NOW, LONDON)).toBeNull()
  })

  it('is null for something that is not a time', () => {
    expect(nightAlarm('half past six', NOW, LONDON)).toBeNull()
  })
})

describe('nightPosition', () => {
  const MINUTE = 60_000
  // A multiple of 5 minutes, the start of a step.
  const START = Date.parse('2026-10-28T22:30:00Z')
  const at = (minutes: number, seconds = 0) => new Date(START + minutes * MINUTE + seconds * 1000)

  it('rests for five minutes and then moves', () => {
    expect(nightPosition(at(0))).toEqual(nightPosition(at(4, 59)))
    expect(nightPosition(at(5))).not.toEqual(nightPosition(at(4, 59)))
  })

  it('stays within 240 px across and 160 px up or down of the centre', () => {
    for (const spot of NIGHT_SPOTS) {
      expect(Math.abs(spot.x)).toBeLessThanOrEqual(240)
      expect(Math.abs(spot.y)).toBeLessThanOrEqual(160)
    }
  })

  it('has twelve different spots, and covers an hour before it repeats', () => {
    expect(new Set(NIGHT_SPOTS.map(spot => `${spot.x},${spot.y}`)).size).toBe(12)
    const hour = Array.from({ length: 12 }, (_, step) => nightPosition(at(step * 5)))

    expect(new Set(hour.map(spot => `${spot.x},${spot.y}`)).size).toBe(12)
    expect(nightPosition(at(60))).toEqual(hour[0])
    expect(nightPosition(at(125))).toEqual(hour[1])
  })

  it('makes a real jump at every step, not a shuffle on the spot', () => {
    NIGHT_SPOTS.forEach((spot, index) => {
      const next = NIGHT_SPOTS[(index + 1) % NIGHT_SPOTS.length]!
      expect(Math.hypot(next.x - spot.x, next.y - spot.y)).toBeGreaterThanOrEqual(150)
    })
  })
})
