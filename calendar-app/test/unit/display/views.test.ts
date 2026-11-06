import { describe, expect, it } from 'vitest'
import { hasPortraitLayout, PORTRAIT_VIEWS, stageFor } from '../../../app/utils/views'

describe('the views with a portrait layout', () => {
  it('are all of them: the night, agenda, photo, month and week views', () => {
    expect([...PORTRAIT_VIEWS].sort()).toEqual(['agenda', 'month', 'night', 'photo', 'week'])
    expect(hasPortraitLayout('week')).toBe(true)
  })

  it('give a portrait device the portrait stage, and a landscape one the landscape stage', () => {
    expect(stageFor('agenda', 'portrait')).toEqual({ width: 1440, height: 2560, orientation: 'portrait' })
    expect(stageFor('photo', 'portrait').orientation).toBe('portrait')
    expect(stageFor('week', 'portrait')).toEqual({ width: 1440, height: 2560, orientation: 'portrait' })
    expect(stageFor('week', 'landscape')).toEqual({ width: 2560, height: 1440, orientation: 'landscape' })
    expect(stageFor('agenda', 'landscape').orientation).toBe('landscape')
  })
})
