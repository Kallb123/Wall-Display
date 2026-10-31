import type { MonthKey, NextAlarm, NightText, View } from '../../shared/display'
import type { SpecialDaysResolution, Takeover } from '../../shared/special-days'
import type { CalendarEvent } from '../../shared/types/events'
import type { WeatherSnapshot } from '../../shared/weather'
import type { Corner } from './burnIn'

// What every view component is given by pages/display.vue. They all declare
// `defineProps<ViewProps>()`, even when they ignore some of it, so a prop a
// view doesn't use is still a prop and never falls through to its root element
// as an HTML attribute. Pure: no Nuxt or Vue imports.
//
// Import it by a relative path in a view. `defineProps` needs the compiler to
// read the type itself, and it can only follow `~/` once Nuxt has written
// .nuxt/tsconfig, which a clean build (the Docker image) may not have done yet.

/** The views a special day's takeover changes. The photo frame and night views never do (architecture §6.3). */
export const CALENDAR_VIEWS = ['month', 'week', 'agenda'] as const satisfies readonly View[]

export const isCalendarView = (view: View): boolean => (CALENDAR_VIEWS as readonly View[]).includes(view)

export interface ViewProps {
  /** The view being shown. */
  view: View
  /** The events fetched for the shown month and the next few days, sorted by start. */
  events: CalendarEvent[]
  /** The current moment, ticking. Views work out "today" from it in `timezone`. */
  now: Date
  /** The display's IANA time zone. */
  timezone: string
  /** The month the month view shows: the one the server pinned in `state.month`, or else the current month. Not necessarily the month `now` is in. */
  month: MonthKey
  /** The current conditions and the daily forecast, or null for none (no weather set up, or not heard yet). A view draws no weather at all then. */
  weather: WeatherSnapshot | null
  /** The day a week starts on, for the month grid. */
  weekStart: 'monday' | 'sunday'
  /**
   * What the page has decided about special days (architecture §6): the
   * decorated tiles, and the takeover only while it is in force, which the page
   * works out (it is for today, on a calendar view, or a preview). A view draws
   * these and never decides anything. The colours of a takeover's palette are
   * not here: the stage already applies them as the theme.
   */
  specialDays: {
    tiles: SpecialDaysResolution['tiles']
    takeover: Takeover | null
  }
  /** The photo frame only: the display's id, to ask the server for its photos. Null until it is known. */
  displayId?: string | null
  /** The photo frame only: how many `photo.next` messages the socket has heard. A rise means "fetch the next photo". */
  photoNext?: number
  /** The photo frame only: how many times the socket has opened. A rise with nothing on show means "try again". */
  socketOpens?: number
  /** The photo frame only: the corner its pill is in, which the page moves round so no corner is lit for ever (PR 5.3). `top-left` when left out. */
  photoCorner?: Corner
  /** The night view only: what it says under the clock. `none` when left out. */
  nightText?: NightText
  /** The night view only: the next alarm the server knows of, or null for none. Not heard yet is the same as none. */
  alarm?: NextAlarm
  /** The night view only: whether the clock drifts about the screen (the display's `burn_in`). Centred when left out. */
  burnIn?: boolean
}

/** For a view with nothing special on it: no decorated tiles and no takeover. */
export const NO_SPECIAL_DAYS: ViewProps['specialDays'] = Object.freeze({ tiles: [], takeover: null })
