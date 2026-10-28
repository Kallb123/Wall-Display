import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../../server/config/load'
import { events as eventsTable } from '../../../server/db/schema'
import { expandIcs } from '../../../server/sources/ics/expand'
import { syncIcsCalendar } from '../../../server/sources/ics/sync'
import { syncWindow, wallTimeOf } from '../../../server/sources/time'
import type { NormalisedEvent } from '../../../server/sources/types'
import { migratedMemoryDb } from '../db/helpers'

// The fixtures under test/fixtures/ics are what `pnpm dev` shows (see
// config.dev.yaml). "Today" is Wednesday 28 October 2026 and the clocks went
// back on Sunday 25 October.

const APP_DIR = join(import.meta.dirname, '../../..')
const TODAY = new Date('2026-10-28T12:00:00Z')
const WINDOW = syncWindow(TODAY, 'Europe/London', 12, 12)

const read = (name: string) => readFileSync(join(APP_DIR, 'test/fixtures/ics', name), 'utf8')
const expandFixture = (name: string) => expandIcs(read(name), WINDOW, { timeZone: 'Europe/London' })

/** What the wall shows on a day: timed events that start on it, and all-day events that cover it. */
function onDay(events: NormalisedEvent[], date: string) {
  return events.filter((event) => {
    if (event.allDay) return event.startDate! <= date && date < event.endDate!
    const wall = wallTimeOf(event.startAt, 'Europe/London')
    return `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}` === date
  })
}

const titlesOn = (events: NormalisedEvent[], date: string) => onDay(events, date).map(event => event.title)
const instants = (events: NormalisedEvent[]) => events.map(event => event.startAt.toISOString())
const only = (events: NormalisedEvent[], title: string) => events.filter(event => event.title === title)

describe('the files are what they say', () => {
  it.each(['family.ics', 'dad-work.ics', 'google-export.ics'])('%s has CRLF line endings, folded long lines and no bare newlines', (name) => {
    const text = read(name)

    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const line of text.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
  })

  it('google-export.ics carries no real data and says what it is', () => {
    const text = read('google-export.ics')

    expect(text).toContain('PRODID:-//Google Inc//Google Calendar')
    expect(text).toContain('X-WALLCAL-NOTE:')
    const emails = text.match(/[\w.+-]+@[\w.-]+/g) ?? []
    expect(emails.every(email => email.endsWith('@example.com') || email.endsWith('@google.com'))).toBe(true)
    expect(text).not.toMatch(/https?:\/\/(?!(school|meet)\.example)/)
  })
})

describe('family.ics', () => {
  const { events, warnings } = expandFixture('family.ics')

  it('expands without a warning', () => {
    expect(warnings).toEqual([])
    expect(events.length).toBeGreaterThan(400)
  })

  it('is busy enough for a month view, with one day of six or more events', () => {
    const october = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
    const counts = october.map(date => onDay(events, date).length)

    expect(Math.max(...counts)).toBeGreaterThanOrEqual(6)
    expect(counts.filter(count => count >= 3).length).toBeGreaterThanOrEqual(8)
    expect(titlesOn(events, '2026-10-31')).toEqual([
      'Dad: Cycling club',
      'Ballet',
      'Football',
      'Mum: Hair appointment',
      'Pumpkin carving',
      'Isla: Halloween party at Maya\'s',
      'Trick or treating',
    ])
  })

  it('shows today as a Wednesday in half term', () => {
    expect(titlesOn(events, '2026-10-28')).toEqual(['Half term', 'Poppy: Nursery', 'Theo: Swimming', 'Mum: Pilates'])
  })

  it('has half term as one five-day event', () => {
    const [halfTerm, ...rest] = only(events, 'Half term')

    expect(rest).toEqual([])
    expect(halfTerm).toMatchObject({ allDay: true, startDate: '2026-10-26', endDate: '2026-10-31', recurrenceId: '' })
    expect(halfTerm!.startAt.toISOString()).toBe('2026-10-26T00:00:00.000Z') // the clocks have gone back
    expect(halfTerm!.description).toContain('Who: Family')
    expect([26, 27, 28, 29, 30, 31].map(day => titlesOn(events, `2026-10-${day}`).includes('Half term'))).toEqual([true, true, true, true, true, false])
  })

  it('keeps the weekly swimming at 16:30 local time across the October change, with one week moved', () => {
    const swimming = only(events, 'Theo: Swimming').filter(event => event.startAt >= new Date('2026-10-01Z') && event.startAt < new Date('2026-11-10Z'))

    expect(swimming.map(event => [event.recurrenceId, event.startAt.toISOString(), event.endAt.toISOString()])).toEqual([
      ['20261007T153000Z', '2026-10-07T15:30:00.000Z', '2026-10-07T16:15:00.000Z'], // BST
      ['20261014T153000Z', '2026-10-14T15:30:00.000Z', '2026-10-14T16:15:00.000Z'],
      ['20261021T153000Z', '2026-10-21T16:00:00.000Z', '2026-10-21T16:45:00.000Z'], // moved to 17:00 BST
      ['20261028T163000Z', '2026-10-28T16:30:00.000Z', '2026-10-28T17:15:00.000Z'], // GMT
      ['20261104T163000Z', '2026-11-04T16:30:00.000Z', '2026-11-04T17:15:00.000Z'],
    ])
    expect(swimming[2]!.description).toContain('Pool timetable changed')
  })

  it('leaves rhyme time out of half term', () => {
    const rhyme = instants(only(events, 'Rhyme time').filter(event => event.startAt >= new Date('2026-10-18Z') && event.startAt < new Date('2026-11-06Z')))

    expect(rhyme).toEqual([
      '2026-10-20T09:00:00.000Z', // Tue, BST
      '2026-10-22T09:00:00.000Z',
      // 27 and 29 October are EXDATEs
      '2026-11-03T10:00:00.000Z', // Tue, GMT
      '2026-11-05T10:00:00.000Z',
    ])
  })

  it('alternates the bins fortnightly on Thursdays', () => {
    const dates = (title: string) => only(events, title).filter(event => event.startDate! >= '2026-10-01' && event.startDate! < '2026-11-10').map(event => event.startDate)

    expect(dates('General waste bin')).toEqual(['2026-10-01', '2026-10-15', '2026-10-29'])
    expect(dates('Recycling bin')).toEqual(['2026-10-08', '2026-10-22', '2026-11-05'])
  })

  it('has monthly events on the right days', () => {
    expect(instants(only(events, 'Book club').filter(event => event.startAt >= new Date('2026-10-01Z') && event.startAt < new Date('2027-01-01Z')))).toEqual([
      '2026-10-13T18:30:00.000Z', // second Tuesday, BST
      '2026-11-10T19:30:00.000Z',
      '2026-12-08T19:30:00.000Z',
    ])
    // The rent series starts on 1 September 2026 and the window ends at midnight on 1 November 2027.
    const rent = only(events, 'Rent due').map(event => event.startDate)
    expect(rent.slice(0, 3)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01'])
    expect(rent).toHaveLength(14)
    expect(rent.at(-1)).toBe('2027-10-01')
  })

  it('has birthdays every year in the window', () => {
    expect(only(events, 'Isla\'s birthday').map(event => event.startDate)).toEqual(['2025-10-17', '2026-10-17', '2027-10-17'])
    // Poppy's next one is 3 November 2027: after the window, which ends on 1 November.
    expect(only(events, 'Poppy\'s birthday').map(event => event.startDate)).toEqual(['2025-11-03', '2026-11-03'])
  })

  it('names people in titles, in descriptions, and not at all', () => {
    const byTitle = events.filter(event => /^(Theo|Mum|Dad|Isla|Poppy):|^\[/.test(event.title))
    const byDescription = events.filter(event => /^Who: /m.test(event.description ?? ''))
    const keywordOnly = events.filter(event => ['Ballet', 'Football', 'Rhyme time', 'Brownies', 'Playgroup'].includes(event.title))

    expect(byTitle.length).toBeGreaterThan(40)
    expect(byDescription.length).toBeGreaterThan(10)
    expect(keywordOnly.length).toBeGreaterThan(100)
    expect(events.find(event => event.title === '[Isla & Theo] Dentist')).toMatchObject({ description: 'Who: Isla, Theo\nSix-month check-up.' })
  })

  it('has a Google-style HTML description to be cleaned up later', () => {
    const description = events.find(event => event.title === 'Parents\' evening')!.description

    expect(description).toContain('Who: Mum<br>Bring the reading folder<br><b>Room 4</b> &amp; the hall')
  })

  it('has the lunch on the day the clocks change at its local time', () => {
    const lunch = events.find(event => event.title === 'Sunday lunch at Grandma\'s')!

    expect(lunch.startAt.toISOString()).toBe('2026-10-25T12:30:00.000Z') // GMT again by lunchtime
  })
})

describe('dad-work.ics', () => {
  const { events, warnings } = expandFixture('dad-work.ics')

  it('expands without a warning', () => {
    expect(warnings).toEqual([])
    expect(events.length).toBeGreaterThan(100)
  })

  it('has the stand-up on Monday, Tuesday and Thursday, except two days of leave, with one moved', () => {
    const week = only(events, 'Team stand-up').concat(only(events, 'Team stand-up (moved)'))
      .filter(event => event.startAt >= new Date('2026-10-19Z') && event.startAt < new Date('2026-11-03Z'))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())

    expect(week.map(event => [event.title, event.startAt.toISOString()])).toEqual([
      ['Team stand-up', '2026-10-19T08:15:00.000Z'], // Mon, BST
      ['Team stand-up', '2026-10-20T08:15:00.000Z'],
      ['Team stand-up', '2026-10-22T08:15:00.000Z'],
      // 26 and 27 October: leave
      ['Team stand-up (moved)', '2026-10-29T10:00:00.000Z'], // Thu, GMT, moved from 09:15
      ['Team stand-up', '2026-11-02T09:15:00.000Z'], // Mon
    ])
    expect(week[3]!.recurrenceId).toBe('20261029T091500Z')
  })

  it('has the work trip as three all-day dates and a train', () => {
    expect(only(events, 'Work trip: Manchester office')).toMatchObject([{ startDate: '2026-11-03', endDate: '2026-11-06', allDay: true, location: 'Manchester' }])
    expect(only(events, 'Train to Manchester')[0]!.startAt.toISOString()).toBe('2026-11-03T07:12:00.000Z')
  })

  it('reads a DURATION', () => {
    const [planning] = only(events, 'Quarterly planning')

    expect([planning!.startAt.toISOString(), planning!.endAt.toISOString()]).toEqual(['2026-10-22T12:00:00.000Z', '2026-10-22T16:00:00.000Z'])
  })
})

describe('google-export.ics', () => {
  const { events, warnings } = expandFixture('google-export.ics')

  it('expands without a warning to the events we expect', () => {
    expect(warnings).toEqual([])
    const uids = [...new Set(events.map(event => event.uid))].sort()

    expect(uids).toEqual([
      '0o2q4s6u8w0y2a4c6e8g0i2k4m@google.com',
      '1d7q9m2c8k4f6h0b3n5p7r9t1v@google.com',
      '2e4g6i8k0m2o4q6s8u0w2y4a6c@google.com',
      '3i5k7m9o1q3s5u7w9y1a3c5e7g@google.com',
      '4h8j2l6n0p3r5t7v9x1z3b5d7f@google.com',
      '5k7m9o1q3s5u7w9y1a3c5e7g9i@google.com',
      '6c0e2g4i6k8m0o2q4s6u8w0y2a@google.com',
      '7m9o1q3s5u7w9y1a3c5e7g9i1k@google.com',
      '8g0i2k4m6o8q0s2u4w6y8a0c2e@google.com',
      '9b1d3f5h7j9l1n3p5r7t9v1x3z@google.com',
    ])
  })

  it('unescapes the text the way Google writes it', () => {
    const [parents] = only(events, 'Parents\' evening')

    expect(parents).toMatchObject({
      startAt: new Date('2026-10-12T17:00:00Z'),
      endAt: new Date('2026-10-12T18:00:00Z'),
      location: 'Oakfield Primary School, 1 School Lane, Exampleton',
    })
    expect(parents!.description).toBe('Who: Sam<br>Bring the reading folder and the form<br><b>Room 4</b> &amp; the main hall<br><br>Slots: <a href="https://school.example/slots">school.example/slots</a>\nThanks, see you there; ask at the office if you are late.')
  })

  it('has swimming every Wednesday, without the EXDATE, with the moved week', () => {
    const swimming = only(events, 'Swimming').filter(event => event.startAt >= new Date('2026-10-01Z') && event.startAt < new Date('2026-11-05Z'))

    expect(instants(swimming)).toEqual([
      '2026-10-07T15:30:00.000Z',
      // 14 October is an EXDATE
      '2026-10-21T16:00:00.000Z', // moved to 17:00 BST
      '2026-10-28T16:30:00.000Z', // 16:30 GMT
      '2026-11-04T16:30:00.000Z',
    ])
    expect(swimming[1]).toMatchObject({ recurrenceId: '20261021T153000Z', description: 'Pool opens late this week.' })
    expect(swimming[0]!.description).toBeNull()
  })

  it('has the book club, less the cancelled night', () => {
    const club = events.filter(event => event.title === 'Book club')

    expect(instants(club.filter(event => event.startAt < new Date('2027-01-01Z')))).toEqual([
      '2026-09-08T18:30:00.000Z',
      '2026-10-13T18:30:00.000Z',
      // 10 November is cancelled
      '2026-12-08T19:30:00.000Z',
    ])
  })

  it('keeps an invitation to one instance (an orphan override) as an event of its own', () => {
    expect(events.filter(event => event.title === 'Catch-up lunch')).toMatchObject([{
      uid: '6c0e2g4i6k8m0o2q4s6u8w0y2a@google.com',
      recurrenceId: '20261104T120000Z',
      startAt: new Date('2026-11-04T12:00:00Z'),
      location: 'The Example Cafe',
    }])
  })

  it('reads the all-day, UTC, untitled and clocks-change events', () => {
    expect(only(events, 'Half term')).toMatchObject([{ startDate: '2026-10-26', endDate: '2026-10-31' }])
    expect(only(events, 'Supplier call')[0]!.startAt.toISOString()).toBe('2026-11-09T15:00:00.000Z')
    expect(only(events, '(No title)')[0]!.startAt.toISOString()).toBe('2026-11-20T10:00:00.000Z')
    expect(only(events, 'Sunday lunch at Grandma\'s')[0]!.startAt.toISOString()).toBe('2026-10-25T12:30:00.000Z')
    expect(instants(only(events, 'Sunday run'))).toEqual([
      '2026-10-18T08:00:00.000Z', // BST
      '2026-10-25T09:00:00.000Z', // the morning the clocks went back
      '2026-11-01T09:00:00.000Z',
      '2026-11-08T09:00:00.000Z',
    ])
  })

  it('reads the same with the VTIMEZONE taken out, because the system rules say the same as Google\'s', () => {
    const withoutZone = read('google-export.ics').replace(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/, '')

    expect(withoutZone).not.toContain('VTIMEZONE')
    expect(expandIcs(withoutZone, WINDOW, { timeZone: 'Europe/London' })).toEqual({ events, warnings })
  })
})

describe('config.dev.yaml', () => {
  it('syncs both of its calendars from the fixtures, and then finds nothing changed', async () => {
    const config = loadConfig({ configFile: join(APP_DIR, 'config.dev.yaml'), env: {} })
    const { db } = migratedMemoryDb()
    const run = async () => {
      const results = []
      for (const calendar of config.calendars) {
        results.push(await syncIcsCalendar({ db, calendar, people: config.people, timeZone: config.timezone, sync: config.sync, now: TODAY }))
      }
      return results
    }

    const first = await run()

    expect(first).toMatchObject([
      { status: 'updated', warnings: [], deleted: 0, updated: 0 },
      { status: 'updated', warnings: [], deleted: 0, updated: 0 },
    ])
    expect(first.map(result => 'total' in result && result.total)).toEqual([expandFixture('family.ics').events.length, expandFixture('dad-work.ics').events.length])
    expect(await run()).toEqual([{ status: 'not-modified' }, { status: 'not-modified' }])
  })

  it('stores each event with its people and the title for the wall', async () => {
    const config = loadConfig({ configFile: join(APP_DIR, 'config.dev.yaml'), env: {} })
    const { db } = migratedMemoryDb()
    for (const calendar of config.calendars) {
      await syncIcsCalendar({ db, calendar, people: config.people, timeZone: config.timezone, sync: config.sync, now: TODAY })
    }

    const rows = db.select().from(eventsTable).all()
    const swim = rows.find(row => row.title === 'Theo: Swimming' && row.startAt.toISOString() === '2026-10-28T16:30:00.000Z')
    const dentist = rows.find(row => row.title === '[Isla & Theo] Dentist')
    const standup = rows.find(row => row.calendarId === 'dad-work')

    expect(swim).toMatchObject({ displayTitle: 'Swimming', personIds: ['theo'] })
    expect(dentist).toMatchObject({ displayTitle: 'Dentist', personIds: ['isla', 'theo'] })
    expect(standup!.personIds).toEqual(['dad'])
  })
})
