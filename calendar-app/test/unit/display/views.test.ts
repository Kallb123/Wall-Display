import { describe, expect, it } from 'vitest'
import { DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import { hasPortraitLayout, LANDSCAPE_PHOTO_PANE_WIDTH, PORTRAIT_PHOTO_PANE_HEIGHT, PORTRAIT_VIEWS, showsLocations, showsWeatherOnDates, stageFor, weekPhotoPanes } from '../../../app/utils/views'

describe('the views with a portrait layout', () => {
  it('are all of them: the night, agenda, photo, month, week, week by part of day and week and photo views', () => {
    expect([...PORTRAIT_VIEWS].sort()).toEqual(['agenda', 'custom', 'month', 'night', 'photo', 'week', 'week_parts', 'week_photo'])
    expect(hasPortraitLayout('week')).toBe(true)
    expect(hasPortraitLayout('week_parts')).toBe(true)
    expect(hasPortraitLayout('week_photo')).toBe(true)
  })

  it('give a portrait device the portrait stage, and a landscape one the landscape stage', () => {
    expect(stageFor('agenda', 'portrait')).toEqual({ width: 1440, height: 2560, orientation: 'portrait' })
    expect(stageFor('photo', 'portrait').orientation).toBe('portrait')
    expect(stageFor('week', 'portrait')).toEqual({ width: 1440, height: 2560, orientation: 'portrait' })
    expect(stageFor('week', 'landscape')).toEqual({ width: 2560, height: 1440, orientation: 'landscape' })
    expect(stageFor('agenda', 'landscape').orientation).toBe('landscape')
  })
})

describe('the panes of the week and photo view', () => {
  it('put the photo above the week on the portrait stage, and ask for the landscape rendition', () => {
    const panes = weekPhotoPanes(stageFor('week_photo', 'portrait'))

    expect(PORTRAIT_PHOTO_PANE_HEIGHT).toBe(1000)
    expect(panes.photo).toEqual({ width: 1440, height: 1000, orientation: 'landscape' })
    expect(panes.week).toEqual({ width: 1440, height: 1560, orientation: 'portrait' })
  })

  it('put the photo left of the week on the landscape stage, and ask for the portrait rendition', () => {
    const panes = weekPhotoPanes(stageFor('week_photo', 'landscape'))

    expect(LANDSCAPE_PHOTO_PANE_WIDTH).toBe(1100)
    expect(panes.photo).toEqual({ width: 1100, height: 1440, orientation: 'portrait' })
    expect(panes.week).toEqual({ width: 1460, height: 1440, orientation: 'portrait' })
  })

  it('fill the stage between them', () => {
    for (const device of ['portrait', 'landscape'] as const) {
      const stage = stageFor('week_photo', device)
      const { photo, week } = weekPhotoPanes(stage)
      expect(photo.width * photo.height + week.width * week.height).toBe(stage.width * stage.height)
    }
  })
})

describe('showsWeatherOnDates', () => {
  const all = { month: true, week: true, week_parts: true, agenda: true }

  it('is on when neither the preference nor a pane option says otherwise', () => {
    expect(showsWeatherOnDates({}, 'month')).toBe(true)
    expect(showsWeatherOnDates({ weatherOnDates: all }, 'agenda')).toBe(true)
  })

  it('goes by the display preference for the view asked about', () => {
    const weatherOnDates = { ...all, week: false }
    expect(showsWeatherOnDates({ weatherOnDates }, 'week')).toBe(false)
    expect(showsWeatherOnDates({ weatherOnDates }, 'month')).toBe(true)
  })

  it('lets a pane option win over the preference, either way', () => {
    const paneOptions = { ...DEFAULT_PANE_OPTIONS, weather_on_dates: false }
    expect(showsWeatherOnDates({ paneOptions, weatherOnDates: all }, 'month')).toBe(false)
    expect(showsWeatherOnDates({ paneOptions: { ...DEFAULT_PANE_OPTIONS, weather_on_dates: true }, weatherOnDates: { ...all, month: false } }, 'month')).toBe(true)
  })
})

describe('showsLocations', () => {
  it('is on when nothing is given', () => {
    expect(showsLocations({})).toBe(true)
  })

  it('goes by the display preference', () => {
    expect(showsLocations({ showLocations: false })).toBe(false)
    expect(showsLocations({ showLocations: true })).toBe(true)
  })

  it('lets a pane option win over the preference, either way', () => {
    expect(showsLocations({ paneOptions: { ...DEFAULT_PANE_OPTIONS, show_locations: false }, showLocations: true })).toBe(false)
    expect(showsLocations({ paneOptions: { ...DEFAULT_PANE_OPTIONS, show_locations: true }, showLocations: false })).toBe(true)
  })
})
