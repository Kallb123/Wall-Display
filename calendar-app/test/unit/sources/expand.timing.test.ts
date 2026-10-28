import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { openDatabase, runMigrations } from '../../../server/db/client'
import { expandIcs } from '../../../server/sources/ics/expand'
import { ensureCalendarRow, replaceCalendarEvents } from '../../../server/sources/store'
import { syncWindow } from '../../../server/sources/time'
import { MIGRATIONS_DIR, tempDir, track } from '../db/helpers'
import { calendar, calendarConfig, LONDON_VTIMEZONE, PEOPLE, resolverFor, vevent } from './helpers'

// A busy family calendar over the whole 25-month window, expanded, resolved to
// people and stored the way a sync does it. PR 1.1 promises "well under a second". A budget on
// the clock can wobble on a loaded machine, so this is a file of its own.

const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const NOW = new Date('2026-10-28T12:00:00Z')
const BUDGET_MS = 1000

function busyCalendar(): string {
  const events: string[][] = []
  const tz = (d: string) => `;TZID=Europe/London:${d}`

  // 24 weekly series on one to three weekdays each, started a year or so before the window, with leave (EXDATE) and moved weeks.
  for (let i = 0; i < 24; i++) {
    const days = [DAYS[i % 7]!, DAYS[(i + 2) % 7]!, DAYS[(i + 4) % 7]!].slice(0, 1 + (i % 3))
    const hour = String(8 + (i % 10)).padStart(2, '0')
    const start = `2025${String(1 + (i % 12)).padStart(2, '0')}01T${hour}0000`
    events.push(vevent(`weekly-${i}`,
      `DTSTART${tz(start)}`, `DTEND${tz(start.replace(`T${hour}`, `T${String(Number(hour) + 1).padStart(2, '0')}`))}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${days.join(',')}`,
      `EXDATE${tz(`20261027T${hour}0000`)}`, `EXDATE${tz(`20270105T${hour}0000`)}`,
      `SUMMARY:Weekly club ${i}`, 'DESCRIPTION:Who: Theo\\nBring a drink\\, a towel and a smile', 'LOCATION:Somewhere\\, Nearby'))
    if (i % 3 === 0) {
      events.push(vevent(`weekly-${i}`,
        `RECURRENCE-ID${tz(`20261104T${hour}0000`)}`, `DTSTART${tz(`20261104T${String(Number(hour) + 1).padStart(2, '0')}3000`)}`, `DTEND${tz(`20261104T${String(Number(hour) + 2).padStart(2, '0')}3000`)}`,
        `SUMMARY:Weekly club ${i} (moved)`))
    }
  }

  // 2 daily series that began well before the window: the cost of reaching it from far back.
  for (let i = 0; i < 2; i++) {
    events.push(vevent(`daily-${i}`, `DTSTART${tz(`2025010${1 + i}T07${i}000`)}`, `DTEND${tz(`2025010${1 + i}T08${i}000`)}`, 'RRULE:FREQ=DAILY', `SUMMARY:Daily ${i}`))
  }

  // Monthly and yearly all-day events.
  for (let i = 0; i < 10; i++) {
    events.push(vevent(`monthly-${i}`, `DTSTART;VALUE=DATE:2025${String(1 + (i % 12)).padStart(2, '0')}${String(1 + i).padStart(2, '0')}`, 'RRULE:FREQ=MONTHLY', `SUMMARY:Monthly ${i}`))
    events.push(vevent(`yearly-${i}`, `DTSTART;VALUE=DATE:2015${String(1 + (i % 12)).padStart(2, '0')}15`, 'RRULE:FREQ=YEARLY', `SUMMARY:Birthday ${i}`))
  }

  // 800 one-offs spread across the window, a few of them all-day or multi-day.
  const windowStart = Date.UTC(2025, 9, 1)
  for (let i = 0; i < 800; i++) {
    const at = new Date(windowStart + Math.floor((i * 760 * 24 * 3600 * 1000) / 800) + (i % 12) * 3_600_000)
    const stamp = at.toISOString().replace(/[-:]/g, '').slice(0, 15)
    events.push(i % 25 === 0
      ? vevent(`one-${i}`, `DTSTART;VALUE=DATE:${stamp.slice(0, 8)}`, `DTEND;VALUE=DATE:${new Date(at.getTime() + 3 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '')}`, `SUMMARY:Trip ${i}`)
      : vevent(`one-${i}`, `DTSTART${tz(stamp)}`, `DTEND${tz(stamp.replace(/T(\d\d)/, (_m, h) => `T${String((Number(h) + 1) % 24).padStart(2, '0')}`))}`, `SUMMARY:One-off ${i}`, 'DESCRIPTION:<b>Who:</b> Isla<br>See you there', 'LOCATION:The usual place'))
  }

  return calendar(events, { zones: [LONDON_VTIMEZONE] })
}

describe('a busy calendar over the 25-month window', () => {
  it('expands and stores in well under a second', async () => {
    const text = busyCalendar()
    const window = syncWindow(NOW, 'Europe/London', 12, 12)
    const dir = await tempDir()
    const handle = track(openDatabase(join(dir, 'wallcal.db')))
    runMigrations(handle, MIGRATIONS_DIR)
    ensureCalendarRow(handle.db, calendarConfig(), PEOPLE)

    // The family's own settings, so detection has real work to do: names in
    // descriptions (some of them HTML) and keyword rules.
    const resolve = resolverFor({ strip_names: true, rules: [{ match: 'weekly club 1\\d', people: ['isla'] }, { match: 'swimming|football', people: ['theo'] }] })

    // A first, cold run: this is what the first sync after boot costs.
    const started = performance.now()
    const { events, warnings } = expandIcs(text, window, { timeZone: 'Europe/London' })
    const expanded = performance.now()
    const result = replaceCalendarEvents(handle.db, 'family', events, resolve)
    const stored = performance.now()

    const total = stored - started
    console.log(`busy calendar: ${(text.length / 1024).toFixed(0)} KB of ICS, ${events.length} instances in the window; expand ${(expanded - started).toFixed(0)} ms + resolve and store ${(stored - expanded).toFixed(0)} ms = ${total.toFixed(0)} ms`)

    // Not vacuous: thousands of instances, really stored.
    expect(warnings).toEqual([])
    expect(events.length).toBeGreaterThan(5000)
    expect(result).toEqual({ inserted: events.length, updated: 0, deleted: 0, total: events.length })
    expect(handle.sqlite.prepare('select count(*) as n from events').get()).toEqual({ n: events.length })
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(total).toBeLessThan(BUDGET_MS)

    // Syncing it again, as every changed poll after the first does, writes nothing.
    const again = performance.now()
    expect(replaceCalendarEvents(handle.db, 'family', expandIcs(text, window, { timeZone: 'Europe/London' }).events, resolve))
      .toEqual({ inserted: 0, updated: 0, deleted: 0, total: events.length })
    console.log(`busy calendar, unchanged: ${(performance.now() - again).toFixed(0)} ms`)
  })
})
