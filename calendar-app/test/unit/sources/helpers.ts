import type { CalendarConfig } from '../../../server/config/schema'
import { expandIcs } from '../../../server/sources/ics/expand'
import type { ExpandOptions } from '../../../server/sources/ics/expand'
import type { NormalisedEvent, SyncWindow } from '../../../server/sources/types'

/** The Europe/London VTIMEZONE as Google writes it. */
export const LONDON_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/London',
  'X-LIC-LOCATION:Europe/London',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:BST',
  'DTSTART:19700329T010000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:GMT',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

/** One VEVENT from its content lines. Each test names only what it is about. */
export function vevent(uid: string, ...lines: string[]): string[] {
  return ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260101T000000Z', ...lines, 'END:VEVENT']
}

/** A whole calendar, with CRLF line endings, from the lines of its events. */
export function calendar(events: string[][], { zones = [LONDON_VTIMEZONE] }: { zones?: string[][] } = {}): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wall Display tests//EN',
    ...zones.flat(),
    ...events.flat(),
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

/** 1 September 2026 to 1 January 2027, London time (BST at the start, GMT at the end). */
export const WINDOW: SyncWindow = {
  start: new Date('2026-08-31T23:00:00Z'),
  end: new Date('2027-01-01T00:00:00Z'),
}

export function expand(text: string, window: SyncWindow = WINDOW, options: Partial<ExpandOptions> = {}) {
  return expandIcs(text, window, { timeZone: 'Europe/London', ...options })
}

/** Expands events and returns just their start instants, which is what most tests assert on. */
export function starts(events: NormalisedEvent[]): string[] {
  return events.map(event => event.startAt.toISOString())
}

/** A calendar as the config loader gives it, with an ICS source. */
export function calendarConfig(overrides: Partial<CalendarConfig> = {}): CalendarConfig {
  return {
    id: 'family',
    name: 'Family',
    person: 'home',
    detect_people: true,
    detect_in: ['title', 'description'],
    strip_names: false,
    rules: [],
    source: { type: 'ics', url: 'https://example.com/family.ics', poll_seconds: 120 },
    ...overrides,
  }
}
