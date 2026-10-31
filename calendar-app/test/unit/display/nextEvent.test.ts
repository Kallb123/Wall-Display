import { describe, expect, it } from 'vitest'
import { nextEvent } from '../../../app/utils/nextEvent'
import type { CalendarEvent } from '../../../shared/types/events'

const LONDON = 'Europe/London'
// Wed 28 Oct 2026, 09:41 in London (the clocks went back on the 25th, so that is 09:41Z).
const NOW = new Date('2026-10-28T09:41:00Z')

let nextId = 1

function timed(start: string, end: string, title = 'Event', id = nextId++): CalendarEvent {
  return { id, calendar_id: 'family', title, display_title: title, location: null, start, end, all_day: false, start_date: null, end_date: null, people: [] }
}

function allDay(first: string, after: string, title = 'All day', id = nextId++): CalendarEvent {
  return { ...timed(`${first}T00:00:00.000Z`, `${after}T00:00:00.000Z`, title, id), all_day: true, start_date: first, end_date: after }
}

describe('nextEvent', () => {
  it('is null with no events', () => {
    expect(nextEvent([], NOW, LONDON)).toBeNull()
  })

  it('is the earliest event still to come today, whatever the order given', () => {
    const later = timed('2026-10-28T15:00:00Z', '2026-10-28T16:00:00Z', 'Later')
    const sooner = timed('2026-10-28T11:30:00Z', '2026-10-28T12:00:00Z', 'Sooner')

    const found = nextEvent([later, sooner], NOW, LONDON)

    expect(found).toMatchObject({ day: 'Today', ongoing: false, time: '11:30' })
    expect(found?.event.display_title).toBe('Sooner')
  })

  it('skips events that are over', () => {
    const over = timed('2026-10-28T08:00:00Z', '2026-10-28T09:00:00Z', 'Over')
    const coming = timed('2026-10-28T17:00:00Z', '2026-10-28T18:00:00Z', 'Coming')

    expect(nextEvent([over, coming], NOW, LONDON)?.event.display_title).toBe('Coming')
    expect(nextEvent([over], NOW, LONDON)).toBeNull()
  })

  it('counts an event that ends exactly now as over, and one that starts exactly now as on', () => {
    const ends = timed('2026-10-28T09:00:00Z', '2026-10-28T09:41:00Z', 'Ends')
    const starts = timed('2026-10-28T09:41:00Z', '2026-10-28T10:00:00Z', 'Starts')

    expect(nextEvent([ends], NOW, LONDON)).toBeNull()
    expect(nextEvent([ends, starts], NOW, LONDON)).toMatchObject({ ongoing: true, time: 'Until 10:00' })
  })

  it('shows an event that is on now, as "Until" its end', () => {
    const now = timed('2026-10-28T09:00:00Z', '2026-10-28T10:30:00Z', 'Now')
    const next = timed('2026-10-28T12:00:00Z', '2026-10-28T13:00:00Z', 'Next')

    const found = nextEvent([next, now], NOW, LONDON)

    expect(found).toMatchObject({ day: null, ongoing: true, time: 'Until 10:30' })
    expect(found?.event.display_title).toBe('Now')
  })

  it('shows an event that began yesterday and is still on', () => {
    const night = timed('2026-10-27T22:00:00Z', '2026-10-28T11:00:00Z', 'Overnight')

    expect(nextEvent([night], NOW, LONDON)).toMatchObject({ ongoing: true, time: 'Until 11:00' })
  })

  it('looks at tomorrow when nothing is left today, and says so', () => {
    const tomorrow = timed('2026-10-29T08:15:00Z', '2026-10-29T09:00:00Z', 'Tomorrow thing')

    expect(nextEvent([tomorrow], NOW, LONDON)).toMatchObject({ day: 'Tomorrow', ongoing: false, time: 'Tomorrow 08:15' })
  })

  it('prefers something later today to something tomorrow', () => {
    const tomorrow = timed('2026-10-29T08:15:00Z', '2026-10-29T09:00:00Z', 'Tomorrow thing')
    const tonight = timed('2026-10-28T19:00:00Z', '2026-10-28T20:00:00Z', 'Tonight')

    expect(nextEvent([tomorrow, tonight], NOW, LONDON)?.event.display_title).toBe('Tonight')
  })

  it('does not look past tomorrow', () => {
    const later = timed('2026-10-30T09:00:00Z', '2026-10-30T10:00:00Z', 'Friday')

    expect(nextEvent([later], NOW, LONDON)).toBeNull()
  })

  it('leaves out all-day events, whatever day they are on', () => {
    const birthday = allDay('2026-10-28', '2026-10-29', 'Birthday')
    const trip = allDay('2026-10-26', '2026-10-31', 'Trip')

    expect(nextEvent([birthday, trip], NOW, LONDON)).toBeNull()
    expect(nextEvent([birthday, timed('2026-10-29T08:00:00Z', '2026-10-29T09:00:00Z', 'Dentist')], NOW, LONDON)?.event.display_title).toBe('Dentist')
  })

  it('reads "today" and "tomorrow" in the display zone', () => {
    // Tokyo is nine hours ahead: 00:00Z is 09:00 on the 29th there, and the event is at 09:30.
    const event = timed('2026-10-29T00:30:00Z', '2026-10-29T01:00:00Z', 'Tokyo morning')
    const tokyoNow = new Date('2026-10-29T00:00:00Z')

    expect(nextEvent([event], tokyoNow, 'Asia/Tokyo')).toMatchObject({ day: 'Today', time: '09:30' })
    // In London it is 00:00 on the 29th as well, and the event is at 00:30.
    expect(nextEvent([event], tokyoNow, LONDON)).toMatchObject({ day: 'Today', time: '00:30' })
    // From the evening before in London, it is tomorrow.
    expect(nextEvent([event], new Date('2026-10-28T20:00:00Z'), LONDON)).toMatchObject({ day: 'Tomorrow', time: 'Tomorrow 00:30' })
  })

  it('uses the 24-hour clock, across a clock change', () => {
    // The clocks go back on the 25th; on the 24th an evening event is still in summer time.
    const event = timed('2026-10-24T17:05:00Z', '2026-10-24T18:00:00Z', 'Summer time')

    expect(nextEvent([event], new Date('2026-10-24T09:00:00Z'), LONDON)?.time).toBe('18:05')
  })

  it('breaks a tie by the shorter event, then the lower id', () => {
    const long = timed('2026-10-28T12:00:00Z', '2026-10-28T14:00:00Z', 'Long', 5)
    const short = timed('2026-10-28T12:00:00Z', '2026-10-28T12:30:00Z', 'Short', 9)
    const twin = timed('2026-10-28T12:00:00Z', '2026-10-28T12:30:00Z', 'Twin', 7)

    expect(nextEvent([long, short, twin], NOW, LONDON)?.event.display_title).toBe('Twin')
  })

  it('keeps an event with no length until it starts', () => {
    const instant = timed('2026-10-28T12:00:00Z', '2026-10-28T12:00:00Z', 'Instant')

    expect(nextEvent([instant], NOW, LONDON)?.time).toBe('12:00')
    expect(nextEvent([instant], new Date('2026-10-28T12:00:00Z'), LONDON)).toBeNull()
  })
})
