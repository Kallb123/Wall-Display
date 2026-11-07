import { describe, expect, it } from 'vitest'
import { hasPortraitLayout, LANDSCAPE_PHOTO_PANE_WIDTH, PORTRAIT_PHOTO_PANE_HEIGHT, PORTRAIT_VIEWS, stageFor, weekPhotoPanes } from '../../../app/utils/views'

describe('the views with a portrait layout', () => {
  it('are all of them: the night, agenda, photo, month, week, week by part of day and week and photo views', () => {
    expect([...PORTRAIT_VIEWS].sort()).toEqual(['agenda', 'month', 'night', 'photo', 'week', 'week_parts', 'week_photo'])
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
