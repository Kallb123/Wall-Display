import type { CalendarEvent, EventPerson } from '../../../shared/types/events'

// Events with locations, for locations.spec.ts (issue 74). The days are those of
// the frozen clock's week (Wed 28 Oct 2026, 09:41; the clocks went back on the
// 25th, so London time is UTC). The locations are what feeds put in the field: a
// full address that must be cut to its first part, one with line breaks, a
// room, a link to a call (which must not show) and none at all.

const home: EventPerson = { id: 'home', name: 'Household', initial: 'H', colour: '#D9A93F' }
const mum: EventPerson = { id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139' }
const dad: EventPerson = { id: 'dad', name: 'Dad', initial: 'D', colour: '#7A8A5E' }
const isla: EventPerson = { id: 'isla', name: 'Isla', initial: 'I', colour: '#D27FA0' }
const theo: EventPerson = { id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4' }
const poppy: EventPerson = { id: 'poppy', name: 'Poppy', initial: 'P', colour: '#9A7BC4' }

let nextId = 1

/** A timed event on `day` (`YYYY-MM-DD`) from `from` to `to` (`HH:MM`), or an all-day one on `day` alone when both are left out. */
function event(title: string, day: string, from: string | null, to: string | null, location: string | null, people: EventPerson[]): CalendarEvent {
  const allDay = from === null || to === null
  const next = new Date(`${day}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return {
    id: nextId++,
    calendar_id: 'family',
    title,
    display_title: title,
    icon: null,
    location,
    start: allDay ? `${day}T00:00:00.000Z` : `${day}T${from}:00.000Z`,
    end: allDay ? next.toISOString() : `${day}T${to}:00.000Z`,
    all_day: allDay,
    start_date: allDay ? day : null,
    end_date: allDay ? next.toISOString().slice(0, 10) : null,
    people,
  }
}

const ADDRESS = 'Parkside Dental Practice, 12 High Street, Leicester, LE1 4AB'
const CALL = 'https://meet.example.com/abc-defg-hij'

/**
 * A quiet Wednesday and Thursday, every event with room to spare: a long
 * address, a place over three lines, a link (nothing to show), no location, and
 * an all-day event with a location. Long events for the week's blocks.
 */
export const ROOMY: CalendarEvent[] = [
  event('Half term at Nana\'s', '2026-10-28', null, null, 'Nana\'s house, 4 Mill Lane, Leicester, LE2 1AB', [home]),
  event('Dentist check-up', '2026-10-28', '10:30', '12:30', ADDRESS, [mum]),
  event('Lunch with Nana', '2026-10-28', '12:45', '14:45', 'The Old Mill Café\n4 Mill Lane\nLeicester', [mum, poppy]),
  event('Call with the school', '2026-10-28', '15:00', '17:00', CALL, [dad]),
  event('Swimming', '2026-10-28', '17:15', '19:15', 'Aqua Leisure Centre, Station Road, Leicester, LE3 9XY', [theo]),
  event('Bonfire at the park', '2026-10-28', '19:30', '21:00', null, [home]),
  event('School trip', '2026-10-29', '08:15', '11:15', 'Science Museum, Exhibition Road, London, SW7 2DD', [isla]),
  event('Team drinks', '2026-10-29', '19:00', '21:00', null, [dad]),
]

/**
 * A full week where nothing has room to spare: Wednesday and Thursday hold more
 * events than any list, cell or tile can show, each with a location, and short
 * events (half an hour, or one hour among neighbours) for the week's blocks.
 */
export const CROWDED: CalendarEvent[] = [
  event('Half term', '2026-10-28', null, null, null, [home]),
  event('Early run', '2026-10-28', '07:00', '07:45', 'Victoria Park, Granville Road, Leicester', [dad]),
  event('School run', '2026-10-28', '08:15', '08:45', 'Oakfield Primary, School Lane, Leicester, LE2 3QR', [mum, isla, theo]),
  event('Nursery drop-off', '2026-10-28', '08:45', '09:15', 'Little Acorns Nursery, 7 Park Road, Leicester', [poppy]),
  event('Team stand-up', '2026-10-28', '09:00', '10:00', CALL, [dad]),
  event('Rhyme time', '2026-10-28', '10:30', '11:30', 'Central Library, Bishop Street, Leicester, LE1 6AF', [poppy]),
  event('Dentist check-up', '2026-10-28', '11:30', '12:00', ADDRESS, [mum]),
  event('Lunch with Nana', '2026-10-28', '12:00', '13:30', 'The Old Mill Café, 4 Mill Lane, Leicester', [mum, poppy]),
  event('Piano lesson', '2026-10-28', '14:00', '14:30', 'Mrs Patel\'s house, 18 Elm Grove, Leicester', [theo]),
  event('Swimming', '2026-10-28', '15:30', '16:30', 'Aqua Leisure Centre, Station Road, Leicester, LE3 9XY', [theo]),
  event('Ballet', '2026-10-28', '16:00', '17:00', 'Studio 2, Dance Academy, Market Street, Leicester', [isla]),
  event('Football', '2026-10-28', '17:15', '18:15', 'Rec ground, Rutland Road, Leicester', [theo]),
  event('Dinner at the Hendersons', '2026-10-28', '18:30', '21:00', '22 Chestnut Avenue, Leicester, LE2 6PP', [mum, dad, theo]),
  event('Bath and bed', '2026-10-28', '19:30', '20:00', null, [poppy]),
  event('Dentist for Isla', '2026-10-29', '08:15', '09:15', ADDRESS, [isla]),
  event('Parents\' evening', '2026-10-29', '09:30', '10:30', 'Oakfield Primary, School Lane, Leicester', [mum]),
  event('Coffee with Jo', '2026-10-29', '10:30', '11:00', 'Bean There, High Street, Leicester', [mum]),
  event('Trampolining', '2026-10-29', '11:15', '12:15', 'Jump Arena, Unit 4, Retail Park, Leicester', [isla, theo]),
  event('Lunch at school', '2026-10-29', '12:30', '13:15', null, [theo]),
  event('Brownies', '2026-10-29', '17:00', '18:00', 'Scout Hut, Church Lane, Leicester', [isla]),
  event('Team drinks', '2026-10-29', '19:00', '21:00', 'The Fox and Hounds, 5 Bridge Street, Leicester', [dad]),
  event('Playgroup', '2026-10-30', '09:30', '11:00', 'Village Hall, The Green, Leicester', [poppy]),
  event('Halloween party', '2026-10-31', '14:00', '17:00', 'Isla\'s friend Maya, 9 Laurel Close, Leicester', [isla]),
  event('Trick or treating', '2026-10-31', '17:00', '19:00', 'Meet at the gate, Laurel Close', [home]),
]

/** CROWDED with one more event on Friday, so that the month's side panel, which lists the next days, has no room left over for a location. */
export const PACKED: CalendarEvent[] = [
  ...CROWDED,
  event('Parkrun', '2026-10-30', '08:00', '09:00', 'Victoria Park, Granville Road, Leicester', [dad, theo]),
]

/** The same events with their locations left out, to see what the views draw without them. */
export const withoutLocations = (events: CalendarEvent[]): CalendarEvent[] => events.map(item => ({ ...item, location: null }))
