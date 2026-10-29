// Small pure helpers for the span of an event, shared by the sources: dates as
// `YYYY-MM-DD` text, local midnight, recurrence ids and the window check. Like
// time.ts they never read the time zone of the process.

import { zonedWallTimeToUtc } from './time'
import type { SyncWindow } from './types'

/** The title of an event that has none. */
export const NO_TITLE = '(No title)'

/** The date `days` after (or before, if negative) a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  const moved = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days))
  return moved.toISOString().slice(0, 10)
}

/** The instant, in milliseconds, at which a `YYYY-MM-DD` date starts in `timeZone`. */
export function midnightOf(date: string, timeZone: string): number {
  return zonedWallTimeToUtc({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) }, timeZone).getTime()
}

/** The recurrence id of a timed instance: its start as UTC, `YYYYMMDDTHHMMSSZ`. */
export function instantId(epochMs: number): string {
  const iso = new Date(epochMs).toISOString() // 2026-10-28T16:00:00.000Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`
}

/** Overlap with the window: a zero-length event counts if it starts inside it. */
export function overlaps(span: { startAt: number, endAt: number }, window: SyncWindow): boolean {
  const from = window.start.getTime()
  return span.startAt < window.end.getTime()
    && (span.endAt > from || (span.endAt === span.startAt && span.startAt >= from))
}
