import { describe, expect, it } from 'vitest'
import { laneSpans, MAX_WRAP_LANES } from '../../../app/utils/monthPanel'
import type { Bar, MoreLabel, TimedRow } from '../../../shared/month-layout'

// Which lanes a bar or timed row may take when its title wraps (the month grid's
// "wrap long titles"): only free ones directly below, in every column it covers.

const bar = (lane: number, column: number, span = 1): Bar => ({ lane, column, span } as Bar)
const timed = (lane: number, column: number): TimedRow => ({ lane, column } as TimedRow)
const more = (lane: number, column: number): MoreLabel => ({ lane, column, count: 2 })

const week = (parts: { bars?: Bar[], timed?: TimedRow[], more?: MoreLabel[] }) => ({ bars: [], timed: [], more: [], ...parts })

describe('laneSpans', () => {
  it('lets a lone item take the lanes below, up to the cap', () => {
    expect(laneSpans(week({ timed: [timed(0, 2)] }), 4).timed).toEqual([MAX_WRAP_LANES])
    expect(laneSpans(week({ timed: [timed(0, 2)] }), 4, 2).timed).toEqual([2])
  })

  it('stops above a timed row in the lane below', () => {
    expect(laneSpans(week({ timed: [timed(0, 1), timed(1, 1)] }), 4).timed).toEqual([1, 3])
  })

  it('stops above a bar that runs into its column, but not one beside it', () => {
    const spans = laneSpans(week({ timed: [timed(0, 2)], bars: [bar(1, 1, 2)] }), 4)
    expect(spans.timed).toEqual([1])
    expect(laneSpans(week({ timed: [timed(0, 2)], bars: [bar(1, 3, 2)] }), 4).timed).toEqual([3])
  })

  it('stops above a "+N more", which sits in the last lane', () => {
    const spans = laneSpans(week({ timed: [timed(0, 4), timed(1, 4), timed(2, 4)], more: [more(3, 4)] }), 4)
    expect(spans.timed).toEqual([1, 1, 1])
  })

  it('gives the item above a "+N more" the lanes up to it', () => {
    expect(laneSpans(week({ timed: [timed(1, 4)], more: [more(3, 4)] }), 4).timed).toEqual([2])
  })

  it('cannot go past the last lane', () => {
    expect(laneSpans(week({ timed: [timed(3, 0)] }), 4).timed).toEqual([1])
    expect(laneSpans(week({ timed: [timed(5, 0)] }), 6).timed).toEqual([1])
    expect(laneSpans(week({ timed: [timed(4, 0)] }), 6).timed).toEqual([2])
  })

  it('needs every column of a multi-column bar to be free', () => {
    const free = laneSpans(week({ bars: [bar(0, 1, 3)] }), 4)
    expect(free.bars).toEqual([3])
    // One timed row under its last column is enough to hold it to its own lane.
    const blocked = laneSpans(week({ bars: [bar(0, 1, 3)], timed: [timed(1, 3)] }), 4)
    expect(blocked.bars).toEqual([1])
    // Two lanes down is the blocker: one extra lane is free.
    expect(laneSpans(week({ bars: [bar(0, 1, 3)], timed: [timed(2, 2)] }), 4).bars).toEqual([2])
  })

  it('answers in the order of bars and timed rows', () => {
    const spans = laneSpans(week({ bars: [bar(0, 0, 2), bar(1, 0, 1)], timed: [timed(0, 5), timed(2, 5)] }), 4)
    expect(spans.bars).toEqual([1, 3])
    expect(spans.timed).toEqual([2, 2])
  })

  it('never gives two items the same lane', () => {
    const spans = laneSpans(week({ bars: [bar(0, 0, 3)], timed: [timed(1, 2), timed(0, 4)] }), 4)
    expect(spans.bars).toEqual([1])
    expect(spans.timed).toEqual([3, 3])
  })
})
