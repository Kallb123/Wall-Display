import { describe, expect, it } from 'vitest'
import { emptyPlaylist, newRound, peek, reconcile, shuffle, take } from '../../../server/photos/playlist'
import type { Playlist } from '../../../server/photos/playlist'
import { seeded } from './helpers'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`)

/** Takes `count` photos in a row from a pool that doesn't change. */
function takeMany(pool: string[], count: number, random = seeded(1), start: Playlist = emptyPlaylist()) {
  const shown: string[] = []
  let playlist = start
  for (let i = 0; i < count; i++) {
    const taken = take(playlist, pool, random)
    shown.push(taken.id!)
    playlist = taken.playlist
  }
  return { shown, playlist }
}

describe('shuffle', () => {
  it('keeps every item once and leaves the input alone', () => {
    const input = ids(20)
    const result = shuffle(input, seeded(3))

    expect([...result].sort()).toEqual([...input].sort())
    expect(input).toEqual(ids(20))
    expect(result).not.toEqual(input)
  })

  it('gives the same order for the same random numbers', () => {
    expect(shuffle(ids(10), seeded(9))).toEqual(shuffle(ids(10), seeded(9)))
  })
})

describe('take', () => {
  it('shows every photo once before any repeats', () => {
    const { shown } = takeMany(ids(7), 7)

    expect([...shown].sort()).toEqual(ids(7).sort())
  })

  it('shuffles again when the round is used up, without the last photo coming first', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { shown } = takeMany(ids(4), 8, seeded(seed))

      expect([...shown.slice(4)].sort()).toEqual(ids(4))
      expect(shown[4]).not.toBe(shown[3])
    }
  })

  it('may repeat when there is only one photo', () => {
    expect(takeMany(['only'], 3).shown).toEqual(['only', 'only', 'only'])
  })

  it('answers null for an empty pool', () => {
    expect(take(emptyPlaylist(), [], seeded(1))).toEqual({ id: null, playlist: emptyPlaylist() })
  })

  it('does not change the playlist it is given', () => {
    const start = takeMany(ids(5), 2).playlist
    const copy = structuredClone(start)

    take(start, ids(5), seeded(1))

    expect(start).toEqual(copy)
  })

  it('passes over photos that are not accepted and keeps them for later', () => {
    const pool = ids(5)
    const first = take(emptyPlaylist(), pool, seeded(2), id => id !== 'p0' && id !== 'p1')
    expect(['p2', 'p3', 'p4']).toContain(first.id)

    // Everything is still shown once this round: the two passed over come after the others.
    let playlist = first.playlist
    const shown = [first.id!]
    for (let i = 0; i < 4; i++) {
      const next = take(playlist, pool, seeded(2))
      shown.push(next.id!)
      playlist = next.playlist
    }
    expect([...shown].sort()).toEqual(pool)
  })

  it('starts a new round when nothing acceptable is left in this one', () => {
    const pool = ids(3)
    const { playlist } = takeMany(pool, 3)

    // Only p1 is acceptable and it was shown already this round, so it comes round again.
    const taken = take(playlist, pool, seeded(4), id => id === 'p1')

    expect(taken.id).toBe('p1')
  })

  it('answers null, and leaves the playlist, if nothing is acceptable at all', () => {
    const pool = ids(3)
    const { playlist } = takeMany(pool, 1)

    const taken = take(playlist, pool, seeded(4), () => false)

    expect(taken).toEqual({ id: null, playlist })
  })
})

describe('when the pool changes', () => {
  it('drops photos that have gone without skipping or repeating any other', () => {
    const pool = ids(6)
    const { shown, playlist } = takeMany(pool, 3)

    const smaller = pool.filter(id => id !== shown[0] && id !== playlist.order[4])
    const rest = takeMany(smaller, 3, seeded(8), playlist).shown

    // The three left in this round, once each, and none of the ones already shown.
    expect(rest.slice(0, 2)).toHaveLength(2)
    expect([...rest.slice(0, 2)].sort()).toEqual(smaller.filter(id => !shown.includes(id)).sort())
  })

  it('puts a new photo among those not shown yet this round', () => {
    const pool = ids(6)
    const { playlist } = takeMany(pool, 2)

    const bigger = [...pool, 'new']
    for (let seed = 1; seed <= 30; seed++) {
      const reconciled = reconcile(playlist, bigger, seeded(seed))
      expect(reconciled.position).toBe(2)
      expect(reconciled.order.slice(0, 2)).toEqual(playlist.order.slice(0, 2))
      expect(reconciled.order.indexOf('new')).toBeGreaterThanOrEqual(2)
    }
  })

  it('spreads the places a new photo lands in', () => {
    const { playlist } = takeMany(ids(6), 1)
    const places = new Set<number>()
    for (let seed = 1; seed <= 60; seed++) places.add(reconcile(playlist, [...ids(6), 'new'], seeded(seed)).order.indexOf('new'))

    expect(places.size).toBeGreaterThan(2)
  })

  it('returns the same playlist when nothing changed', () => {
    const { playlist } = takeMany(ids(4), 2)

    expect(reconcile(playlist, [...ids(4)].reverse(), seeded(1))).toBe(playlist)
  })

  it('shuffles a first round for a playlist with nothing in it yet', () => {
    const pool = ids(10)

    expect(reconcile(emptyPlaylist(), pool, seeded(5))).toEqual(newRound(pool, seeded(5)))
  })

  it('shows photos added after the round ended before it starts again', () => {
    const pool = ids(3)
    const { playlist } = takeMany(pool, 3)

    const taken = take(playlist, [...pool, 'new'], seeded(1))

    expect(taken.id).toBe('new')
  })

  it('ignores a repeated id in a stored playlist', () => {
    const reconciled = reconcile({ order: ['p0', 'p1', 'p0'], position: 1 }, ['p0', 'p1'], seeded(1))

    expect(reconciled.order).toEqual(['p0', 'p1'])
  })
})

describe('peek', () => {
  it('names the photo take would give next, and changes nothing', () => {
    const { playlist } = takeMany(ids(5), 2)

    expect(peek(playlist, ids(5), seeded(1))).toBe(playlist.order[2])
    expect(take(playlist, ids(5), seeded(1)).id).toBe(playlist.order[2])
  })

  it('is null at the end of a round', () => {
    const { playlist } = takeMany(ids(3), 3)

    expect(peek(playlist, ids(3), seeded(1))).toBeNull()
  })
})
