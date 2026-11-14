import { describe, expect, it } from 'vitest'
import { DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import type { ResolvedPaneOptions } from '../../../shared/layouts'
import { PILL_JOIN_GAP, joinedEdges, overlayCorner, photoPills } from '../../../app/utils/photoOverlay'

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
    expect(photoPills(options(), 'top-right', false)).toEqual([{ corner: 'top-right', time: true, date: false, forecast: false }])
  })

  it('shares one pill when the time and the date are in the same corner', () => {
    expect(photoPills(options({ show_date: true }), 'top-left', false)).toEqual([{ corner: 'top-left', time: true, date: true, forecast: false }])
    expect(photoPills(options({ show_date: true, time_corner: 'bottom-left', date_corner: 'bottom-left' }), 'top-left', false))
      .toEqual([{ corner: 'bottom-left', time: true, date: true, forecast: false }])
  })

  it('has a pill each in different corners, clockwise from the top left', () => {
    expect(photoPills(options({ show_date: true, time_corner: 'bottom-left', date_corner: 'top-right' }), 'top-left', false)).toEqual([
      { corner: 'top-right', time: false, date: true, forecast: false },
      { corner: 'bottom-left', time: true, date: false, forecast: false },
    ])
  })

  it('merges two that meet when the banner moves one up', () => {
    expect(photoPills(options({ show_date: true, time_corner: 'top-left', date_corner: 'bottom-left' }), 'top-left', true))
      .toEqual([{ corner: 'top-left', time: true, date: true, forecast: false }])
  })

  it('places the weather in the time\'s corner when the time is off', () => {
    expect(photoPills(options({ show_time: false, time_corner: 'bottom-right' }), 'top-left', false)).toEqual([{ corner: 'bottom-right', time: true, date: false, forecast: false }])
  })

  it('puts the forecast in a corner of its own, with the time\'s line and the date above it when they share one', () => {
    expect(photoPills(options({ show_forecast: true }), 'top-left', false)).toEqual([{ corner: 'top-left', time: true, date: false, forecast: true }])
    expect(photoPills(options({ show_forecast: true, forecast_corner: 'bottom-right' }), 'top-left', false)).toEqual([
      { corner: 'top-left', time: true, date: false, forecast: false },
      { corner: 'bottom-right', time: false, date: false, forecast: true },
    ])
    expect(photoPills(options({ show_forecast: true, show_date: true, time_corner: 'top-right', date_corner: 'top-right', forecast_corner: 'top-right' }), 'top-left', false))
      .toEqual([{ corner: 'top-right', time: true, date: true, forecast: true }])
  })

  it('takes the forecast\'s chosen bottom corner to the top while the banner shows, and leaves it alone with the forecast off', () => {
    expect(photoPills(options({ show_forecast: true, forecast_corner: 'bottom-left' }), 'top-right', true)).toEqual([
      { corner: 'top-left', time: false, date: false, forecast: true },
      { corner: 'top-right', time: true, date: false, forecast: false },
    ])
    expect(photoPills(options({ forecast_corner: 'bottom-left' }), 'top-right', false).every(pill => !pill.forecast)).toBe(true)
  })

  it('is empty when every overlay is off', () => {
    expect(photoPills(options({ show_time: false, show_weather: false }), 'top-left', false)).toEqual([])
    expect(photoPills(options({ show_time: false, show_weather: false, show_date: true, date_corner: 'top-right' }), 'top-left', false))
      .toEqual([{ corner: 'top-right', time: false, date: true, forecast: false }])
  })
})

describe('joinedEdges', () => {
  // A 1920 px pane with 64 px in from each edge leaves 1792 px for the pills.
  const pane = 1920
  const inset = 64
  const room = pane - 2 * inset

  it('joins an edge whose pills are close', () => {
    expect(joinedEdges([{ corner: 'bottom-left', width: 600 }, { corner: 'bottom-right', width: room - 600 - 40 }], pane, inset)).toEqual(['bottom'])
    expect(joinedEdges([{ corner: 'top-right', width: 900 }, { corner: 'top-left', width: room - 900 - 40 }], pane, inset)).toEqual(['top'])
  })

  it('joins pills that touch or overlap', () => {
    expect(joinedEdges([{ corner: 'top-left', width: 900 }, { corner: 'top-right', width: room - 900 }], pane, inset)).toEqual(['top'])
    expect(joinedEdges([{ corner: 'top-left', width: 1000 }, { corner: 'top-right', width: 1000 }], pane, inset)).toEqual(['top'])
  })

  it('leaves pills with room between them apart, the threshold itself being apart', () => {
    expect(joinedEdges([{ corner: 'top-left', width: 600 }, { corner: 'top-right', width: 600 }], pane, inset)).toEqual([])
    expect(joinedEdges([{ corner: 'top-left', width: 600 }, { corner: 'top-right', width: room - 600 - PILL_JOIN_GAP }], pane, inset)).toEqual([])
    expect(joinedEdges([{ corner: 'top-left', width: 600 }, { corner: 'top-right', width: room - 600 - PILL_JOIN_GAP + 1 }], pane, inset)).toEqual(['top'])
  })

  it('needs a pill in both corners of the edge, and never joins across edges', () => {
    expect(joinedEdges([{ corner: 'top-left', width: 1700 }], pane, inset)).toEqual([])
    expect(joinedEdges([{ corner: 'top-left', width: 1000 }, { corner: 'bottom-right', width: 1000 }], pane, inset)).toEqual([])
    expect(joinedEdges([], pane, inset)).toEqual([])
  })

  it('joins both edges when both are close', () => {
    const pills = (['top', 'bottom'] as const).flatMap(edge => [{ corner: `${edge}-left` as const, width: 900 }, { corner: `${edge}-right` as const, width: 850 }])
    expect(joinedEdges(pills, pane, inset)).toEqual(['top', 'bottom'])
  })

  it('takes the inset into account', () => {
    const pills = [{ corner: 'top-left' as const, width: 800 }, { corner: 'top-right' as const, width: 800 }]
    // 1920 - 96 - 1600 = 224 apart; 1700 - 96 - 1600 = 4 apart.
    expect(joinedEdges(pills, 1920, 48)).toEqual([])
    expect(joinedEdges(pills, 1700, 48)).toEqual(['top'])
  })
})
