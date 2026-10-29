import { createHash } from 'node:crypto'
import { addDays, instantId, midnightOf, NO_TITLE, overlaps } from '../span'
import { zonedWallTimeToUtc } from '../time'
import type { NormalisedEvent, SyncWindow } from '../types'
import type { HaCalendarEvent, HaEventTime } from './types'

// Turns Home Assistant's calendar events into the events the store keeps. Pure:
// no I/O, and nothing reads the process's time zone (`new Date(text)` does for
// a time without an offset, so it is never used on one).
//
// Home Assistant has already expanded recurring events, so every event here is
// one instance. What differs between calendar integrations is what they fill
// in: the uid and recurrence id are often missing, and a time may or may not
// carry an offset. The mapping fills the gaps in a way that gives the same
// event the same key on every poll, because the store keeps an event by that key.

export interface MapOptions {
  /** The display zone: where a time with no offset and an all-day date's midnight are read. */
  timeZone: string
}

export interface MapResult {
  events: NormalisedEvent[]
  /** Things worth knowing that did not stop the sync. */
  warnings: string[]
}

interface Span {
  allDay: boolean
  startAt: number
  endAt: number
  startDate: string | null
  endDate: string | null
}

/** An event read from Home Assistant, before its key is settled. */
interface Mapped {
  uid: string
  /** What Home Assistant sent, trimmed; '' if it sent none. */
  recurrenceId: string
  span: Span
  event: HaCalendarEvent
}

export function mapHaEvents(raw: readonly HaCalendarEvent[], window: SyncWindow, options: MapOptions): MapResult {
  const warnings: string[] = []
  const mapped: Mapped[] = []
  let unreadable = 0
  for (const event of raw) {
    const span = spanOf(event, options.timeZone)
    if (!span) {
      unreadable++
      continue
    }
    mapped.push({ uid: uidOf(event), recurrenceId: event.recurrence_id?.trim() ?? '', span, event })
  }
  if (unreadable > 0) warnings.push(`${unreadable} ${unreadable === 1 ? 'event' : 'events'} with an unreadable start or end ${unreadable === 1 ? 'was' : 'were'} left out`)

  // Counted before the window is applied, so an instance keeps its key as its
  // neighbours move in and out of the window.
  const uidCounts = new Map<string, number>()
  for (const { uid } of mapped) uidCounts.set(uid, (uidCounts.get(uid) ?? 0) + 1)

  const events: NormalisedEvent[] = []
  const keys = new Set<string>()
  let duplicates = 0
  for (const { uid, recurrenceId, span, event } of mapped) {
    if (!overlaps(span, window)) continue
    // Several events with one uid are the instances of a series. Each needs
    // its own recurrence id, and its start is what tells them apart.
    const id = recurrenceId || (uidCounts.get(uid)! > 1 ? instanceId(span) : '')
    const key = JSON.stringify([uid, id])
    if (keys.has(key)) {
      duplicates++
      continue
    }
    keys.add(key)
    events.push({
      uid,
      recurrenceId: id,
      title: event.summary?.trim() || NO_TITLE,
      description: event.description?.trim() ? event.description : null,
      location: event.location?.trim() ? event.location : null,
      startAt: new Date(span.startAt),
      endAt: new Date(span.endAt),
      allDay: span.allDay,
      startDate: span.startDate,
      endDate: span.endDate,
    })
  }
  if (duplicates > 0) warnings.push(`${duplicates} ${duplicates === 1 ? 'event' : 'events'} appeared more than once with the same id; only the first of each was kept`)

  return { events, warnings }
}

/** The uid Home Assistant gave, or one made from the event itself, so the same event has the same uid on every poll. */
function uidOf(event: HaCalendarEvent): string {
  const uid = event.uid?.trim()
  if (uid) return uid
  const hash = createHash('sha1')
    .update(JSON.stringify([event.summary ?? '', rawTime(event.start), rawTime(event.end)]))
    .digest('hex')
  return `ha-${hash}`
}

function rawTime(time: HaEventTime): string {
  return 'date' in time ? `date:${time.date}` : `dateTime:${time.dateTime}`
}

/** The recurrence id of an instance that has none: its own start, in the format the ICS source uses. */
function instanceId(span: Span): string {
  return span.allDay ? span.startDate!.replaceAll('-', '') : instantId(span.startAt)
}

// ---------------------------------------------------------------------------
// Times

/** The span of an event, or null if its start or end can't be read. */
function spanOf(event: HaCalendarEvent, timeZone: string): Span | null {
  const { start, end } = event
  if ('date' in start) {
    if (!isDate(start.date)) return null
    const startDate = start.date
    // The end of an all-day event is the day after its last day. Without a
    // usable one the event lasts a day.
    let endDate = addDays(startDate, 1)
    if ('date' in end) {
      if (!isDate(end.date)) return null
      if (end.date > startDate) endDate = end.date
    }
    return { allDay: true, startAt: midnightOf(startDate, timeZone), endAt: midnightOf(endDate, timeZone), startDate, endDate }
  }

  const startAt = instantOf(start.dateTime, timeZone)
  const endAt = 'date' in end ? (isDate(end.date) ? midnightOf(end.date, timeZone) : null) : instantOf(end.dateTime, timeZone)
  if (startAt === null || endAt === null) return null
  return { allDay: false, startAt, endAt: Math.max(endAt, startAt), startDate: null, endDate: null }
}

/** True for a real calendar date written `YYYY-MM-DD`: not 2026-02-30. */
function isDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  return match !== null && isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]))
}

function isCalendarDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

// 2026-10-25T10:00, with optional seconds and fraction, then `Z`, an offset or nothing.
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?$/

/**
 * The instant an ISO 8601 time means, in milliseconds, or null if it is not
 * one. `Z` and an offset are what they say; no offset is a wall time in `timeZone`.
 */
function instantOf(text: string, timeZone: string): number | null {
  const match = DATE_TIME.exec(text)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(part => Number(part ?? 0)) as [number, number, number, number, number, number]
  if (!isCalendarDay(year, month, day) || hour > 23 || minute > 59 || second > 59) return null
  const milliseconds = Number(`${match[7] ?? ''}00`.slice(0, 3)) // anything finer than a millisecond is dropped

  let instant: number
  const zone = match[8]
  if (zone === undefined) instant = zonedWallTimeToUtc({ year, month, day, hour, minute, second }, timeZone).getTime()
  else {
    let offset = 0
    if (zone !== 'Z') {
      const offsetHours = Number(zone.slice(1, 3))
      const offsetMinutes = Number(zone.slice(4, 6))
      if (offsetHours > 23 || offsetMinutes > 59) return null
      offset = (zone[0] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60_000
    }
    instant = Date.UTC(year, month - 1, day, hour, minute, second) - offset
  }
  return instant + milliseconds
}
