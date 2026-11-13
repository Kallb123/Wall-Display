import { describe, expect, it } from 'vitest'
import { BAND_SHOWN, LANE, LANE_GAP, blockGapFor, coveredByNow, gridRowsOf, percentOf, splitTitle } from '../../../app/utils/weekView'

// The Soft week view's sums: row sizes, percentages and the title's year.

describe('weekView', () => {
  it('splits the year off the title, and leaves one that has none', () => {
    expect(splitTitle('26 October – 1 November 2026')).toEqual({ range: '26 October – 1 November', year: '2026' })
    expect(splitTitle('28 December 2026 – 3 January 2027')).toEqual({ range: '28 December 2026 – 3 January', year: '2027' })
    expect(splitTitle('This week')).toEqual({ range: 'This week', year: '' })
  })

  it('gives the grid its rows, with nothing for an empty strip or band', () => {
    const none = { allDay: { bars: [], more: [], lanes: 0 }, early: null, late: null }
    expect(gridRowsOf(none, false, false)).toBe('72px 0px 0px minmax(0, 1fr) 0px')
    expect(gridRowsOf(none, false, true)).toBe('116px 0px 0px minmax(0, 1fr) 0px')
    expect(gridRowsOf(none, true, false)).toBe('68px 0px 0px minmax(0, 1fr) 0px')
    expect(gridRowsOf(none, true, true)).toBe('112px 0px 0px minmax(0, 1fr) 0px')
    const band = { label: '00–07', items: [] }
    const busy = { allDay: { bars: [], more: [], lanes: 2 }, early: band, late: band }
    expect(gridRowsOf(busy, false, false)).toBe(`72px ${2 * LANE + LANE_GAP + 14}px 48px minmax(0, 1fr) 48px`)
  })

  it('places a position as a percentage of the scale', () => {
    expect(percentOf(120, 600)).toBe('20%')
    expect(percentOf(0, 600)).toBe('0%')
  })

  it('hides an hour label only close to the now pill', () => {
    expect(coveredByNow(125, 120)).toBe(true)
    expect(coveredByNow(150, 120)).toBe(false)
    expect(coveredByNow('early', 0)).toBe(false)
    expect(coveredByNow(undefined, 0)).toBe(false)
  })

  it('has narrower gaps in portrait, and one item in a band cell', () => {
    expect(blockGapFor(false)).toBe(6)
    expect(blockGapFor(true)).toBe(4)
    expect(BAND_SHOWN).toBe(1)
  })
})
