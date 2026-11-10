import { describe, expect, it } from 'vitest'
import { eventLabel } from '../../../app/utils/eventLabel'

describe('eventLabel', () => {
  it('puts the icon, a space and the title when there is an icon', () => {
    expect(eventLabel({ display_title: 'Dinner', icon: '🍽️' })).toBe('🍽️ Dinner')
  })

  it('is the bare title with no icon', () => {
    expect(eventLabel({ display_title: 'Dinner', icon: null })).toBe('Dinner')
  })

  it('is the bare title when the field is missing, as in an older cached response', () => {
    expect(eventLabel({ display_title: 'Dinner' })).toBe('Dinner')
  })
})
