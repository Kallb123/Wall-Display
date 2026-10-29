import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfig } from '../../server/config/load'
import { expandIcs } from '../../server/sources/ics/expand'
import { syncWindow } from '../../server/sources/time'
import { createPeopleResolver } from '../../shared/people'
import type { CalendarEvent, EventPerson } from '../../shared/types/events'

// The ICS fixtures in test/fixtures/ics as the API returns them: expanded around
// a day, with their people and display titles resolved by the config's rules.
// Shared by the unit tests (vitest) and the visual ones (Playwright), so both
// draw the same family and the same Wednesday 28 October 2026. Node only.

const APP_DIR = join(import.meta.dirname, '../..')

export interface FixtureEventsOptions {
  /** The config whose people and calendars are used. Relative paths are from the app folder. Defaults to `config.dev.yaml`. */
  configFile?: string
  /** `YYYY-MM-DD`: the window is a year either side of it. Defaults to the day the mocks are set on. */
  today?: string
}

/** Wed 28 Oct 2026, the day the fixtures were written around (the clocks went back on the 25th). */
export const FIXTURE_TODAY = '2026-10-28'

/** The fixtures' events, one calendar after another, numbered from 1. Each calendar's file is `test/fixtures/ics/<calendar id>.ics`. */
export function fixtureEvents({ configFile = 'config.dev.yaml', today = FIXTURE_TODAY }: FixtureEventsOptions = {}): CalendarEvent[] {
  const config = loadConfig({ configFile: resolve(APP_DIR, configFile), env: {} })
  const window = syncWindow(new Date(`${today}T12:00:00Z`), config.timezone, 12, 12)
  const person = (id: string): EventPerson => {
    const found = config.people.find(candidate => candidate.id === id)!
    return { id: found.id, name: found.name, initial: found.initial, colour: found.colour }
  }

  let id = 1
  return config.calendars.flatMap((calendar) => {
    const resolveEvent = createPeopleResolver(calendar, config.people)
    const { events } = expandIcs(readFileSync(join(APP_DIR, 'test/fixtures/ics', `${calendar.id}.ics`), 'utf8'), window, { timeZone: config.timezone })
    return events.map((event): CalendarEvent => {
      const resolved = resolveEvent(event)
      return {
        id: id++,
        calendar_id: calendar.id,
        title: event.title,
        display_title: resolved.displayTitle,
        location: event.location,
        start: event.startAt.toISOString(),
        end: event.endAt.toISOString(),
        all_day: event.allDay,
        start_date: event.startDate,
        end_date: event.endDate,
        people: resolved.personIds.map(person),
      }
    })
  })
}
