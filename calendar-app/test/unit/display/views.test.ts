import { describe, expect, it } from 'vitest'
import { hasPortraitLayout, PORTRAIT_VIEWS, stageFor } from '../../../app/utils/views'

describe('the views with a portrait layout', () => {
  it('are the night, agenda, photo and month views, until the week arrives', () => {
    expect([...PORTRAIT_VIEWS].sort()).toEqual(['agenda', 'month', 'night', 'photo'])
    expect(hasPortraitLayout('month')).toBe(true)
    expect(hasPortraitLayout('week')).toBe(false)
  })

  it('give a portrait device the portrait stage, and the week the landscape one', () => {
    expect(stageFor('agenda', 'portrait')).toEqual({ width: 1440, height: 2560, orientation: 'portrait' })
    expect(stageFor('photo', 'portrait').orientation).toBe('portrait')
    expect(stageFor('week', 'portrait')).toEqual({ width: 2560, height: 1440, orientation: 'landscape' })
    expect(stageFor('agenda', 'landscape').orientation).toBe('landscape')
  })
})
