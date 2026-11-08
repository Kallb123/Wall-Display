import { describe, expect, it } from 'vitest'
import { fitWraps } from '../../../app/utils/wrapFit'

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
