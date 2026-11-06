import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixtureEvents } from '../../helpers/fixtureEvents'
import { loadConfig } from '../../../server/config/load'
import { ALL_DAY_LANES, MAX_BADGE_INITIALS, MIN_BLOCK_MINUTES, PORTRAIT_MAX_TRACKS, weekLayout } from '../../../shared/week-layout'
import type { WeekLayout, WeekLayoutInput } from '../../../shared/week-layout'
import type { CalendarEvent, EventPerson } from '../../../shared/types/events'

// The same family and the same Wed 28 Oct 2026 as the month layout's tests
// (the clocks went back on the 25th). The week of 26 Oct to 1 Nov 2026 holds
// Half term, the dentist and the Halloween afternoon on the Saturday.

const APP_DIR = join(import.meta.dirname, '../../..')
const LONDON = 'Europe/London'
const NOW = new Date('2026-10-28T09:41:00Z')
const WED = '2026-10-28'
const dev = loadConfig({ configFile: join(APP_DIR, 'config.dev.yaml'), env: {} })

const person = (id: string): EventPerson => {
  const found = dev.people.find(candidate => candidate.id === id)!
  return { id: found.id, name: found.name, initial: found.initial, colour: found.colour }
}

const FIXTURES = fixtureEvents()

let nextId = 1000

/** A timed event from `start` to `end`, both ISO instants. */
function timed(start: string, end: string, title = 'Event', people: string[] = [], id = nextId++): CalendarEvent {
  return { id, calendar_id: 'family', title, display_title: title, location: null, start, end, all_day: false, start_date: null, end_date: null, people: people.map(person) }
}

/** An event on `date` from `from` to `to` (`HH:MM`, UTC; the zone is GMT on these dates). */
function between(date: string, from: string, to: string, title = 'Event', people: string[] = [], id = nextId++): CalendarEvent {
  return timed(`${date}T${from}:00Z`, `${date}T${to}:00Z`, title, people, id)
}

/** An all-day event on `first` up to but not including `after`. */
function allDay(first: string, after: string, title = 'All day', people: string[] = [], id = nextId++): CalendarEvent {
  return { ...timed(`${first}T00:00:00.000Z`, `${after}T00:00:00.000Z`, title, people, id), all_day: true, start_date: first, end_date: after }
}

function layout(overrides: Partial<WeekLayoutInput> = {}): WeekLayout {
  return weekLayout({ weekOf: WED, now: NOW, timeZone: LONDON, weekStart: 'monday', hours: { from: 7, to: 21 }, events: [], ...overrides })
}

const titles = (items: { event: CalendarEvent }[]) => items.map(item => item.event.display_title)
const blockOf = (result: WeekLayout, title: string) => result.blocks.find(block => block.event.display_title === title)!
const barsOf = (result: WeekLayout, title: string) => result.allDay.bars.filter(bar => bar.event.display_title === title)
const shape = (bar: WeekLayout['allDay']['bars'][number]) => ({ lane: bar.lane, column: bar.column, span: bar.span, roundStart: bar.roundStart, roundEnd: bar.roundEnd })

describe('the constants', () => {
  it('are three lanes, a half hour minimum and three initials', () => {
    expect([ALL_DAY_LANES, MIN_BLOCK_MINUTES, MAX_BADGE_INITIALS]).toEqual([3, 30, 3])
  })
})

describe('the week and its title', () => {
  it('runs Monday to Sunday around Wed 28 Oct 2026', () => {
    const result = layout()

    expect(result.title).toBe('26 October – 1 November 2026')
    expect(result.days.map(day => day.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(result.days.map(day => day.weekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(result.days.map(day => day.column)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(result.days.map(day => day.day)).toEqual([26, 27, 28, 29, 30, 31, 1])
  })

  it('is the same week whichever day of it is asked for', () => {
    for (const weekOf of ['2026-10-26', '2026-10-31', '2026-11-01']) {
      expect(layout({ weekOf }).days[0]!.date).toBe('2026-10-26')
    }
  })

  it('starts on Sunday when set, from 25 to 31 October', () => {
    const result = layout({ weekStart: 'sunday' })

    expect(result.title).toBe('25 – 31 October 2026')
    expect(result.days.map(day => day.weekday)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(layout({ weekStart: 'sunday', weekOf: '2026-11-01' }).days[0]!.date).toBe('2026-11-01')
  })

  it('names both years when the week spans them', () => {
    expect(layout({ weekOf: '2026-12-30' }).title).toBe('28 December 2026 – 3 January 2027')
  })

  it('names one month once', () => {
    expect(layout({ weekOf: '2026-10-07' }).title).toBe('5 – 11 October 2026')
  })

  it('marks today and the days before it', () => {
    const result = layout()

    expect(result.days.map(day => day.today)).toEqual([false, false, true, false, false, false, false])
    expect(result.days.map(day => day.past)).toEqual([true, true, false, false, false, false, false])
  })

  it('takes today from now, not from the week shown', () => {
    expect(layout({ weekOf: '2026-11-04' }).days.some(day => day.today || day.past)).toBe(false)
    expect(layout({ weekOf: '2026-10-21' }).days.every(day => day.past && !day.today)).toBe(true)
  })

  it('goes by the wall in the display zone, not the instant in UTC', () => {
    // 23:30 UTC on Wednesday is already Thursday in Sydney (UTC+11 in October).
    const result = layout({ now: new Date('2026-10-28T23:30:00Z'), timeZone: 'Australia/Sydney' })

    expect(result.days.find(day => day.today)!.date).toBe('2026-10-29')
  })
})

describe('an empty week', () => {
  const result = layout()

  it('has seven days, the hour labels and nothing else', () => {
    expect(result.days).toHaveLength(7)
    expect(result.hours).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    expect(result.rangeMinutes).toBe(14 * 60)
    expect(result.blocks).toEqual([])
    expect(result.overflow).toEqual([])
    expect(result.allDay).toEqual({ bars: [], more: [], lanes: 0 })
    expect(result.early!.items).toEqual([[], [], [], [], [], [], []])
    expect(result.late!.items).toEqual([[], [], [], [], [], [], []])
  })
})

describe('the fixtures in the week of 26 October 2026', () => {
  const result = layout({ events: FIXTURES })

  it('has Half term as one bar, Monday to Friday, square at neither end', () => {
    const [bar] = barsOf(result, 'Half term')

    expect(barsOf(result, 'Half term')).toHaveLength(1)
    expect(shape(bar!)).toEqual({ lane: 0, column: 0, span: 5, roundStart: true, roundEnd: true })
  })

  it('has the dentist on Tuesday, for two people', () => {
    const dentist = result.blocks.find(block => block.event.display_title.includes('Dentist'))!

    expect(dentist).toMatchObject({ column: 1, time: '14:30', range: '14:30–15:15', top: 7.5 * 60, height: 45 })
    expect(dentist.people).toHaveLength(2)
    expect(dentist.initials).toHaveLength(2)
  })

  it('puts the party and trick or treating side by side on Saturday, and the rest alone', () => {
    const saturday = result.blocks.filter(block => block.column === 5)
    const byTitle = (title: string) => saturday.find(block => block.event.display_title.includes(title))!

    expect(byTitle('Hair')).toMatchObject({ top: 7 * 60, height: 60, track: 0, tracks: 1 })
    expect(byTitle('Pumpkin')).toMatchObject({ top: 8 * 60, height: 60, track: 0, tracks: 1 })
    expect(byTitle('party')).toMatchObject({ top: 9.5 * 60, height: 120, track: 0, tracks: 2 })
    expect(byTitle('Trick')).toMatchObject({ top: 11 * 60, height: 90, track: 1, tracks: 2 })
  })

  it('has the recurring Saturday morning as blocks too', () => {
    const saturday = result.blocks.filter(block => block.column === 5).map(block => block.event.display_title)

    expect(saturday).toEqual(expect.arrayContaining(['Cycling club', 'Ballet', 'Football']))
  })

  it('has no events in the late band on a normal week', () => {
    expect(result.late!.items.flat()).toEqual([])
  })
})

describe('side by side', () => {
  const track = (result: WeekLayout) => result.blocks.map(block => [block.event.display_title, block.track, block.tracks])

  it('puts two equal events on tracks 0 and 1 of 2', () => {
    const result = layout({ events: [between(WED, '10:00', '11:00', 'B', [], 2), between(WED, '10:00', '11:00', 'A', [], 1)] })

    expect(track(result)).toEqual([['A', 0, 2], ['B', 1, 2]])
  })

  it('reuses a track: A overlaps B and B overlaps C, but A does not overlap C', () => {
    const result = layout({ events: [
      between(WED, '10:00', '11:00', 'A'),
      between(WED, '10:30', '11:30', 'B'),
      between(WED, '11:00', '12:00', 'C'),
    ] })

    expect(track(result)).toEqual([['A', 0, 2], ['B', 1, 2], ['C', 0, 2]])
  })

  it('does not overlap events that are back to back', () => {
    const result = layout({ events: [between(WED, '10:00', '11:00', 'A'), between(WED, '11:00', '12:00', 'B')] })

    expect(track(result)).toEqual([['A', 0, 1], ['B', 0, 1]])
  })

  it('overlaps two 10 minute events 15 minutes apart, because each is drawn 30 minutes long', () => {
    const result = layout({ events: [between(WED, '10:00', '10:10', 'A'), between(WED, '10:15', '10:25', 'B')] })

    expect(result.blocks.map(block => block.height)).toEqual([30, 30])
    expect(track(result)).toEqual([['A', 0, 2], ['B', 1, 2]])
  })

  it('puts the longer event first when two start together', () => {
    const result = layout({ events: [between(WED, '10:00', '10:30', 'Short'), between(WED, '10:00', '12:00', 'Long')] })

    expect(track(result)).toEqual([['Long', 0, 2], ['Short', 1, 2]])
  })

  it('gives each group its own number of tracks', () => {
    const result = layout({ events: [
      between(WED, '09:00', '10:00', 'A'),
      between(WED, '09:00', '10:00', 'B'),
      between(WED, '09:00', '10:00', 'C'),
      between(WED, '12:00', '13:00', 'D'),
    ] })

    expect(track(result)).toEqual([['A', 0, 3], ['B', 1, 3], ['C', 2, 3], ['D', 0, 1]])
  })

  it('keeps one column from affecting another', () => {
    const result = layout({ events: [between(WED, '10:00', '11:00', 'A'), between('2026-10-29', '10:00', '11:00', 'B')] })

    expect(track(result)).toEqual([['A', 0, 1], ['B', 0, 1]])
    expect(result.blocks.map(block => block.column)).toEqual([2, 3])
  })

  it('orders blocks by column, then top, then track', () => {
    const result = layout({ events: [
      between('2026-10-29', '08:00', '09:00', 'Thu'),
      between(WED, '12:00', '13:00', 'Wed late'),
      between(WED, '08:00', '09:00', 'Wed early'),
    ] })

    expect(titles(result.blocks)).toEqual(['Wed early', 'Wed late', 'Thu'])
  })
})

describe('limiting the tracks', () => {
  const track = (result: WeekLayout) => result.blocks.map(block => [block.event.display_title, block.track, block.tracks])
  const chips = (result: WeekLayout) => result.overflow.map(chip => [chip.column, chip.top, chip.count, titles(chip)])
  const titles = (chip: { events: CalendarEvent[] }) => chip.events.map(event => event.display_title)

  it('is two for the portrait week', () => {
    expect(PORTRAIT_MAX_TRACKS).toBe(2)
  })

  it('leaves the layout as it was when no limit is given', () => {
    const result = layout({ events: [between(WED, '10:00', '11:00', 'A'), between(WED, '10:00', '11:00', 'B'), between(WED, '10:00', '11:00', 'C')] })

    expect(track(result)).toEqual([['A', 0, 3], ['B', 1, 3], ['C', 2, 3]])
    expect(result.overflow).toEqual([])
  })

  it('draws two of three overlapping blocks, two tracks wide, and counts the third in a chip at its start', () => {
    const result = layout({ maxTracks: 2, events: [
      between(WED, '10:00', '11:00', 'A', [], 1),
      between(WED, '10:00', '11:00', 'B', [], 2),
      between(WED, '10:30', '11:30', 'C', [], 3),
    ] })

    expect(track(result)).toEqual([['A', 0, 2], ['B', 1, 2]])
    expect(chips(result)).toEqual([[2, 3 * 60 + 30, 1, ['C']]])
  })

  it('makes one chip of two hidden blocks that start together', () => {
    const result = layout({ maxTracks: 2, events: [
      between(WED, '10:00', '12:00', 'A', [], 1),
      between(WED, '10:00', '12:00', 'B', [], 2),
      between(WED, '10:30', '11:00', 'C', [], 3),
      between(WED, '10:30', '11:30', 'D', [], 4),
    ] })

    expect(track(result)).toEqual([['A', 0, 2], ['B', 1, 2]])
    expect(chips(result)).toEqual([[2, 210, 2, ['C', 'D']]])
  })

  it('makes a chip for each start time when the hidden blocks start apart', () => {
    const result = layout({ maxTracks: 2, events: [
      between(WED, '10:00', '13:00', 'A', [], 1),
      between(WED, '10:00', '13:00', 'B', [], 2),
      between(WED, '11:00', '11:30', 'C', [], 3),
      between(WED, '12:00', '12:30', 'D', [], 4),
    ] })

    expect(chips(result)).toEqual([[2, 240, 1, ['C']], [2, 300, 1, ['D']]])
  })

  it('does not touch a group that stays within the limit', () => {
    const result = layout({ maxTracks: 2, events: [
      between(WED, '09:00', '10:00', 'A'),
      between(WED, '09:00', '10:00', 'B'),
      between(WED, '09:00', '10:00', 'C'),
      between(WED, '12:00', '13:00', 'D'),
      between(WED, '12:30', '13:30', 'E'),
    ] })

    // The first group is cut to two tracks; the second has two and is as it was.
    expect(track(result)).toEqual([['A', 0, 2], ['B', 1, 2], ['D', 0, 2], ['E', 1, 2]])
    expect(chips(result)).toEqual([[2, 120, 1, ['C']]])
  })

  it('keeps a lone block whole in a column with a crowd in another', () => {
    const result = layout({ maxTracks: 2, events: [
      between(WED, '10:00', '11:00', 'A'),
      between(WED, '10:00', '11:00', 'B'),
      between(WED, '10:00', '11:00', 'C'),
      between('2026-10-29', '10:00', '11:00', 'D'),
    ] })

    expect(track(result)).toEqual([['A', 0, 2], ['B', 1, 2], ['D', 0, 1]])
    expect(result.overflow.map(chip => chip.column)).toEqual([2])
  })

  it('draws one block at a time with a limit of one', () => {
    const result = layout({ maxTracks: 1, events: [between(WED, '10:00', '11:00', 'A'), between(WED, '10:30', '11:30', 'B'), between(WED, '11:00', '12:00', 'C')] })

    // C starts as A ends, so it is on A's track again; only B is beside something.
    expect(track(result)).toEqual([['A', 0, 1], ['C', 0, 1]])
    expect(chips(result)).toEqual([[2, 210, 1, ['B']]])
  })

  it('counts where a block starts after it is cut to the range, and sorts the chips by column then top', () => {
    const result = layout({ maxTracks: 1, events: [
      between('2026-10-29', '07:30', '08:30', 'Thu A', [], 1),
      between('2026-10-29', '07:45', '08:45', 'Thu B', [], 2),
      timed('2026-10-27T05:00:00Z', '2026-10-27T09:00:00Z', 'Tue A', [], 3),
      timed('2026-10-27T06:00:00Z', '2026-10-27T09:00:00Z', 'Tue B', [], 4),
      timed('2026-10-27T06:30:00Z', '2026-10-27T09:00:00Z', 'Tue C', [], 5),
    ] })

    // All three Tuesday events start before the 07:00 range, so they are cut to its top: B and C are hidden there, as one chip.
    expect(chips(result)).toEqual([[1, 0, 2, ['Tue B', 'Tue C']], [3, 45, 1, ['Thu B']]])
    expect(result.blocks.find(block => block.event.display_title === 'Tue A')!.clippedStart).toBe(true)
  })
})

describe('placing a block', () => {
  it('measures from the top of the range, in minutes', () => {
    const result = layout({ events: [between(WED, '09:30', '11:00', 'A')] })

    expect(result.blocks[0]).toMatchObject({ column: 2, top: 150, height: 90, time: '09:30', range: '09:30–11:00', clippedStart: false, clippedEnd: false })
  })

  it('draws a short event at least half an hour long', () => {
    const result = layout({ events: [between(WED, '09:00', '09:10', 'A')] })

    expect(result.blocks[0]).toMatchObject({ top: 120, height: 30 })
    expect(result.blocks[0]!.range).toBe('09:00–09:10')
  })

  it('draws an event with no length half an hour long', () => {
    const result = layout({ events: [between(WED, '09:00', '09:00', 'A')] })

    expect(result.blocks[0]).toMatchObject({ top: 120, height: 30, range: '09:00–09:00' })
  })

  it('ends an event at midnight at the bottom of the day', () => {
    const result = layout({ hours: { from: 0, to: 24 }, events: [between(WED, '22:00', '23:59', 'Late'), timed('2026-10-28T22:00:00Z', '2026-10-29T00:00:00Z', 'To midnight')] })

    expect(blockOf(result, 'To midnight')).toMatchObject({ top: 22 * 60, height: 120 })
  })

  it('reads the people and colour', () => {
    const result = layout({ events: [between(WED, '09:00', '10:00', 'A', ['mum', 'dad'])] })

    expect(result.blocks[0]!.people.map(p => p.id)).toEqual(['mum', 'dad'])
    expect(result.blocks[0]!.colour).toBe(person('mum').colour)
    expect(result.blocks[0]!.initials).toEqual([person('mum').initial, person('dad').initial])
  })

  it('leaves out a timed event on a day outside the week', () => {
    const result = layout({ events: [between('2026-10-25', '09:00', '10:00', 'Sunday before'), between('2026-11-02', '09:00', '10:00', 'Monday after')] })

    expect(result.blocks).toEqual([])
    expect(result.early!.items.flat()).toEqual([])
  })
})

describe('collapsed hours', () => {
  it('puts an event wholly before the range in the early band of its column', () => {
    const result = layout({ events: [between(WED, '06:00', '06:45', 'Early')] })

    expect(result.blocks).toEqual([])
    expect(result.early!.label).toBe('00–07')
    expect(titles(result.early!.items[2]!)).toEqual(['Early'])
    expect(result.early!.items[2]![0]).toMatchObject({ time: '06:00', past: true })
    expect(result.early!.items[1]).toEqual([])
  })

  it('puts an event wholly after the range in the late band', () => {
    const result = layout({ events: [between(WED, '22:30', '23:00', 'Late')] })

    expect(result.blocks).toEqual([])
    expect(result.late!.label).toBe('21–24')
    expect(titles(result.late!.items[2]!)).toEqual(['Late'])
    expect(result.late!.items[2]![0]).toMatchObject({ time: '22:30', past: false })
  })

  it('puts an event starting at the end of the range in the late band, and one ending at the start of the range in the early band', () => {
    const result = layout({ events: [between(WED, '21:00', '22:00', 'Late'), between(WED, '06:00', '07:00', 'Early')] })

    expect(titles(result.late!.items[2]!)).toEqual(['Late'])
    expect(titles(result.early!.items[2]!)).toEqual(['Early'])
  })

  it('orders a band by start time', () => {
    const result = layout({ events: [between(WED, '05:30', '06:00', 'Second'), between(WED, '05:00', '05:30', 'First'), between(WED, '06:30', '06:45', 'Third')] })

    expect(titles(result.early!.items[2]!)).toEqual(['First', 'Second', 'Third'])
  })

  it('cuts an event that starts before the range to the top', () => {
    const result = layout({ events: [between(WED, '06:30', '08:00', 'A')] })

    expect(result.blocks[0]).toMatchObject({ top: 0, height: 60, time: '06:30', range: '06:30–08:00', clippedStart: true, clippedEnd: false })
  })

  it('cuts an event that ends after the range to the bottom', () => {
    const result = layout({ events: [between(WED, '20:30', '23:00', 'A')] })

    expect(result.blocks[0]).toMatchObject({ top: 13.5 * 60, height: 30, time: '20:30', clippedStart: false, clippedEnd: true })
    expect(result.blocks[0]!.top + result.blocks[0]!.height).toBe(result.rangeMinutes)
  })

  it('keeps a block inside the range even when a short event sits at the very end', () => {
    const result = layout({ events: [between(WED, '20:50', '21:00', 'A')] })

    expect(result.blocks[0]).toMatchObject({ top: 13 * 60 + 50, height: 10, clippedEnd: false })
  })

  it('keeps an event with no length at the first minute of the range', () => {
    const result = layout({ events: [between(WED, '07:00', '07:00', 'A')] })

    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]).toMatchObject({ top: 0 })
  })

  it('has no bands, and a 24 hour scale, for the whole day', () => {
    const result = layout({ hours: { from: 0, to: 24 }, events: [between(WED, '00:00', '01:00', 'A'), between(WED, '23:00', '23:30', 'B')] })

    expect(result.early).toBeNull()
    expect(result.late).toBeNull()
    expect(result.rangeMinutes).toBe(1440)
    expect(result.hours).toHaveLength(24)
    expect(result.blocks.map(block => block.top)).toEqual([0, 23 * 60])
  })

  it('has only the band that exists', () => {
    expect(layout({ hours: { from: 0, to: 21 } }).early).toBeNull()
    expect(layout({ hours: { from: 0, to: 21 } }).late!.label).toBe('21–24')
    expect(layout({ hours: { from: 7, to: 24 } }).early!.label).toBe('00–07')
    expect(layout({ hours: { from: 7, to: 24 } }).late).toBeNull()
  })

  it('pads the band labels to two digits', () => {
    const result = layout({ hours: { from: 9, to: 18 } })

    expect([result.early!.label, result.late!.label]).toEqual(['00–09', '18–24'])
  })
})

describe('the all-day strip', () => {
  it('draws an all-day event as a one-column bar', () => {
    const result = layout({ events: [allDay('2026-10-29', '2026-10-30', 'Bins', ['mum'])] })

    expect(shape(result.allDay.bars[0]!)).toEqual({ lane: 0, column: 3, span: 1, roundStart: true, roundEnd: true })
    expect(result.allDay.bars[0]!.colour).toBe(person('mum').colour)
    expect(result.allDay.lanes).toBe(1)
  })

  it('squares the start of a bar that carries in from the week before', () => {
    const result = layout({ events: [allDay('2026-10-22', '2026-10-28', 'Trip')] })

    expect(shape(result.allDay.bars[0]!)).toEqual({ lane: 0, column: 0, span: 2, roundStart: false, roundEnd: true })
  })

  it('squares the end of a bar that carries on into the week after', () => {
    const result = layout({ events: [allDay('2026-10-30', '2026-11-05', 'Trip')] })

    expect(shape(result.allDay.bars[0]!)).toEqual({ lane: 0, column: 4, span: 3, roundStart: true, roundEnd: false })
  })

  it('squares both ends of a bar that covers the whole week', () => {
    const result = layout({ events: [allDay('2026-10-20', '2026-11-20', 'Away')] })

    expect(shape(result.allDay.bars[0]!)).toEqual({ lane: 0, column: 0, span: 7, roundStart: false, roundEnd: false })
  })

  it('leaves out an event in another week', () => {
    const result = layout({ events: [allDay('2026-11-02', '2026-11-03', 'Next week'), allDay('2026-10-25', '2026-10-26', 'Last week')] })

    expect(result.allDay).toEqual({ bars: [], more: [], lanes: 0 })
  })

  it('draws an overnight timed event as a bar, not a block', () => {
    const result = layout({ events: [timed('2026-10-30T22:00:00Z', '2026-10-31T09:00:00Z', 'Sleepover')] })

    expect(result.blocks).toEqual([])
    expect(shape(result.allDay.bars[0]!)).toEqual({ lane: 0, column: 4, span: 2, roundStart: true, roundEnd: true })
  })

  it('packs bars into lanes, longest first, and counts the lanes used', () => {
    const result = layout({ events: [
      allDay('2026-10-28', '2026-10-29', 'Short', [], 3),
      allDay('2026-10-28', '2026-10-31', 'Long', [], 2),
      allDay('2026-10-30', '2026-10-31', 'Later', [], 1),
    ] })

    expect(barsOf(result, 'Long').map(shape)).toEqual([{ lane: 0, column: 2, span: 3, roundStart: true, roundEnd: true }])
    expect(barsOf(result, 'Short').map(shape)).toEqual([{ lane: 1, column: 2, span: 1, roundStart: true, roundEnd: true }])
    expect(barsOf(result, 'Later').map(shape)).toEqual([{ lane: 1, column: 4, span: 1, roundStart: true, roundEnd: true }])
    expect(result.allDay.lanes).toBe(2)
    expect(result.allDay.more).toEqual([])
  })

  it('shows all three lanes when three bars share a day', () => {
    const result = layout({ events: [allDay(WED, '2026-10-29', 'A'), allDay(WED, '2026-10-29', 'B'), allDay(WED, '2026-10-29', 'C')] })

    expect(result.allDay.bars.map(bar => bar.lane)).toEqual([0, 1, 2])
    expect(result.allDay.more).toEqual([])
    expect(result.allDay.lanes).toBe(3)
  })

  it('gives the last lane to "+N more" when a day has four, and splits a bar around it', () => {
    const result = layout({ events: [
      allDay('2026-10-27', '2026-10-30', 'Wide', [], 1),
      allDay('2026-10-27', '2026-10-30', 'Wide 2', [], 2),
      allDay('2026-10-27', '2026-10-30', 'Wide 3', [], 3),
      allDay(WED, '2026-10-29', 'Fourth', [], 4),
    ] })

    expect(result.allDay.more).toEqual([{ column: 2, lane: 2, count: 2 }])
    // The third wide bar would cross the hidden cell on Wednesday: it is cut into a piece either side, both square where cut.
    expect(barsOf(result, 'Wide 3').map(shape)).toEqual([
      { lane: 2, column: 1, span: 1, roundStart: true, roundEnd: false },
      { lane: 2, column: 3, span: 1, roundStart: false, roundEnd: true },
    ])
    expect(result.allDay.lanes).toBe(3)
  })
})

describe('days with a clock change', () => {
  it('lines up 09:00 to 10:00 on Sunday 25 Oct 2026, the day the clocks went back', () => {
    // 09:00 GMT, an hour after the change; the day is 25 hours long.
    const result = layout({ weekOf: '2026-10-25', events: [between('2026-10-25', '09:00', '10:00', 'A')] })
    const block = result.blocks[0]!

    expect(result.days[0]!.date).toBe('2026-10-19')
    expect(block).toMatchObject({ column: 6, top: 2 * 60, height: 60, time: '09:00', range: '09:00–10:00' })
  })

  it('lines up an event that straddles the change by its wall clock', () => {
    // 00:30 BST to 01:30 GMT is two hours by the clock on the wall of London's instants, but 01:30 wall minus 00:30 wall is one.
    const result = layout({ weekOf: '2026-10-25', hours: { from: 0, to: 24 }, events: [timed('2026-10-24T23:30:00Z', '2026-10-25T01:30:00Z', 'A')] })

    expect(result.blocks[0]).toMatchObject({ column: 6, top: 30, height: 60 })
  })

  it('lines up 09:00 to 10:00 on Sunday 29 March 2026, the day the clocks went forward', () => {
    // 09:00 BST is 08:00 UTC.
    const result = layout({ weekOf: '2026-03-29', events: [timed('2026-03-29T08:00:00Z', '2026-03-29T09:00:00Z', 'A')] })

    expect(result.days[6]!.date).toBe('2026-03-29')
    expect(result.blocks[0]).toMatchObject({ column: 6, top: 2 * 60, height: 60, time: '09:00', range: '09:00–10:00' })
  })
})

describe('the now line', () => {
  it('sits in today\'s column, in minutes from the top of the range', () => {
    // 09:41 is 2 hours 41 minutes after 07:00.
    expect(layout().now).toEqual({ column: 2, position: 161, time: '09:41' })
  })

  it('is early before the range and late after it', () => {
    expect(layout({ now: new Date('2026-10-28T06:59:00Z') }).now).toMatchObject({ position: 'early', time: '06:59' })
    expect(layout({ now: new Date('2026-10-28T07:00:00Z') }).now).toMatchObject({ position: 0 })
    expect(layout({ now: new Date('2026-10-28T20:59:00Z') }).now).toMatchObject({ position: 13 * 60 + 59 })
    expect(layout({ now: new Date('2026-10-28T21:00:00Z') }).now).toMatchObject({ position: 'late' })
  })

  it('is a position even at midnight, when the whole day is drawn', () => {
    expect(layout({ now: new Date('2026-10-28T00:00:00Z'), hours: { from: 0, to: 24 } }).now).toMatchObject({ position: 0 })
  })

  it('is null when today is in another week', () => {
    expect(layout({ weekOf: '2026-11-04' }).now).toBeNull()
    expect(layout({ weekOf: '2026-10-21' }).now).toBeNull()
  })

  it('moves to the Sunday column on a Sunday, whichever way the week starts', () => {
    const sunday = new Date('2026-11-01T12:00:00Z')

    expect(layout({ now: sunday, weekOf: '2026-11-01' }).now!.column).toBe(6)
    expect(layout({ now: sunday, weekOf: '2026-11-01', weekStart: 'sunday' }).now!.column).toBe(0)
  })

  it('reads the wall clock in the display zone', () => {
    // 10:41 BST in summer is 09:41 UTC.
    const result = layout({ now: new Date('2026-07-15T09:41:00Z'), weekOf: '2026-07-15' })

    expect(result.now).toEqual({ column: 2, position: 221, time: '10:41' })
  })
})

describe('past and ongoing', () => {
  const result = layout({ events: [
    between(WED, '08:00', '09:00', 'Over'),
    between(WED, '09:00', '10:00', 'On'),
    between(WED, '09:41', '10:00', 'Just starting'),
    between(WED, '09:00', '09:41', 'Just ended'),
    between(WED, '11:00', '12:00', 'Later'),
    between(WED, '06:00', '06:30', 'Early'),
    between(WED, '22:00', '22:30', 'Late'),
  ] })

  it('marks blocks that ended at or before now as past, and ones that have started and not ended as ongoing', () => {
    const flags = (title: string) => ({ past: blockOf(result, title).past, ongoing: blockOf(result, title).ongoing })

    expect(flags('Over')).toEqual({ past: true, ongoing: false })
    expect(flags('On')).toEqual({ past: false, ongoing: true })
    expect(flags('Just starting')).toEqual({ past: false, ongoing: true })
    expect(flags('Just ended')).toEqual({ past: true, ongoing: false })
    expect(flags('Later')).toEqual({ past: false, ongoing: false })
  })

  it('marks band items past by the same rule', () => {
    expect(result.early!.items[2]![0]!.past).toBe(true)
    expect(result.late!.items[2]![0]!.past).toBe(false)
  })

  it('has blocks in other weeks that are all past or all to come', () => {
    const other = layout({ weekOf: '2026-11-04', events: [between('2026-11-04', '09:00', '10:00', 'A')] })
    const before = layout({ weekOf: '2026-10-21', events: [between('2026-10-21', '09:00', '10:00', 'B')] })

    expect(other.blocks[0]).toMatchObject({ past: false, ongoing: false })
    expect(before.blocks[0]).toMatchObject({ past: true, ongoing: false })
  })
})
