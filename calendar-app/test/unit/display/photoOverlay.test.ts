import { describe, expect, it } from 'vitest'
import { DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import type { ResolvedPaneOptions } from '../../../shared/layouts'
import { overlayCorner, photoPills } from '../../../app/utils/photoOverlay'

const options = (changes: Partial<ResolvedPaneOptions> = {}): ResolvedPaneOptions => ({ ...DEFAULT_PANE_OPTIONS, ...changes })

describe('overlayCorner', () => {
  it('follows the walking corner for auto', () => {
    expect(overlayCorner('auto', 'bottom-right', false)).toBe('bottom-right')
    // The page has already moved the walking corner out of the banner's way.
    expect(overlayCorner('auto', 'bottom-right', true)).toBe('bottom-right')
  })

  it('keeps a chosen corner, taking a bottom one to the top on its side while the banner shows', () => {
    expect(overlayCorner('bottom-left', 'top-right', false)).toBe('bottom-left')
    expect(overlayCorner('bottom-left', 'top-right', true)).toBe('top-left')
    expect(overlayCorner('bottom-right', 'top-left', true)).toBe('top-right')
    expect(overlayCorner('top-right', 'top-left', true)).toBe('top-right')
  })
})

describe('photoPills', () => {
  it('is the time in the walking corner by default, with no date', () => {
    expect(photoPills(options(), 'top-right', false)).toEqual([{ corner: 'top-right', time: true, date: false }])
  })

  it('shares one pill when the time and the date are in the same corner', () => {
    expect(photoPills(options({ show_date: true }), 'top-left', false)).toEqual([{ corner: 'top-left', time: true, date: true }])
    expect(photoPills(options({ show_date: true, time_corner: 'bottom-left', date_corner: 'bottom-left' }), 'top-left', false))
      .toEqual([{ corner: 'bottom-left', time: true, date: true }])
  })

  it('has a pill each in different corners, clockwise from the top left', () => {
    expect(photoPills(options({ show_date: true, time_corner: 'bottom-left', date_corner: 'top-right' }), 'top-left', false)).toEqual([
      { corner: 'top-right', time: false, date: true },
      { corner: 'bottom-left', time: true, date: false },
    ])
  })

  it('merges two that meet when the banner moves one up', () => {
    expect(photoPills(options({ show_date: true, time_corner: 'top-left', date_corner: 'bottom-left' }), 'top-left', true))
      .toEqual([{ corner: 'top-left', time: true, date: true }])
  })

  it('places the weather in the time\'s corner when the time is off', () => {
    expect(photoPills(options({ show_time: false, time_corner: 'bottom-right' }), 'top-left', false)).toEqual([{ corner: 'bottom-right', time: true, date: false }])
  })

  it('is empty when every overlay is off', () => {
    expect(photoPills(options({ show_time: false, show_weather: false }), 'top-left', false)).toEqual([])
    expect(photoPills(options({ show_time: false, show_weather: false, show_date: true, date_corner: 'top-right' }), 'top-left', false))
      .toEqual([{ corner: 'top-right', time: false, date: true }])
  })
})
