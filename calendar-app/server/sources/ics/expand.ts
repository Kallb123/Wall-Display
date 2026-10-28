import ICAL from 'ical.js'
import { isKnownTimeZone, zonedWallTimeToUtc } from '../time'
import type { NormalisedEvent, SyncWindow } from '../types'
import { IcsSourceError } from './errors'

// Parses an ICS feed and expands its recurring events into one event per
// instance inside a window. Pure: no I/O, and nothing reads the process's time
// zone. `ICAL.Time#toJSDate()` on a floating time does, so it is never called;
// every time becomes an instant through `instantOf` below.
//
// The global `ICAL.TimezoneService` is not used either. ical.js finds a
// VTIMEZONE through the calendar it was parsed from, so zones can't leak
// from one feed to another.

export interface ExpandOptions {
  /** The display zone: where a floating time, an unknown TZID and an all-day date's midnight are read. */
  timeZone: string
  /** Stop expanding a series after this many occurrences, counting those before the window. Default 20 000. */
  maxOccurrencesPerSeries?: number
}

export interface ExpandResult {
  events: NormalisedEvent[]
  /** Things worth knowing that did not stop the sync. Never contain the feed's URL. */
  warnings: string[]
}

const DEFAULT_MAX_OCCURRENCES = 20_000
const NO_TITLE = '(No title)'

interface Context {
  timeZone: string
  warnings: Set<string>
}

interface Span {
  allDay: boolean
  startAt: number
  endAt: number
  startDate: string | null
  endDate: string | null
}

/** One VEVENT, with what it takes to rank duplicates of it. */
interface Candidate {
  component: ICAL.Component
  /** Position in the file, so a later copy can beat an earlier one. */
  order: number
}

/** An override: a VEVENT with a RECURRENCE-ID, taking the place of one instance of its series. */
interface Override {
  component: ICAL.Component
  event: ICAL.Event
}

export function expandIcs(text: string, window: SyncWindow, options: ExpandOptions): ExpandResult {
  const context: Context = { timeZone: options.timeZone, warnings: new Set() }
  const cap = options.maxOccurrencesPerSeries ?? DEFAULT_MAX_OCCURRENCES

  const groups = groupByUid(parse(text), context)
  const events: NormalisedEvent[] = []
  let unreadable = 0
  for (const [uid, group] of groups) {
    try {
      expandGroup(uid, group, window, cap, context, events)
    } catch {
      unreadable++
    }
  }
  if (unreadable > 0) context.warnings.add(`${unreadable} ${unreadable === 1 ? 'event' : 'events'} could not be read and ${unreadable === 1 ? 'was' : 'were'} skipped`)

  events.sort(compareEvents)
  return { events, warnings: [...context.warnings] }
}

function parse(text: string): ICAL.Component[] {
  let jCal: unknown
  try {
    jCal = ICAL.parse(text)
  } catch {
    // ical.js quotes the offending line in its message, and a stored error is shown to people.
    throw new IcsSourceError('parse', 'the calendar could not be parsed')
  }
  // One calendar parses to a component; several parse to a list of them.
  const roots = (Array.isArray(jCal) && typeof jCal[0] === 'string' ? [jCal] : jCal) as unknown[]
  const calendars = (Array.isArray(roots) ? roots : [])
    .filter((root): root is unknown[] => Array.isArray(root) && root[0] === 'vcalendar')
    .map(root => new ICAL.Component(root))
  if (calendars.length === 0) throw new IcsSourceError('parse', 'the calendar could not be parsed (no VCALENDAR)')
  return calendars
}

// ---------------------------------------------------------------------------
// Grouping

interface Group {
  masters: Candidate[]
  overrides: Candidate[]
}

function groupByUid(calendars: ICAL.Component[], context: Context): Map<string, Group> {
  const groups = new Map<string, Group>()
  let order = 0
  let noUid = 0
  for (const calendar of calendars) {
    for (const component of calendar.getAllSubcomponents('vevent')) {
      const candidate = { component, order: order++ }
      const uid = textOf(component, 'uid')
      if (!uid) {
        noUid++
        continue
      }
      let group = groups.get(uid)
      if (!group) groups.set(uid, group = { masters: [], overrides: [] })
      ;(component.hasProperty('recurrence-id') ? group.overrides : group.masters).push(candidate)
    }
  }
  if (noUid > 0) context.warnings.add(`${noUid} ${noUid === 1 ? 'event has' : 'events have'} no UID and ${noUid === 1 ? 'was' : 'were'} skipped`)
  return groups
}

/** Newer wins: a higher SEQUENCE, then a later LAST-MODIFIED (or DTSTAMP), then a later place in the file. */
function newest(candidates: Candidate[], context: Context): Candidate {
  if (candidates.length > 1) context.warnings.add('some events appeared more than once with the same UID; the newest copy was kept')
  let best = candidates[0]!
  let bestRank = rank(best)
  for (const candidate of candidates.slice(1)) {
    const candidateRank = rank(candidate)
    if (candidateRank[0] > bestRank[0]
      || (candidateRank[0] === bestRank[0] && (candidateRank[1] > bestRank[1]
        || (candidateRank[1] === bestRank[1] && candidateRank[2] > bestRank[2])))) {
      best = candidate
      bestRank = candidateRank
    }
  }
  return best
}

function rank({ component, order }: Candidate): [number, number, number] {
  const sequence = component.getFirstPropertyValue('sequence')
  const modified = component.getFirstPropertyValue('last-modified') ?? component.getFirstPropertyValue('dtstamp')
  const modifiedAt = modified instanceof ICAL.Time ? modified.toUnixTime() : 0
  return [typeof sequence === 'number' ? sequence : 0, modifiedAt, order]
}

// ---------------------------------------------------------------------------
// Expanding one UID

function expandGroup(uid: string, group: Group, window: SyncWindow, cap: number, context: Context, out: NormalisedEvent[]): void {
  const masterCandidate = group.masters.length > 0 ? newest(group.masters, context) : null
  const master = masterCandidate?.component ?? null
  if (master && isCancelled(master)) return // a cancelled series takes its overrides with it

  const dateSeries = master ? isDateValue(master, 'dtstart') : null
  const overrides = chooseOverrides(group.overrides, dateSeries, context)

  if (master) {
    const event = new ICAL.Event(master, { exceptions: [...overrides.values()].map(override => override.event) })
    if (event.isRecurring()) expandSeries(uid, event, overrides, window, cap, context, out)
    else {
      const span = spanOf(event, context)
      if (span && overlaps(span, window)) out.push(toEvent(uid, '', event, span))
    }
  }

  // An override is emitted for where it lands, whether or not its original slot
  // is in the window, and whether or not the series would have produced it.
  for (const [slot, override] of overrides) {
    if (isCancelled(override.component)) continue
    const span = spanOf(override.event, context)
    if (span && overlaps(span, window)) out.push(toEvent(uid, slot, override.event, span))
  }
}

function chooseOverrides(candidates: Candidate[], dateSeries: boolean | null, context: Context): Map<string, Override> {
  const bySlot = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const recurrenceId = timeProperty(candidate.component, 'recurrence-id')
    if (!recurrenceId) continue
    const slot = slotOf(recurrenceId.time, recurrenceId.tzid, dateSeries ?? recurrenceId.time.isDate, context).id
    const list = bySlot.get(slot)
    if (list) list.push(candidate)
    else bySlot.set(slot, [candidate])
  }

  const overrides = new Map<string, Override>()
  for (const [slot, list] of bySlot) {
    const { component } = newest(list, context)
    overrides.set(slot, { component, event: new ICAL.Event(component, { exceptions: [] }) })
  }
  return overrides
}

function expandSeries(uid: string, event: ICAL.Event, overrides: Map<string, Override>, window: SyncWindow, cap: number, context: Context, out: NormalisedEvent[]): void {
  const start = timeProperty(event.component, 'dtstart')
  if (!start) return
  const dateSeries = start.time.isDate
  const name = `"${shorten(textOf(event.component, 'summary'))}"`
  if (hasImpossibleRule(event.component)) {
    context.warnings.add(`the repeat rule of ${name} can never be satisfied, so none of its events were read`)
    return
  }

  let iterator: ReturnType<ICAL.Event['iterator']>
  try {
    iterator = event.iterator()
  } catch {
    context.warnings.add(`the repeat rule of ${name} can't be expanded, so none of its events were read`)
    return
  }
  const seen = new Set<string>()
  // How long each instance lasts, taken from the series' first. This is the
  // time that really passes, so an instance that spans a clock change keeps its
  // length instead of its wall-clock end. Much faster than asking ical.js per
  // instance, which clones several times over for each one.
  const first = spanOf(event, context)
  if (!first) return
  const length = { allDay: first.allDay, ms: first.endAt - first.startAt, days: first.allDay ? daysBetween(first.startDate!, first.endDate!) : 0 }
  const hasRangeOverride = event.rangeExceptions.length > 0

  // Returns false once the series is past the window.
  const consider = (occurrence: ICAL.Time): boolean => {
    const slot = slotOf(occurrence, start.tzid, dateSeries, context)
    if (slot.at >= window.end.getTime()) return false
    if (overrides.has(slot.id) || seen.has(slot.id)) return true
    seen.add(slot.id)

    const item = hasRangeOverride ? event.getOccurrenceDetails(occurrence) : null
    let span: Span
    let source = event
    if (item) {
      // A THISANDFUTURE override moved this slot without naming it. ical.js
      // works out where, and which override's text applies.
      source = item.item
      const itemStart = timeProperty(source.component, 'dtstart') ?? start
      span = spanFromTimes(item.startDate, itemStart.tzid, item.endDate, itemStart.tzid, context)
    } else {
      span = length.allDay
        ? allDaySpan(dateString(occurrence), length.days, context)
        : { allDay: false, startAt: slot.at, endAt: slot.at + length.ms, startDate: null, endDate: null }
    }
    if (!isCancelled(source.component) && overlaps(span, window)) out.push(toEvent(uid, slot.id, source, span))
    return true
  }

  // With RDATEs and no RRULE, ical.js hands back the RDATEs but not DTSTART,
  // which is the first instance all the same.
  if (!event.component.hasProperty('rrule') && !consider(start.time)) return

  for (let count = 1; ; count++) {
    let next: unknown // an RDATE can be a period, which ical.js types as a time
    try {
      next = iterator.next()
    } catch {
      // ical.js gives up on some rules part way through.
      context.warnings.add(`the repeat rule of ${name} can't be expanded, so only some of its events were read`)
      return
    }
    if (!next) return
    if (count > cap) {
      context.warnings.add(`${name} repeats more than ${cap} times, so only its first ${cap} were read`)
      return
    }
    if (!consider(next instanceof ICAL.Period ? next.start : next as ICAL.Time)) return
  }
}

/**
 * True if a rule names a day of the month that none of its months has (the
 * 30th of February). ical.js can't see that: for a daily or finer rule it
 * searches forever inside a single call, which the occurrence cap can't stop,
 * and for a yearly one it quietly lands on March 2nd.
 */
function hasImpossibleRule(component: ICAL.Component): boolean {
  return component.getAllProperties('rrule').some((property) => {
    const rule = property.getFirstValue()
    if (!(rule instanceof ICAL.Recur)) return false
    const days = rule.getComponent('BYMONTHDAY') as number[]
    if (days.length === 0) return false
    const months = rule.getComponent('BYMONTH') as number[]
    const candidates = months.length > 0 ? months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    return !candidates.some(month => days.some(day => Math.abs(day) >= 1 && Math.abs(day) <= ICAL.Time.daysInMonth(month, 2024)))
  })
}

// ---------------------------------------------------------------------------
// Times

/** Where an occurrence of a series sits: its id, and the instant it starts at. */
function slotOf(time: ICAL.Time, tzid: string | null, dateSeries: boolean, context: Context): { id: string, at: number } {
  if (dateSeries) {
    return {
      id: `${pad(time.year, 4)}${pad(time.month)}${pad(time.day)}`,
      at: zonedWallTimeToUtc({ year: time.year, month: time.month, day: time.day }, context.timeZone).getTime(),
    }
  }
  const at = instantOf(time, tzid, context)
  const iso = new Date(at).toISOString() // 2026-10-28T16:00:00.000Z
  return { id: `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`, at }
}

/**
 * The instant a parsed time means, in milliseconds. In order:
 * 1. a UTC time is what it says;
 * 2. a TZID `Intl` knows (every IANA name) is read with the system's rules, which beat the rules a feed embeds;
 * 3. a TZID the feed defines itself in a VTIMEZONE (Outlook's "GMT Standard Time") is left to ical.js;
 * 4. anything else is a wall time in the display zone: a floating time, or a TZID defined nowhere (reported).
 */
function instantOf(time: ICAL.Time, tzid: string | null, context: Context): number {
  const wall = { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second }
  if (time.zone === ICAL.Timezone.utcTimezone) return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  if (tzid && isKnownTimeZone(tzid)) return zonedWallTimeToUtc(wall, tzid).getTime()
  if (time.zone !== ICAL.Timezone.localTimezone) return time.toUnixTime() * 1000
  if (tzid) context.warnings.add(`the time zone "${shorten(tzid)}" is not defined, so its times were read as ${context.timeZone}`)
  return zonedWallTimeToUtc(wall, context.timeZone).getTime()
}

function spanFromTimes(start: ICAL.Time, startTzid: string | null, end: ICAL.Time, endTzid: string | null, context: Context): Span {
  if (start.isDate) {
    const startDate = dateString(start)
    let endDate = dateString(end)
    if (endDate <= startDate) endDate = addDays(startDate, 1)
    return {
      allDay: true,
      startAt: midnightOf(startDate, context),
      endAt: midnightOf(endDate, context),
      startDate,
      endDate,
    }
  }
  const startAt = instantOf(start, startTzid, context)
  const endAt = Math.max(instantOf(end, endTzid ?? startTzid, context), startAt)
  return { allDay: false, startAt, endAt, startDate: null, endDate: null }
}

/** The span of an event on its own dates: a one-off, or an override. */
function spanOf(event: ICAL.Event, context: Context): Span | null {
  const start = timeProperty(event.component, 'dtstart')
  if (!start) return null
  const end = timeProperty(event.component, 'dtend')
  return spanFromTimes(start.time, start.tzid, event.endDate, end?.tzid ?? start.tzid, context)
}

function allDaySpan(startDate: string, days: number, context: Context): Span {
  const endDate = addDays(startDate, days)
  return { allDay: true, startAt: midnightOf(startDate, context), endAt: midnightOf(endDate, context), startDate, endDate }
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10))) - Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))) / 86_400_000)
}

function midnightOf(date: string, context: Context): number {
  return zonedWallTimeToUtc({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) }, context.timeZone).getTime()
}

function dateString(time: ICAL.Time): string {
  return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`
}

function addDays(date: string, days: number): string {
  const moved = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days))
  return moved.toISOString().slice(0, 10)
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** Overlap with the window: a zero-length event counts if it starts inside it. */
function overlaps(span: Pick<Span, 'startAt' | 'endAt'>, window: SyncWindow): boolean {
  const from = window.start.getTime()
  return span.startAt < window.end.getTime()
    && (span.endAt > from || (span.endAt === span.startAt && span.startAt >= from))
}

// ---------------------------------------------------------------------------
// Reading properties

function timeProperty(component: ICAL.Component, name: string): { time: ICAL.Time, tzid: string | null } | null {
  const property = component.getFirstProperty(name)
  const time = property?.getFirstValue()
  if (!property || !(time instanceof ICAL.Time)) return null
  const tzid = property.getParameter('tzid')
  return { time, tzid: typeof tzid === 'string' && tzid !== '' ? tzid : null }
}

function isDateValue(component: ICAL.Component, name: string): boolean {
  return timeProperty(component, name)?.time.isDate ?? false
}

function textOf(component: ICAL.Component, name: string): string | null {
  const value = component.getFirstPropertyValue(name)
  return typeof value === 'string' ? value : null
}

function isCancelled(component: ICAL.Component): boolean {
  return textOf(component, 'status')?.trim().toUpperCase() === 'CANCELLED'
}

function shorten(text: string | null): string {
  const value = (text ?? '').trim()
  return value.length > 60 ? `${value.slice(0, 57)}...` : value
}

// ---------------------------------------------------------------------------
// Output

function toEvent(uid: string, recurrenceId: string, item: ICAL.Event, span: Span): NormalisedEvent {
  const title = textOf(item.component, 'summary')?.trim()
  const description = textOf(item.component, 'description')
  const location = textOf(item.component, 'location')
  return {
    uid,
    recurrenceId,
    title: title || NO_TITLE,
    description: description?.trim() ? description : null,
    location: location?.trim() ? location : null,
    startAt: new Date(span.startAt),
    endAt: new Date(span.endAt),
    allDay: span.allDay,
    startDate: span.startDate,
    endDate: span.endDate,
  }
}

function compareEvents(a: NormalisedEvent, b: NormalisedEvent): number {
  return a.startAt.getTime() - b.startAt.getTime()
    || compareText(a.uid, b.uid)
    || compareText(a.recurrenceId, b.recurrenceId)
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
