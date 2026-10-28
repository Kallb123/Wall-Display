import { describe, expect, it } from 'vitest'
import { entriesOn, eventSpan } from '../../../shared/event-days'
import type { CalendarEvent } from '../../../shared/types/events'

// The rules for which day an event is on are also pinned through the agenda's
// tests (test/unit/display/agenda.test.ts); these cover the shared function.

const LONDON = 'Europe/London'

function timed(start: string, end: string, id: number): CalendarEvent {
  return { id, calendar_id: 'family', title: 'Event', display_title: 'Event', location: null, start, end, all_day: false, start_date: null, end_date: null, people: [] }
}

function allDay(first: string | null, after: string | null, id: number): CalendarEvent {
  return { ...timed('2026-10-14T00:00:00.000Z', '2026-10-15T00:00:00.000Z', id), all_day: true, start_date: first, end_date: after }
}

describe('eventSpan', () => {
  it('runs an all-day event from its first day to the day before end_date', () => {
    expect(eventSpan(allDay('2026-10-26', '2026-10-31', 1), LONDON)).toMatchObject({ first: '2026-10-26', last: '2026-10-30' })
  })

  it('makes an all-day event with no end_date one day long, and reads a missing start_date from the start', () => {
    expect(eventSpan(allDay('2026-10-26', null, 1), LONDON)).toMatchObject({ first: '2026-10-26', last: '2026-10-26' })
    expect(eventSpan(allDay(null, null, 1), LONDON)).toMatchObject({ first: '2026-10-14', last: '2026-10-14' })
  })

  it('has no span for an all-day event that ends before it starts', () => {
    expect(eventSpan(allDay('2026-10-26', '2026-10-26', 1), LONDON)).toBeNull()
    expect(eventSpan(allDay('2026-10-26', '2026-10-25', 1), LONDON)).toBeNull()
  })

  it('runs a timed event to the day of its last millisecond, in the display zone', () => {
    // 23:00Z is midnight in London (BST), so an event ending then is over by the 16th.
    expect(eventSpan(timed('2026-10-14T09:00:00Z', '2026-10-15T23:00:00Z', 1), LONDON)).toMatchObject({ first: '2026-10-14', last: '2026-10-15' })
    expect(eventSpan(timed('2026-10-14T09:00:00Z', '2026-10-15T23:00:00.001Z', 1), LONDON)).toMatchObject({ first: '2026-10-14', last: '2026-10-16' })
    expect(eventSpan(timed('2026-10-14T20:00:00Z', '2026-10-14T21:00:00Z', 1), 'Asia/Tokyo')).toMatchObject({ first: '2026-10-15', last: '2026-10-15' })
  })

  it('leaves a zero-length timed event on its start day', () => {
    expect(eventSpan(timed('2026-10-14T09:00:00Z', '2026-10-14T09:00:00Z', 1), LONDON)).toMatchObject({ first: '2026-10-14', last: '2026-10-14' })
  })
})

describe('entriesOn', () => {
  const camp = timed('2026-10-13T09:00:00Z', '2026-10-16T09:00:00Z', 1)

  it('takes a timed event that spans the whole day as all-day, and shows when it ends on its last day', () => {
    expect(entriesOn([camp], '2026-10-13', LONDON).timed.map(entry => entry.time)).toEqual(['10:00'])
    expect(entriesOn([camp], '2026-10-14', LONDON).allDay.map(entry => entry.time)).toEqual([null])
    expect(entriesOn([camp], '2026-10-16', LONDON).timed.map(entry => entry.time)).toEqual(['Until 10:00'])
    expect(entriesOn([camp], '2026-10-17', LONDON)).toEqual({ allDay: [], timed: [] })
    expect(entriesOn([camp], '2026-10-12', LONDON)).toEqual({ allDay: [], timed: [] })
  })

  it('sorts all-day by start and then longest first, and timed by start, end and id', () => {
    const events = [
      allDay('2026-10-14', '2026-10-15', 1),
      allDay('2026-10-14', '2026-10-17', 2),
      allDay('2026-10-13', '2026-10-15', 3),
      timed('2026-10-14T10:00:00Z', '2026-10-14T11:00:00Z', 4),
      timed('2026-10-14T09:00:00Z', '2026-10-14T12:00:00Z', 5),
      timed('2026-10-14T09:00:00Z', '2026-10-14T10:00:00Z', 6),
    ]
    const found = entriesOn(events, '2026-10-14', LONDON)

    expect(found.allDay.map(entry => entry.event.id)).toEqual([3, 2, 1])
    expect(found.timed.map(entry => entry.event.id)).toEqual([6, 5, 4])
  })
})
