import type { DayParts, MonthKey, NextAlarm, NightText, View, WeatherOnDates, WeatherOnDatesView, WeekHours } from '../../shared/display'
import type { CustomLayout, DayGrid, ResolvedPaneOptions, StarGrid } from '../../shared/layouts'
import type { SpecialDaysResolution, Takeover } from '../../shared/special-days'
import type { StarChart } from '../../shared/stars'
import type { CalendarEvent } from '../../shared/types/events'
import type { WeatherSnapshot } from '../../shared/weather'
import type { Corner } from './burnIn'
import { stageSize } from './stage'
import type { StageOrientation } from './stage'

// What every view component is given by pages/display.vue. They all declare
// `defineProps<ViewProps>()`, even when they ignore some of it, so a prop a
// view doesn't use is still a prop and never falls through to its root element
// as an HTML attribute. Pure: no Nuxt or Vue imports.
//
// Import it by a relative path in a view. `defineProps` needs the compiler to
// read the type itself, and it can only follow `~/` once Nuxt has written
// .nuxt/tsconfig, which a clean build (the Docker image) may not have done yet.

/** The views a special day's takeover changes. The photo frame and night views never do (architecture §6.3). */
export const CALENDAR_VIEWS = ['month', 'week', 'week_parts', 'week_photo', 'agenda'] as const satisfies readonly View[]

export const isCalendarView = (view: View): boolean => (CALENDAR_VIEWS as readonly View[]).includes(view)

/** The views with a portrait layout: all of them since PR 5.13 and the hybrid since PR 5.14 (the week by part of day has the week's stacked head and taller rows, not a layout of its own). A view added later without one is drawn on the landscape stage, letterboxed in a portrait window, until it has its own. */
export const PORTRAIT_VIEWS: readonly View[] = ['night', 'agenda', 'photo', 'month', 'week', 'week_parts', 'week_photo', 'custom']

export const hasPortraitLayout = (view: View): boolean => PORTRAIT_VIEWS.includes(view)

/** A box a view draws into: the stage itself, or a pane of it. `orientation` is the layout the box asks for, which for a pane is its own shape and not always the stage's. */
export interface Stage {
  width: number
  height: number
  orientation: StageOrientation
}

/** The stage for `view` on a device that wants `device`: portrait only when the view has a layout for it, and the landscape stage otherwise. */
export function stageFor(view: View, device: StageOrientation): Stage {
  const orientation = device === 'portrait' && hasPortraitLayout(view) ? 'portrait' : 'landscape'
  return { ...stageSize(orientation), orientation }
}

/** The height of the photo pane on the portrait stage, above the week (px). */
export const PORTRAIT_PHOTO_PANE_HEIGHT = 1000
/** The width of the photo pane on the landscape stage, left of the week (px). */
export const LANDSCAPE_PHOTO_PANE_WIDTH = 1100

/**
 * The two boxes of the week and photo view (PR 5.14, architecture §4.6): the
 * photo on top of the week on the portrait stage, and to its left on the
 * landscape one. Each is a `Stage` for the view that fills it. The photo pane's
 * orientation follows its shape, so the portrait stage (a wide pane) asks the
 * server for the landscape rendition and the landscape stage (a tall one) for
 * the portrait rendition. The week pane is always the narrow seven-column
 * layout, so it asks for `portrait` on both.
 */
export function weekPhotoPanes(stage: Stage): { photo: Stage, week: Stage } {
  const photo = stage.orientation === 'portrait'
    ? { width: stage.width, height: PORTRAIT_PHOTO_PANE_HEIGHT }
    : { width: LANDSCAPE_PHOTO_PANE_WIDTH, height: stage.height }
  const week = stage.orientation === 'portrait'
    ? { width: stage.width, height: stage.height - photo.height }
    : { width: stage.width - photo.width, height: stage.height }
  return {
    photo: { ...photo, orientation: photo.height > photo.width ? 'portrait' : 'landscape' },
    week: { ...week, orientation: 'portrait' },
  }
}

export interface ViewProps {
  /** The view being shown. */
  view: View
  /** The box the view draws into: the whole stage for an ordinary view, or one pane of it for a hybrid (`weekPhotoPanes`). */
  stage: Stage
  /** Drawn as a pane of a hybrid view (PR 5.14): the photo frame is a compact pill with no next event, the week has the short title. */
  pane?: boolean
  /** The custom view only: the layout to draw, or null when there is none (not chosen, deleted, or not heard yet). */
  layout?: CustomLayout | null
  /** The day grid pane only: its rows, columns and first tile, from the layout's `days` pane. */
  dayGrid?: DayGrid
  /** The star chart pane only: its rows and columns of person cards, from the layout's `stars` pane. */
  starGrid?: StarGrid
  /** The star chart pane only: the people with a chart and their counts, or null for none (nobody has one, or not heard yet). */
  stars?: StarChart | null
  /** A pane of a custom layout only: how the layout asks this pane to look (hidden title, sidebar or hour labels, filled events, wrapping titles, the photo frame's overlays and their corners). Undefined means `DEFAULT_PANE_OPTIONS`, which is what every full-screen view and the week and photo view use. */
  paneOptions?: ResolvedPaneOptions
  /** The events fetched for the shown month and the next few days, sorted by start. */
  events: CalendarEvent[]
  /** The current moment, ticking. Views work out "today" from it in `timezone`. */
  now: Date
  /** The display's IANA time zone. */
  timezone: string
  /** The month the month view shows: the one the server pinned in `state.month`, or else the current month. Not necessarily the month `now` is in. */
  month: MonthKey
  /** A date in the week the week view shows, `YYYY-MM-DD`: the week the server pinned in `state.week`, else today; the previewed date while a preview runs. */
  weekOf: string
  /** The hours the week view draws in full (the display's `week_hours`); the rest are folded into a thin band at each end. */
  weekHours: WeekHours
  /** Where the week by part of day splits the day (the display's `day_parts`): the whole hours at which the afternoon and the evening begin. */
  dayParts: DayParts
  /** The current conditions and the daily forecast, or null for none (no weather set up, or not heard yet). A view draws no weather at all then. */
  weather: WeatherSnapshot | null
  /** Which full-screen views draw the forecast next to their dates (the display's `weather_on_dates`). All of them when left out. A pane of a custom layout goes by its own `paneOptions.weather_on_dates` instead (`showsWeatherOnDates`). */
  weatherOnDates?: WeatherOnDates
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
  /** The photo frame only: whether the overlay banner is showing at the bottom centre, so an overlay set to a bottom corner takes the top one on its side. Not showing when left out. */
  overlayShowing?: boolean
  /** The photo frame only: whether its slow pan and zoom runs now (the display's `motion`, and the screen is on and not dimmed). Still when left out. */
  motion?: boolean
  /** The night view only: what it says under the clock. `none` when left out. */
  nightText?: NightText
  /** The night view only: the next alarm the server knows of, or null for none. Not heard yet is the same as none. */
  alarm?: NextAlarm
  /** The night view only: whether the clock drifts about the screen (the display's `burn_in`). Centred when left out. */
  burnIn?: boolean
}

/** For a view with nothing special on it: no decorated tiles and no takeover. */
export const NO_SPECIAL_DAYS: ViewProps['specialDays'] = Object.freeze({ tiles: [], takeover: null })

/**
 * Whether a view draws the forecast next to its dates. A pane of a custom
 * layout goes by its pane option; a full-screen view (and the week of the week
 * and photo view, as `week`) by the display's preference for `view`; on when
 * neither is given.
 */
export function showsWeatherOnDates(props: Pick<ViewProps, 'paneOptions' | 'weatherOnDates'>, view: WeatherOnDatesView): boolean {
  return props.paneOptions?.weather_on_dates ?? props.weatherOnDates?.[view] ?? true
}
