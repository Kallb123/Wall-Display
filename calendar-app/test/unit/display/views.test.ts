import { describe, expect, it } from 'vitest'
import { hasPortraitLayout, PORTRAIT_VIEWS, stageFor } from '../../../app/utils/views'

describe('the views with a portrait layout', () => {
  it('are the night, agenda and photo views, until the month and week arrive', () => {
    expect([...PORTRAIT_VIEWS].sort()).toEqual(['agenda', 'night', 'photo'])
    expect(hasPortraitLayout('month')).toBe(false)
    expect(hasPortraitLayout('week')).toBe(false)
  })

  it('give a portrait device the portrait stage, and the month the landscape one', () => {
    expect(stageFor('agenda', 'portrait')).toEqual({ width: 1440, height: 2560, orientation: 'portrait' })
    expect(stageFor('photo', 'portrait').orientation).toBe('portrait')
    expect(stageFor('month', 'portrait')).toEqual({ width: 2560, height: 1440, orientation: 'landscape' })
    expect(stageFor('agenda', 'landscape').orientation).toBe('landscape')
  })
})
