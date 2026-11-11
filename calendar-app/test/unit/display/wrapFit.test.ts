import { describe, expect, it } from 'vitest'
import { fitRows, fitWraps } from '../../../app/utils/wrapFit'

/** A box with room for `room` lines in all, where an item takes one line, or `lines` when it wraps. */
function box(lines: number[], room: number) {
  const on = new Set<number>()
  const set = (item: number, wrapped: boolean) => (wrapped ? on.add(item) : on.delete(item))
  const overflows = () => lines.reduce((sum, extra, item) => sum + (on.has(item) ? extra : 1), 0) > room
  return { on, set, overflows }
}

describe('fitWraps', () => {
  it('turns everything on when the room is there', () => {
    const { set, overflows } = box([3, 3, 3], 9)

    expect(fitWraps([0, 1, 2], set, overflows)).toEqual([0, 1, 2])
  })

  it('turns on from the top while it fits, and turns an item that does not fit back off', () => {
    const { on, set, overflows } = box([3, 3, 3], 5)

    expect(fitWraps([0, 1, 2], set, overflows)).toEqual([0])
    expect([...on]).toEqual([0])
  })

  it('lets a later, shorter item wrap when an earlier one did not fit', () => {
    const { set, overflows } = box([4, 2, 1], 4)

    expect(fitWraps([0, 1, 2], set, overflows)).toEqual([1, 2])
  })

  it('leaves all off when even the plain rows overflow, and when the box has no room to spare', () => {
    const none = box([3, 3], 1)
    expect(fitWraps([0, 1], none.set, none.overflows)).toEqual([])
    const tight = box([3, 3], 2)
    expect(fitWraps([0, 1], tight.set, tight.overflows)).toEqual([])
    expect(tight.on.size).toBe(0)
  })

  it('starts by turning every item off, whatever state it was in', () => {
    const { on, set, overflows } = box([2, 2], 2)
    on.add(0)
    on.add(1)

    expect(fitWraps([0, 1], set, overflows)).toEqual([])
    expect(on.size).toBe(0)
  })

  it('does nothing for no items', () => {
    expect(fitWraps([], () => {}, () => false)).toEqual([])
  })
})

/**
 * A box with room for `room` lines in all. An item takes one line for its
 * title, `wraps[item]` lines when it wraps, and one more for its location.
 */
function rowsBox(wraps: number[], room: number, located: number[]) {
  const wrapped = new Set<number>()
  const shown = new Set<number>()
  const overflows = () => wraps.reduce((sum, extra, item) => sum + (wrapped.has(item) ? extra : 1) + (shown.has(item) ? 1 : 0), 0) > room
  return {
    wrapped,
    shown,
    options: {
      hasLocation: (item: number) => located.includes(item),
      setWrap: (item: number, on: boolean) => (on ? wrapped.add(item) : wrapped.delete(item)),
      setLocation: (item: number, on: boolean) => (on ? shown.add(item) : shown.delete(item)),
      overflows,
    },
  }
}

describe('fitRows', () => {
  it('shows a location where there is room', () => {
    const { options } = rowsBox([1, 1], 4, [0, 1])

    expect(fitRows([0, 1], { wrap: true, ...options })).toEqual({ wrapped: [0, 1], located: [0, 1] })
  })

  it('shows no location where there is no room', () => {
    const { shown, options } = rowsBox([1, 1], 2, [0, 1])

    expect(fitRows([0, 1], { wrap: true, ...options })).toEqual({ wrapped: [0, 1], located: [] })
    expect(shown.size).toBe(0)
  })

  it('gives a title its wrap before a location its line', () => {
    // Room for 3 lines: the first title wraps onto 2, and then neither the second's wrap nor a location fits.
    const { wrapped, shown, options } = rowsBox([2, 2], 3, [0, 1])

    expect(fitRows([0, 1], { wrap: true, ...options })).toEqual({ wrapped: [0], located: [] })
    expect([...wrapped]).toEqual([0])
    expect(shown.size).toBe(0)
  })

  it('lets a location that fits show after one that did not', () => {
    // The location of item 0 is three lines tall and does not fit; the one of item 1 is one line and does.
    const shown = new Set<number>()
    const overflows = () => [...shown].reduce((sum, item) => sum + (item === 0 ? 3 : 1), 2) > 4
    const result = fitRows([0, 1], {
      wrap: false,
      hasLocation: () => true,
      setWrap: () => {},
      setLocation: (item, on) => (on ? shown.add(item) : shown.delete(item)),
      overflows,
    })

    expect(result).toEqual({ wrapped: [], located: [1] })
  })

  it('still fits locations with wrap off, and turns every wrap off', () => {
    const { wrapped, options } = rowsBox([3, 3], 3, [0, 1])
    wrapped.add(0)
    wrapped.add(1)

    expect(fitRows([0, 1], { wrap: false, ...options })).toEqual({ wrapped: [], located: [0] })
    expect(wrapped.size).toBe(0)
  })

  it('only tries the items that have a location', () => {
    const { options } = rowsBox([1, 1, 1], 4, [1])

    expect(fitRows([0, 1, 2], { wrap: false, ...options })).toEqual({ wrapped: [], located: [1] })
  })

  it('starts with every location off, whatever state it was in', () => {
    const { shown, options } = rowsBox([1, 1], 2, [0, 1])
    shown.add(0)
    shown.add(1)

    expect(fitRows([0, 1], { wrap: true, ...options }).located).toEqual([])
    expect(shown.size).toBe(0)
  })

  it('does nothing for no items', () => {
    expect(fitRows([], { wrap: true, hasLocation: () => true, setWrap: () => {}, setLocation: () => {}, overflows: () => false })).toEqual({ wrapped: [], located: [] })
  })
})
