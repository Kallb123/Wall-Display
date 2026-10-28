import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { IcsSourceError } from '../../../server/sources/ics/errors'
import { calendar, expand, starts, vevent, WINDOW } from './helpers'

const LONDON = 'Europe/London'
const at = (lines: string, tz = LONDON) => `;TZID=${tz}:${lines}`

// Every expected time below is a UTC instant, worked out by hand from the
// rule that London is on UTC in winter and an hour ahead (BST) in summer.
// In 2026 the clocks go forward at 01:00 UTC on Sun 29 March and back at
// 01:00 UTC on Sun 25 October.

describe('one-off events', () => {
  it('maps a timed event to UTC instants, in summer and winter', () => {
    const { events } = expand(calendar([
      vevent('summer', `DTSTART${at('20260910T180000')}`, `DTEND${at('20260910T193000')}`, 'SUMMARY:Summer'),
      vevent('winter', `DTSTART${at('20261210T180000')}`, `DTEND${at('20261210T193000')}`, 'SUMMARY:Winter'),
    ]))

    expect(events.map(e => [e.title, e.startAt.toISOString(), e.endAt.toISOString()])).toEqual([
      ['Summer', '2026-09-10T17:00:00.000Z', '2026-09-10T18:30:00.000Z'],
      ['Winter', '2026-12-10T18:00:00.000Z', '2026-12-10T19:30:00.000Z'],
    ])
    expect(events[0]).toMatchObject({ uid: 'summer', recurrenceId: '', allDay: false, startDate: null, endDate: null })
  })

  it('reads a UTC time as it is', () => {
    const { events } = expand(calendar([vevent('a', 'DTSTART:20260710T090000Z', 'DTEND:20260710T100000Z')]), { start: new Date('2026-07-01Z'), end: new Date('2026-08-01Z') })

    expect(starts(events)).toEqual(['2026-07-10T09:00:00.000Z'])
    expect(events[0]!.endAt.toISOString()).toBe('2026-07-10T10:00:00.000Z')
  })

  it('reads a floating time as a wall time in the display zone, not the process zone', () => {
    // The process runs in Auckland (see vitest.config.ts); London is an hour behind UTC in July.
    const july = { start: new Date('2026-07-01Z'), end: new Date('2026-08-01Z') }
    const summer = expand(calendar([vevent('a', 'DTSTART:20260710T090000')]), july)
    const newYork = expand(calendar([vevent('a', 'DTSTART:20260710T090000')]), july, { timeZone: 'America/New_York' })

    expect(starts(summer.events)).toEqual(['2026-07-10T08:00:00.000Z'])
    expect(starts(newYork.events)).toEqual(['2026-07-10T13:00:00.000Z'])
    expect(summer.warnings).toEqual([])
  })

  it('uses the system rules for an IANA TZID, with or without a VTIMEZONE in the feed', () => {
    const july = { start: new Date('2026-07-01Z'), end: new Date('2026-08-01Z') }
    const text = (zones: string[][]) => calendar([
      vevent('ny', `DTSTART${at('20260710T090000', 'America/New_York')}`),
      vevent('ldn', `DTSTART${at('20260710T090000')}`),
    ], { zones })

    for (const zones of [[], undefined]) {
      const { events, warnings } = expand(text(zones as string[][]), july)
      expect(events.map(e => [e.uid, e.startAt.toISOString()])).toEqual([
        ['ldn', '2026-07-10T08:00:00.000Z'],
        ['ny', '2026-07-10T13:00:00.000Z'],
      ])
      expect(warnings).toEqual([])
    }
  })

  it('reads a TZID that only the feed defines (Outlook\'s "GMT Standard Time") with the feed\'s rules', () => {
    const outlookLondon = [[
      'BEGIN:VTIMEZONE',
      'TZID:GMT Standard Time',
      'BEGIN:STANDARD',
      'DTSTART:16011028T020000',
      'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0000',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:16010328T010000',
      'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
      'TZOFFSETFROM:+0000',
      'TZOFFSETTO:+0100',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
    ]]
    const { events, warnings } = expand(calendar([
      vevent('summer', `DTSTART${at('20260710T090000', 'GMT Standard Time')}`, `DTEND${at('20260710T100000', 'GMT Standard Time')}`),
      vevent('winter', `DTSTART${at('20261210T090000', 'GMT Standard Time')}`),
      vevent('weekly', `DTSTART${at('20261018T090000', 'GMT Standard Time')}`, 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Weekly'),
    ], { zones: outlookLondon }), { start: new Date('2026-07-01Z'), end: new Date('2027-01-01Z') })

    expect(events.map(e => [e.uid, e.startAt.toISOString()])).toEqual([
      ['summer', '2026-07-10T08:00:00.000Z'],
      ['weekly', '2026-10-18T08:00:00.000Z'],
      ['weekly', '2026-10-25T09:00:00.000Z'], // the clocks went back that morning
      ['weekly', '2026-11-01T09:00:00.000Z'],
      ['winter', '2026-12-10T09:00:00.000Z'],
    ])
    expect(events[0]!.endAt.toISOString()).toBe('2026-07-10T09:00:00.000Z')
    expect(warnings).toEqual([])
  })

  it('reads an unknown TZID as display-zone time and says so once per zone', () => {
    const { events, warnings } = expand(calendar([
      vevent('a', `DTSTART${at('20260910T090000', 'Mars/Olympus_Mons')}`),
      vevent('b', `DTSTART${at('20260911T090000', 'Mars/Olympus_Mons')}`),
      vevent('c', `DTSTART${at('20260912T090000', 'Custom Zone')}`),
    ]))

    expect(starts(events)).toEqual(['2026-09-10T08:00:00.000Z', '2026-09-11T08:00:00.000Z', '2026-09-12T08:00:00.000Z'])
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('Mars/Olympus_Mons')
    expect(warnings[1]).toContain('Custom Zone')
  })

  it('keeps one feed\'s VTIMEZONE from leaking into another', () => {
    const feed = (offset: string) => calendar([vevent('a', `DTSTART${at('20260910T090000', 'Custom')}`)], {
      zones: [['BEGIN:VTIMEZONE', 'TZID:Custom', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`, 'END:STANDARD', 'END:VTIMEZONE']],
    })

    expect(starts(expand(feed('+0200')).events)).toEqual(['2026-09-10T07:00:00.000Z'])
    expect(starts(expand(feed('+0500')).events)).toEqual(['2026-09-10T04:00:00.000Z'])
    expect(ICAL.TimezoneService.has('Custom')).toBe(false)
    expect(ICAL.TimezoneService.has('Europe/London')).toBe(false)
  })

  it('has no end for a timed event with none, and ends one that ends before it starts where it starts', () => {
    const { events } = expand(calendar([
      vevent('open', `DTSTART${at('20260910T090000')}`),
      vevent('backwards', `DTSTART${at('20260911T090000')}`, `DTEND${at('20260911T080000')}`),
      vevent('duration', `DTSTART${at('20260912T090000')}`, 'DURATION:PT90M'),
    ]))

    expect(events.map(e => [e.uid, e.startAt.toISOString(), e.endAt.toISOString()])).toEqual([
      ['open', '2026-09-10T08:00:00.000Z', '2026-09-10T08:00:00.000Z'],
      ['backwards', '2026-09-11T08:00:00.000Z', '2026-09-11T08:00:00.000Z'],
      ['duration', '2026-09-12T08:00:00.000Z', '2026-09-12T09:30:00.000Z'],
    ])
  })

  it('uses the start and end zones separately', () => {
    // 09:00 in London (BST) to 12:00 in Paris (CEST): two hours.
    const { events } = expand(calendar([
      vevent('flight', `DTSTART${at('20260910T090000')}`, `DTEND${at('20260910T120000', 'Europe/Paris')}`),
    ]))

    expect(events[0]!.startAt.toISOString()).toBe('2026-09-10T08:00:00.000Z')
    expect(events[0]!.endAt.toISOString()).toBe('2026-09-10T10:00:00.000Z')
  })

  it('ignores calendar items that are not events', () => {
    const text = calendar([
      vevent('event', `DTSTART${at('20260910T090000')}`),
      ['BEGIN:VTODO', 'UID:todo', 'DTSTAMP:20260101T000000Z', 'DUE:20260910T090000Z', 'SUMMARY:Do it', 'END:VTODO'],
      ['BEGIN:VJOURNAL', 'UID:journal', 'DTSTAMP:20260101T000000Z', 'DTSTART:20260910T090000Z', 'SUMMARY:Dear diary', 'END:VJOURNAL'],
      ['BEGIN:VFREEBUSY', 'UID:busy', 'DTSTAMP:20260101T000000Z', 'DTSTART:20260910T090000Z', 'DTEND:20260910T100000Z', 'END:VFREEBUSY'],
    ])

    expect(expand(text).events.map(e => e.uid)).toEqual(['event'])
  })
})

describe('daylight saving', () => {
  const spring = { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-05-01T00:00:00Z') }
  const autumn = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') }

  it('keeps a weekly 09:00 London event at 09:00 across the March change', () => {
    const { events } = expand(calendar([
      vevent('weekly', `DTSTART${at('20260315T090000')}`, `DTEND${at('20260315T100000')}`, 'RRULE:FREQ=WEEKLY;COUNT=5', 'SUMMARY:Weekly'),
    ]), spring)

    expect(starts(events)).toEqual([
      '2026-03-15T09:00:00.000Z', // GMT
      '2026-03-22T09:00:00.000Z',
      '2026-03-29T08:00:00.000Z', // BST: the same wall time, an hour earlier in UTC
      '2026-04-05T08:00:00.000Z',
      '2026-04-12T08:00:00.000Z',
    ])
    expect(events.map(e => e.endAt.getTime() - e.startAt.getTime())).toEqual(Array(5).fill(3_600_000))
  })

  it('keeps a weekly 09:00 London event at 09:00 across the October change', () => {
    const { events } = expand(calendar([
      vevent('weekly', `DTSTART${at('20261011T090000')}`, `DTEND${at('20261011T100000')}`, 'RRULE:FREQ=WEEKLY;COUNT=5', 'SUMMARY:Weekly'),
    ]), autumn)

    expect(starts(events)).toEqual([
      '2026-10-11T08:00:00.000Z', // BST
      '2026-10-18T08:00:00.000Z',
      '2026-10-25T09:00:00.000Z', // GMT: an hour later in UTC
      '2026-11-01T09:00:00.000Z',
      '2026-11-08T09:00:00.000Z',
    ])
  })

  it('keeps a daily event at the same wall time on the days of the change', () => {
    const { events } = expand(calendar([
      vevent('daily', `DTSTART${at('20261023T230000')}`, 'RRULE:FREQ=DAILY;COUNT=4'),
    ]), autumn)

    expect(starts(events)).toEqual([
      '2026-10-23T22:00:00.000Z',
      '2026-10-24T22:00:00.000Z',
      '2026-10-25T23:00:00.000Z',
      '2026-10-26T23:00:00.000Z',
    ])
  })

  it('does not move a series written in UTC when the clocks change', () => {
    const { events } = expand(calendar([
      vevent('utc', 'DTSTART:20261018T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=3'),
    ]), autumn)

    expect(starts(events)).toEqual(['2026-10-18T09:00:00.000Z', '2026-10-25T09:00:00.000Z', '2026-11-01T09:00:00.000Z'])
  })

  it('moves a time the spring change skips forward by the gap', () => {
    // 01:30 does not exist in London on 29 March 2026.
    const { events } = expand(calendar([
      vevent('gap', `DTSTART${at('20260329T013000')}`, `DTEND${at('20260329T023000')}`),
      vevent('weekly', `DTSTART${at('20260322T013000')}`, 'RRULE:FREQ=WEEKLY;COUNT=3'),
    ]), spring)

    expect(events.map(e => [e.uid, e.startAt.toISOString()])).toEqual([
      ['weekly', '2026-03-22T01:30:00.000Z'],
      ['gap', '2026-03-29T01:30:00.000Z'], // reads 02:30 BST
      ['weekly', '2026-03-29T01:30:00.000Z'],
      ['weekly', '2026-04-05T00:30:00.000Z'],
    ])
    expect(events.find(e => e.uid === 'gap')!.endAt.toISOString()).toBe('2026-03-29T01:30:00.000Z')
  })

  it('takes the first of the two times the autumn change repeats', () => {
    // 01:30 happens twice in London on 25 October 2026. The first one is BST.
    const { events } = expand(calendar([
      vevent('overlap', `DTSTART${at('20261025T013000')}`),
    ]), autumn)

    expect(starts(events)).toEqual(['2026-10-25T00:30:00.000Z'])
  })

  it('gives the elapsed time of an event that spans a change', () => {
    const { events } = expand(calendar([
      vevent('night-spring', `DTSTART${at('20260329T003000')}`, `DTEND${at('20260329T033000')}`),
      vevent('night-autumn', `DTSTART${at('20261025T003000')}`, `DTEND${at('20261025T033000')}`),
    ]), { start: new Date('2026-01-01Z'), end: new Date('2027-01-01Z') })

    expect(events.map(e => [e.uid, e.startAt.toISOString(), e.endAt.toISOString()])).toEqual([
      ['night-spring', '2026-03-29T00:30:00.000Z', '2026-03-29T02:30:00.000Z'], // 2 hours on the clock face: 3
      ['night-autumn', '2026-10-24T23:30:00.000Z', '2026-10-25T03:30:00.000Z'], // 4 hours elapsed
    ])
  })

  it('puts the midnights of an all-day event spanning a change either side of it', () => {
    const { events } = expand(calendar([
      vevent('weekend-autumn', 'DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261027', 'SUMMARY:Autumn'),
      vevent('weekend-spring', 'DTSTART;VALUE=DATE:20260328', 'DTEND;VALUE=DATE:20260331', 'SUMMARY:Spring'),
    ]), { start: new Date('2026-01-01Z'), end: new Date('2027-01-01Z') })

    expect(events.map(e => [e.uid, e.startAt.toISOString(), e.endAt.toISOString(), e.startDate, e.endDate])).toEqual([
      ['weekend-spring', '2026-03-28T00:00:00.000Z', '2026-03-30T23:00:00.000Z', '2026-03-28', '2026-03-31'],
      ['weekend-autumn', '2026-10-23T23:00:00.000Z', '2026-10-27T00:00:00.000Z', '2026-10-24', '2026-10-27'],
    ])
  })
})

describe('all-day events', () => {
  it('has local midnight as its instants and the dates as written, with an exclusive end', () => {
    const { events } = expand(calendar([
      vevent('single', 'DTSTART;VALUE=DATE:20260910', 'SUMMARY:Single'),
      vevent('winter', 'DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261106', 'SUMMARY:Winter'),
    ]))

    expect(events.map(e => [e.uid, e.allDay, e.startAt.toISOString(), e.endAt.toISOString(), e.startDate, e.endDate])).toEqual([
      ['single', true, '2026-09-09T23:00:00.000Z', '2026-09-10T23:00:00.000Z', '2026-09-10', '2026-09-11'],
      ['winter', true, '2026-11-05T00:00:00.000Z', '2026-11-06T00:00:00.000Z', '2026-11-05', '2026-11-06'],
    ])
  })

  it('keeps a multi-day event whole', () => {
    // Half term: Monday 26 to Friday 30 October 2026, so the end date is Saturday the 31st.
    const { events } = expand(calendar([
      vevent('half-term', 'DTSTART;VALUE=DATE:20261026', 'DTEND;VALUE=DATE:20261031', 'SUMMARY:Half term'),
    ]))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ allDay: true, startDate: '2026-10-26', endDate: '2026-10-31' })
    expect(events[0]!.startAt.toISOString()).toBe('2026-10-26T00:00:00.000Z')
    expect(events[0]!.endAt.toISOString()).toBe('2026-10-31T00:00:00.000Z')
  })

  it('takes its length from a DURATION, and is a day long when it has no end or an end that is not after its start', () => {
    const { events } = expand(calendar([
      vevent('duration', 'DTSTART;VALUE=DATE:20261110', 'DURATION:P3D'),
      vevent('same-day', 'DTSTART;VALUE=DATE:20261111', 'DTEND;VALUE=DATE:20261111'),
      vevent('backwards', 'DTSTART;VALUE=DATE:20261112', 'DTEND;VALUE=DATE:20261110'),
      vevent('week', 'DTSTART;VALUE=DATE:20261113', 'DURATION:P1W'),
    ]))

    expect(events.map(e => [e.uid, e.startDate, e.endDate])).toEqual([
      ['duration', '2026-11-10', '2026-11-13'],
      ['same-day', '2026-11-11', '2026-11-12'],
      ['backwards', '2026-11-12', '2026-11-13'],
      ['week', '2026-11-13', '2026-11-20'],
    ])
  })

  it('expands a yearly birthday and a fortnightly all-day event, with date-only recurrence ids', () => {
    const { events } = expand(calendar([
      vevent('birthday', 'DTSTART;VALUE=DATE:20190917', 'RRULE:FREQ=YEARLY', 'SUMMARY:Isla\'s birthday'),
      vevent('bins', 'DTSTART;VALUE=DATE:20260903', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH', 'SUMMARY:Bins'),
    ]), { start: new Date('2026-08-31T23:00:00Z'), end: new Date('2026-09-30T23:00:00Z') })

    expect(events.map(e => [e.uid, e.recurrenceId, e.startDate, e.endDate])).toEqual([
      ['bins', '20260903', '2026-09-03', '2026-09-04'],
      ['bins', '20260917', '2026-09-17', '2026-09-18'],
      ['birthday', '20260917', '2026-09-17', '2026-09-18'],
    ])
  })
})

describe('recurring events', () => {
  it('expands a weekly BYDAY rule that stops at an UNTIL', () => {
    const { events } = expand(calendar([
      vevent('class', `DTSTART${at('20260907T090000')}`, `DTEND${at('20260907T100000')}`, 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260921T235959Z', 'SUMMARY:Class'),
    ]))

    expect(starts(events)).toEqual([
      '2026-09-07T08:00:00.000Z', // Mon
      '2026-09-09T08:00:00.000Z', // Wed
      '2026-09-14T08:00:00.000Z',
      '2026-09-16T08:00:00.000Z',
      '2026-09-21T08:00:00.000Z', // the last Monday
    ])
    expect(events.every(e => e.title === 'Class' && e.endAt.getTime() - e.startAt.getTime() === 3_600_000)).toBe(true)
  })

  it('expands a monthly rule on a day of the month', () => {
    const { events } = expand(calendar([
      vevent('rent', `DTSTART${at('20260915T190000')}`, 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15'),
    ]))

    expect(starts(events)).toEqual([
      '2026-09-15T18:00:00.000Z',
      '2026-10-15T18:00:00.000Z',
      '2026-11-15T19:00:00.000Z', // GMT by now
      '2026-12-15T19:00:00.000Z',
    ])
  })

  it('expands a monthly rule on the second Tuesday', () => {
    const { events } = expand(calendar([
      vevent('book-club', `DTSTART${at('20260908T193000')}`, 'RRULE:FREQ=MONTHLY;BYDAY=2TU'),
    ]))

    expect(starts(events)).toEqual([
      '2026-09-08T18:30:00.000Z',
      '2026-10-13T18:30:00.000Z',
      '2026-11-10T19:30:00.000Z',
      '2026-12-08T19:30:00.000Z',
    ])
  })

  it('leaves out an EXDATE', () => {
    const { events } = expand(calendar([
      vevent('swim', `DTSTART${at('20260902T100000')}`, 'RRULE:FREQ=WEEKLY;COUNT=4', `EXDATE${at('20260909T100000')}`),
    ]))

    expect(starts(events)).toEqual(['2026-09-02T09:00:00.000Z', '2026-09-16T09:00:00.000Z', '2026-09-23T09:00:00.000Z'])
  })

  it('leaves out an all-day EXDATE and adds an RDATE', () => {
    const { events } = expand(calendar([
      vevent('bins', 'DTSTART;VALUE=DATE:20260903', 'RRULE:FREQ=WEEKLY;COUNT=3', 'EXDATE;VALUE=DATE:20260910', 'RDATE;VALUE=DATE:20260905'),
      vevent('extra', `DTSTART${at('20260901T100000')}`, 'RRULE:FREQ=WEEKLY;COUNT=2', `RDATE${at('20260903T100000')}`),
    ]))

    expect(events.filter(e => e.uid === 'bins').map(e => e.startDate)).toEqual(['2026-09-03', '2026-09-05', '2026-09-17'])
    expect(starts(events.filter(e => e.uid === 'extra'))).toEqual(['2026-09-01T09:00:00.000Z', '2026-09-03T09:00:00.000Z', '2026-09-08T09:00:00.000Z'])
  })

  it('reads an RDATE written as a period by its start', () => {
    const { events, warnings } = expand(calendar([
      vevent('periods', 'DTSTART:20260901T100000Z', 'DTEND:20260901T110000Z', 'RDATE;VALUE=PERIOD:20260903T100000Z/PT2H'),
    ]))

    expect(starts(events)).toEqual(['2026-09-01T10:00:00.000Z', '2026-09-03T10:00:00.000Z'])
    expect(events[1]!.endAt.toISOString()).toBe('2026-09-03T11:00:00.000Z') // the series' length, as for any other date
    expect(warnings).toEqual([])
  })

  it('starts a series years before the window and still finds its instances in it', () => {
    const { events, warnings } = expand(calendar([
      vevent('standup', `DTSTART${at('20150105T090000')}`, 'RRULE:FREQ=WEEKLY;BYDAY=MO'),
      vevent('daily', `DTSTART${at('20100101T080000')}`, 'RRULE:FREQ=DAILY'),
    ]))

    const standups = events.filter(e => e.uid === 'standup')
    expect(standups).toHaveLength(17) // the Mondays from 7 September to 28 December
    expect(standups[0]!.startAt.toISOString()).toBe('2026-09-07T08:00:00.000Z')
    expect(standups.at(-1)!.startAt.toISOString()).toBe('2026-12-28T09:00:00.000Z')
    expect(events.filter(e => e.uid === 'daily')).toHaveLength(122) // 1 September to 31 December
    expect(warnings).toEqual([])
  })

  it('does not emit anything for a series that starts after the window', () => {
    const { events } = expand(calendar([
      vevent('later', `DTSTART${at('20270105T090000')}`, 'RRULE:FREQ=DAILY'),
    ]))

    expect(events).toEqual([])
  })

  it('stops an endless rule at the cap, keeps what it found, and warns', () => {
    const { events, warnings } = expand(calendar([
      vevent('endless', `DTSTART${at('20260901T000000')}`, 'RRULE:FREQ=MINUTELY', 'SUMMARY:Endless'),
    ]), WINDOW, { maxOccurrencesPerSeries: 500 })

    expect(events).toHaveLength(500)
    expect(events[0]!.startAt.toISOString()).toBe('2026-08-31T23:00:00.000Z')
    expect(warnings).toEqual(['"Endless" repeats more than 500 times, so only its first 500 were read'])
  })

  it('counts the occurrences before the window towards the cap', () => {
    const { events, warnings } = expand(calendar([
      vevent('old', `DTSTART${at('20100101T080000')}`, 'RRULE:FREQ=DAILY', 'SUMMARY:Old'),
    ]), WINDOW, { maxOccurrencesPerSeries: 1000 })

    expect(events).toEqual([]) // 1000 days from 2010 is 2012
    expect(warnings).toHaveLength(1)
  })

  it.each([
    ['the 30th of February, daily (which sends ical.js round in circles forever)', 'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30'],
    ['the 31st of April, every minute', 'FREQ=MINUTELY;BYMONTH=4;BYMONTHDAY=31'],
    ['the 30th of February, yearly (which ical.js moves to 2 March)', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'],
    ['the 31st of February or April', 'FREQ=MONTHLY;BYMONTH=2,4;BYMONTHDAY=31'],
  ])('skips a rule that names a day its months never have: %s', (_name, rule) => {
    const { events, warnings } = expand(calendar([
      vevent('never', `DTSTART${at('20260901T090000')}`, `RRULE:${rule}`, 'SUMMARY:Never'),
      vevent('fine', `DTSTART${at('20260901T090000')}`, 'SUMMARY:Fine'),
    ]))

    expect(events.map(e => e.title)).toEqual(['Fine'])
    expect(warnings).toEqual(['the repeat rule of "Never" can never be satisfied, so none of its events were read'])
  })

  it('still reads a rule for a day that only some of its months have', () => {
    const { events } = expand(calendar([
      vevent('thirty-first', `DTSTART${at('20261031T090000')}`, 'RRULE:FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3'),
      vevent('leap-day', `DTSTART${at('20240229T090000')}`, 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29'),
    ]), { start: new Date('2026-10-01Z'), end: new Date('2029-01-01Z') })

    expect(events.filter(e => e.uid === 'thirty-first').map(e => e.startAt.toISOString())).toEqual(['2026-10-31T09:00:00.000Z', '2026-12-31T09:00:00.000Z', '2027-01-31T09:00:00.000Z'])
    expect(events.filter(e => e.uid === 'leap-day').map(e => e.startAt.toISOString())).toEqual(['2028-02-29T09:00:00.000Z'])
  })

  it('skips a rule ical.js refuses without failing the rest', () => {
    const { events, warnings } = expand(calendar([
      vevent('refused', `DTSTART${at('20260901T090000')}`, 'RRULE:FREQ=WEEKLY;BYMONTHDAY=5', 'SUMMARY:Refused'),
      vevent('fine', `DTSTART${at('20260901T090000')}`, 'SUMMARY:Fine'),
    ]))

    expect(events.map(e => e.title)).toEqual(['Fine'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"Refused"')
  })
})

describe('overrides (RECURRENCE-ID)', () => {
  const weeklyTuesday = (extra: string[] = [], count = 4) => vevent('series', `DTSTART${at('20260901T100000')}`, `DTEND${at('20260901T110000')}`, `RRULE:FREQ=WEEKLY;COUNT=${count}`, 'SUMMARY:Series', ...extra)

  it('moves one instance and changes what it says, and tells it by the slot it replaced', () => {
    const { events } = expand(calendar([
      weeklyTuesday(),
      vevent('series', `RECURRENCE-ID${at('20260908T100000')}`, `DTSTART${at('20260908T140000')}`, `DTEND${at('20260908T153000')}`, 'SUMMARY:Moved', 'LOCATION:Pool'),
    ]))

    expect(events.map(e => [e.title, e.recurrenceId, e.startAt.toISOString(), e.endAt.toISOString()])).toEqual([
      ['Series', '20260901T090000Z', '2026-09-01T09:00:00.000Z', '2026-09-01T10:00:00.000Z'],
      ['Moved', '20260908T090000Z', '2026-09-08T13:00:00.000Z', '2026-09-08T14:30:00.000Z'],
      ['Series', '20260915T090000Z', '2026-09-15T09:00:00.000Z', '2026-09-15T10:00:00.000Z'],
      ['Series', '20260922T090000Z', '2026-09-22T09:00:00.000Z', '2026-09-22T10:00:00.000Z'],
    ])
    expect(events[1]!.location).toBe('Pool')
  })

  it('matches an override whose RECURRENCE-ID is written in UTC', () => {
    const { events } = expand(calendar([
      weeklyTuesday(),
      vevent('series', 'RECURRENCE-ID:20260908T090000Z', `DTSTART${at('20260908T140000')}`, `DTEND${at('20260908T150000')}`, 'SUMMARY:Moved'),
    ]))

    expect(events.map(e => e.title)).toEqual(['Series', 'Moved', 'Series', 'Series'])
  })

  it('drops an instance moved out of the window, and keeps no trace of its old slot', () => {
    const { events } = expand(calendar([
      weeklyTuesday([], 4),
      vevent('series', `RECURRENCE-ID${at('20260908T100000')}`, `DTSTART${at('20260820T100000')}`, `DTEND${at('20260820T110000')}`, 'SUMMARY:Moved earlier'),
    ]))

    expect(events.map(e => e.recurrenceId)).toEqual(['20260901T090000Z', '20260915T090000Z', '20260922T090000Z'])
  })

  it('brings in an instance moved into the window from before it', () => {
    const { events } = expand(calendar([
      vevent('series', `DTSTART${at('20260804T100000')}`, `DTEND${at('20260804T110000')}`, 'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:Series'),
      vevent('series', `RECURRENCE-ID${at('20260825T100000')}`, `DTSTART${at('20260902T100000')}`, `DTEND${at('20260902T110000')}`, 'SUMMARY:Moved later'),
    ]))

    // Series: 4 Aug, 11 Aug, 18 Aug (all before the window), the 25th moved to 2 September.
    expect(events.map(e => [e.title, e.recurrenceId, e.startAt.toISOString()])).toEqual([
      ['Moved later', '20260825T090000Z', '2026-09-02T09:00:00.000Z'],
    ])
  })

  it('brings in an instance moved into the window from after it, which the expansion never reaches', () => {
    const { events } = expand(calendar([
      vevent('series', `DTSTART${at('20261201T100000')}`, `DTEND${at('20261201T110000')}`, 'RRULE:FREQ=WEEKLY;COUNT=10', 'SUMMARY:Series'),
      vevent('series', `RECURRENCE-ID${at('20270105T100000')}`, `DTSTART${at('20261228T100000')}`, `DTEND${at('20261228T110000')}`, 'SUMMARY:Moved earlier'),
    ]))

    expect(events.map(e => [e.title, e.recurrenceId, e.startAt.toISOString()])).toEqual([
      ['Series', '20261201T100000Z', '2026-12-01T10:00:00.000Z'],
      ['Series', '20261208T100000Z', '2026-12-08T10:00:00.000Z'],
      ['Series', '20261215T100000Z', '2026-12-15T10:00:00.000Z'],
      ['Series', '20261222T100000Z', '2026-12-22T10:00:00.000Z'],
      ['Moved earlier', '20270105T100000Z', '2026-12-28T10:00:00.000Z'],
      ['Series', '20261229T100000Z', '2026-12-29T10:00:00.000Z'],
    ])
  })

  it('emits an override for a slot the rule would never have produced', () => {
    const { events } = expand(calendar([
      weeklyTuesday(),
      vevent('series', `RECURRENCE-ID${at('20260909T100000')}`, `DTSTART${at('20260909T110000')}`, `DTEND${at('20260909T120000')}`, 'SUMMARY:Extra'),
    ]))

    // The series meets on Tuesdays; the override names a Wednesday.
    expect(events.map(e => [e.title, e.recurrenceId])).toEqual([
      ['Series', '20260901T090000Z'],
      ['Series', '20260908T090000Z'],
      ['Extra', '20260909T090000Z'],
      ['Series', '20260915T090000Z'],
      ['Series', '20260922T090000Z'],
    ])
  })

  it('drops a cancelled instance, and does not bring the rule\'s one back', () => {
    const { events } = expand(calendar([
      weeklyTuesday(),
      vevent('series', `RECURRENCE-ID${at('20260915T100000')}`, `DTSTART${at('20260915T100000')}`, `DTEND${at('20260915T110000')}`, 'STATUS:CANCELLED', 'SUMMARY:Series'),
    ]))

    expect(events.map(e => e.recurrenceId)).toEqual(['20260901T090000Z', '20260908T090000Z', '20260922T090000Z'])
  })

  it('drops a whole cancelled series, overrides included, and a cancelled one-off', () => {
    const { events } = expand(calendar([
      weeklyTuesday(['STATUS:CANCELLED']),
      vevent('series', `RECURRENCE-ID${at('20260908T100000')}`, `DTSTART${at('20260908T140000')}`, `DTEND${at('20260908T150000')}`, 'SUMMARY:Moved'),
      vevent('one-off', `DTSTART${at('20260910T100000')}`, 'STATUS:CANCELLED'),
      vevent('kept', `DTSTART${at('20260911T100000')}`, 'STATUS:CONFIRMED'),
    ]))

    expect(events.map(e => e.uid)).toEqual(['kept'])
  })

  it('applies a THISANDFUTURE override to its slot and every later one', () => {
    const { events } = expand(calendar([
      vevent('series', `DTSTART${at('20260901T100000')}`, `DTEND${at('20260901T110000')}`, 'RRULE:FREQ=WEEKLY;COUNT=5', 'SUMMARY:Before'),
      vevent('series', `RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=${LONDON}:20260915T100000`, `DTSTART${at('20260915T113000')}`, `DTEND${at('20260915T123000')}`, 'SUMMARY:After'),
    ]))

    expect(events.map(e => [e.title, e.startAt.toISOString(), e.endAt.toISOString()])).toEqual([
      ['Before', '2026-09-01T09:00:00.000Z', '2026-09-01T10:00:00.000Z'],
      ['Before', '2026-09-08T09:00:00.000Z', '2026-09-08T10:00:00.000Z'],
      ['After', '2026-09-15T10:30:00.000Z', '2026-09-15T11:30:00.000Z'],
      ['After', '2026-09-22T10:30:00.000Z', '2026-09-22T11:30:00.000Z'],
      ['After', '2026-09-29T10:30:00.000Z', '2026-09-29T11:30:00.000Z'],
    ])
  })

  it('treats an override with no series (an invitation to one instance) as an event of its own', () => {
    const { events } = expand(calendar([
      vevent('orphan', `RECURRENCE-ID${at('20260915T100000')}`, `DTSTART${at('20260915T110000')}`, `DTEND${at('20260915T120000')}`, 'SUMMARY:Orphan'),
      vevent('orphan-day', 'RECURRENCE-ID;VALUE=DATE:20260916', 'DTSTART;VALUE=DATE:20260916', 'SUMMARY:Orphan day'),
    ]))

    expect(events.map(e => [e.uid, e.recurrenceId, e.title, e.startAt.toISOString()])).toEqual([
      ['orphan', '20260915T090000Z', 'Orphan', '2026-09-15T10:00:00.000Z'],
      ['orphan-day', '20260916', 'Orphan day', '2026-09-15T23:00:00.000Z'],
    ])
  })

  it('does not apply one UID\'s overrides to another series', () => {
    const { events } = expand(calendar([
      weeklyTuesday(),
      vevent('other', `DTSTART${at('20260901T100000')}`, 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:Other'),
      vevent('series', `RECURRENCE-ID${at('20260908T100000')}`, `DTSTART${at('20260908T140000')}`, 'SUMMARY:Moved'),
    ]))

    expect(events.filter(e => e.uid === 'other').map(e => e.title)).toEqual(['Other', 'Other'])
  })

  it('moves an all-day instance', () => {
    const { events } = expand(calendar([
      vevent('bins', 'DTSTART;VALUE=DATE:20260903', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Bins'),
      vevent('bins', 'RECURRENCE-ID;VALUE=DATE:20260910', 'DTSTART;VALUE=DATE:20260911', 'SUMMARY:Bins (Friday)'),
    ]))

    expect(events.map(e => [e.title, e.recurrenceId, e.startDate])).toEqual([
      ['Bins', '20260903', '2026-09-03'],
      ['Bins (Friday)', '20260910', '2026-09-11'],
      ['Bins', '20260917', '2026-09-17'],
    ])
  })
})

describe('duplicate UIDs', () => {
  const copy = (...lines: string[]) => vevent('dup', `DTSTART${at('20260910T100000')}`, ...lines)

  it('keeps the higher SEQUENCE', () => {
    const { events, warnings } = expand(calendar([
      copy('SEQUENCE:2', 'SUMMARY:Two'),
      copy('SEQUENCE:1', 'SUMMARY:One'),
    ]))

    expect(events.map(e => e.title)).toEqual(['Two'])
    expect(warnings).toHaveLength(1)
  })

  it('then the later LAST-MODIFIED', () => {
    const { events } = expand(calendar([
      copy('SEQUENCE:1', 'LAST-MODIFIED:20260102T000000Z', 'SUMMARY:Newer'),
      copy('SEQUENCE:1', 'LAST-MODIFIED:20260101T000000Z', 'SUMMARY:Older'),
    ]))

    expect(events.map(e => e.title)).toEqual(['Newer'])
  })

  it('then the one later in the file', () => {
    const { events } = expand(calendar([
      copy('SUMMARY:First'),
      copy('SUMMARY:Second'),
    ]))

    expect(events.map(e => e.title)).toEqual(['Second'])
  })

  it('keeps one override per slot too', () => {
    const { events } = expand(calendar([
      vevent('o', `RECURRENCE-ID${at('20260915T100000')}`, `DTSTART${at('20260915T110000')}`, 'SEQUENCE:1', 'SUMMARY:Old'),
      vevent('o', `RECURRENCE-ID${at('20260915T100000')}`, `DTSTART${at('20260915T120000')}`, 'SEQUENCE:2', 'SUMMARY:New'),
    ]))

    expect(events.map(e => e.title)).toEqual(['New'])
  })

  it('skips an event with no UID, and says so', () => {
    const { events, warnings } = expand(calendar([
      ['BEGIN:VEVENT', 'DTSTAMP:20260101T000000Z', `DTSTART${at('20260910T100000')}`, 'SUMMARY:No uid', 'END:VEVENT'],
      vevent('fine', `DTSTART${at('20260911T100000')}`),
    ]))

    expect(events.map(e => e.uid)).toEqual(['fine'])
    expect(warnings).toEqual(['1 event has no UID and was skipped'])
  })

  it('skips an event with no start, and says so, without failing the others', () => {
    const { events, warnings } = expand(calendar([
      vevent('no-start', 'SUMMARY:Nothing'),
      vevent('fine', `DTSTART${at('20260911T100000')}`),
    ]))

    expect(events.map(e => e.uid)).toEqual(['fine'])
    expect(warnings).toEqual([])
  })
})

describe('the window', () => {
  const window = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') }
  const timed = (uid: string, start: string, end?: string) => vevent(uid, `DTSTART:${start}`, ...(end ? [`DTEND:${end}`] : []))

  it('includes what overlaps it and excludes what only touches it', () => {
    const { events } = expand(calendar([
      timed('before', '20260930T090000Z', '20260930T100000Z'),
      timed('ends-at-start', '20260930T230000Z', '20261001T000000Z'),
      timed('crosses-start', '20260930T230000Z', '20261001T010000Z'),
      timed('inside', '20261015T090000Z', '20261015T100000Z'),
      timed('crosses-end', '20261031T230000Z', '20261101T010000Z'),
      timed('starts-at-end', '20261101T000000Z', '20261101T010000Z'),
      timed('after', '20261102T090000Z', '20261102T100000Z'),
      timed('spans-all', '20260901T090000Z', '20261201T090000Z'),
    ]), window)

    expect(events.map(e => e.uid)).toEqual(['spans-all', 'crosses-start', 'inside', 'crosses-end'])
  })

  it('includes a zero-length event that starts inside it, including at its start, but not at its end', () => {
    const { events } = expand(calendar([
      timed('zero-before', '20260930T235959Z'),
      timed('zero-at-start', '20261001T000000Z'),
      timed('zero-inside', '20261015T090000Z'),
      timed('zero-last-second', '20261031T235959Z'),
      timed('zero-at-end', '20261101T000000Z'),
    ]), window)

    expect(events.map(e => e.uid)).toEqual(['zero-at-start', 'zero-inside', 'zero-last-second'])
  })

  it('includes an all-day event that straddles an edge, going by its midnights', () => {
    const { events } = expand(calendar([
      vevent('ends-before', 'DTSTART;VALUE=DATE:20260929', 'DTEND;VALUE=DATE:20261001'), // BST: ends 2026-09-30T23:00Z
      vevent('straddles-start', 'DTSTART;VALUE=DATE:20260930', 'DTEND;VALUE=DATE:20261002'),
      vevent('straddles-end', 'DTSTART;VALUE=DATE:20261031', 'DTEND;VALUE=DATE:20261103'),
      vevent('starts-after', 'DTSTART;VALUE=DATE:20261101'),
    ]), { start: new Date('2026-09-30T23:00:00Z'), end: new Date('2026-10-31T00:00:00Z') })

    // Window: 1 October 00:00 BST to 31 October 00:00 GMT.
    expect(events.map(e => e.uid)).toEqual(['straddles-start'])
  })

  it('includes a multi-day event that has already started when the window opens', () => {
    const { events } = expand(calendar([
      vevent('holiday', 'DTSTART;VALUE=DATE:20260825', 'DTEND;VALUE=DATE:20260905'),
    ]))

    expect(events.map(e => e.startDate)).toEqual(['2026-08-25'])
  })
})

describe('text', () => {
  it('trims the title and falls back to "(No title)"', () => {
    const { events } = expand(calendar([
      vevent('a', `DTSTART${at('20260910T100000')}`, 'SUMMARY:  Swimming  '),
      vevent('b', `DTSTART${at('20260911T100000')}`),
      vevent('c', `DTSTART${at('20260912T100000')}`, 'SUMMARY:   '),
    ]))

    expect(events.map(e => e.title)).toEqual(['Swimming', '(No title)', '(No title)'])
  })

  it('unescapes the description and location, and leaves HTML alone', () => {
    const { events } = expand(calendar([
      vevent('a', `DTSTART${at('20260910T100000')}`,
        'DESCRIPTION:Who: Theo\\nBring goggles\\, a towel\\; and snacks<br><b>Pool 2</b> &amp; the café',
        'LOCATION:Leisure Centre\\, High Street'),
      vevent('b', `DTSTART${at('20260911T100000')}`, 'DESCRIPTION:   ', 'LOCATION:'),
    ]))

    expect(events[0]!.description).toBe('Who: Theo\nBring goggles, a towel; and snacks<br><b>Pool 2</b> &amp; the café')
    expect(events[0]!.location).toBe('Leisure Centre, High Street')
    expect(events[1]).toMatchObject({ description: null, location: null })
  })

  it('reads folded lines', () => {
    const text = calendar([vevent('a', `DTSTART${at('20260910T100000')}`, 'SUMMARY:A very long title that the exporter folded', ' onto a second line')])

    expect(expand(text).events[0]!.title).toBe('A very long title that the exporter foldedonto a second line')
  })
})

describe('output', () => {
  it('is sorted by start, then UID, then recurrence id, whatever order the file has', () => {
    const forward = [
      vevent('b', `DTSTART${at('20260910T100000')}`),
      vevent('a', `DTSTART${at('20260910T100000')}`),
      vevent('c', `DTSTART${at('20260909T100000')}`, 'RRULE:FREQ=DAILY;COUNT=3'),
    ]
    const one = expand(calendar(forward)).events
    const two = expand(calendar([...forward].reverse())).events

    expect(one.map(e => `${e.uid}${e.recurrenceId}`)).toEqual(['c20260909T090000Z', 'a', 'b', 'c20260910T090000Z', 'c20260911T090000Z'])
    expect(two).toEqual(one)
  })
})

describe('bad input', () => {
  it.each([
    ['text that is not a calendar', 'this is just some text with a SECRET-TOKEN in it'],
    ['an unreadable line inside a calendar', 'BEGIN:VCALENDAR\r\nSECRET-TOKEN\r\nEND:VCALENDAR\r\n'],
    ['an unfinished calendar', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\n'],
    ['a bare event', 'BEGIN:VEVENT\r\nUID:a\r\nEND:VEVENT\r\n'],
    ['nothing', ''],
  ])('reports %s as a parse error', (_name, text) => {
    let error: unknown
    try {
      expand(text)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(IcsSourceError)
    expect((error as IcsSourceError).kind).toBe('parse')
    expect((error as IcsSourceError).message).not.toContain('SECRET-TOKEN')
  })

  it('returns no events for a calendar with none', () => {
    expect(expand(calendar([]))).toEqual({ events: [], warnings: [] })
  })
})
