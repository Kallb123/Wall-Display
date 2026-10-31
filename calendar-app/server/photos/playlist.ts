// The shuffled playlist of a display's photos (architecture §5.1): every photo
// once, in a random order, and no repeat until all have been shown. Pure: the
// random number generator is passed in, so a test can pin the order. Nothing
// here touches the database; `store.ts` saves a playlist as it is.

export interface Playlist {
  /** Every asset id in the pool, in the order they will be shown this round. */
  order: string[]
  /** How many of `order` have been shown this round. The next photo is `order[position]`. */
  position: number
}

/** A random number in [0, 1), as `Math.random` gives. */
export type Random = () => number

export const emptyPlaylist = (): Playlist => ({ order: [], position: 0 })

/** A shuffled copy (Fisher–Yates, so every order is equally likely). */
export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

/** A new round of `pool`. The photo shown last (`last`) is never first, unless it is the only photo there is. */
export function newRound(pool: readonly string[], random: Random, last?: string): Playlist {
  const order = shuffle(pool, random)
  if (order.length > 1 && order[0] === last) {
    const j = 1 + Math.floor(random() * (order.length - 1))
    ;[order[0], order[j]] = [order[j]!, order[0]!]
  }
  return { order, position: 0 }
}

/**
 * Brings a stored playlist in line with the pool as it is now. Photos that have
 * gone are dropped, wherever they were (the position follows, so no photo is
 * skipped or shown twice because of it). New photos are put at a random place
 * among those not shown yet this round, so they turn up soon, but not all at
 * once at the end. Returns the same playlist if nothing changed.
 */
export function reconcile(playlist: Playlist, pool: readonly string[], random: Random): Playlist {
  // Nothing stored yet: this is the first round, so shuffle it properly.
  if (playlist.order.length === 0) return newRound(pool, random)

  const inPool = new Set(pool)
  const kept: string[] = []
  let position = 0
  playlist.order.forEach((id, index) => {
    if (!inPool.has(id)) return
    kept.push(id)
    if (index < playlist.position) position++
  })

  // Also drops a repeated id, which only a damaged row would hold.
  const seen = new Set<string>()
  const order = kept.filter(id => !seen.has(id) && seen.add(id))
  position = Math.min(position, order.length)

  const added = pool.filter(id => !seen.has(id))
  if (added.length === 0 && order.length === playlist.order.length) return playlist
  for (const id of added) {
    const at = position + Math.floor(random() * (order.length - position + 1))
    order.splice(at, 0, id)
  }
  return { order, position }
}

export interface Taken {
  /** The photo to show, or null if none of the pool is acceptable. */
  id: string | null
  playlist: Playlist
}

/**
 * Takes the next photo. `pool` is every photo that may be shown now; the
 * playlist is reconciled with it first, and a new round is shuffled when the
 * last one is used up.
 *
 * `accept` lets the caller pass over photos it can't show right now (when a
 * provider is down: only those already cached). The first acceptable photo not
 * yet shown this round is taken; the ones passed over keep their place for
 * later. If none is left this round, a new round starts, so the photos shown
 * earlier this round come round again rather than the frame going blank.
 */
export function take(playlist: Playlist, pool: readonly string[], random: Random, accept: (id: string) => boolean = () => true): Taken {
  if (pool.length === 0) return { id: null, playlist: emptyPlaylist() }

  const reconciled = reconcile(playlist, pool, random)
  const last = reconciled.order[reconciled.position - 1]
  let current = reconciled
  for (let round = 0; round < 2; round++) {
    if (current.position >= current.order.length) current = newRound(pool, random, last)
    const order = [...current.order]
    // The photo shown last is only shown again if nothing else will do.
    const from = current.position
    let at = order.findIndex((id, index) => index >= from && id !== last && accept(id))
    if (at === -1) at = order.findIndex((id, index) => index >= from && accept(id))
    if (at !== -1) {
      // Swap it into place, so what was passed over is still to come.
      ;[order[from], order[at]] = [order[at]!, order[from]!]
      return { id: order[from]!, playlist: { order, position: from + 1 } }
    }
    // Nothing acceptable left in this round: end it and look through the next, once.
    current = { order: current.order, position: current.order.length }
  }
  return { id: null, playlist: reconciled }
}

/** The photo `take` would give next, without taking it (null at the end of a round, when the next round has yet to be shuffled). */
export function peek(playlist: Playlist, pool: readonly string[], random: Random): string | null {
  const current = reconcile(playlist, pool, random)
  return current.order[current.position] ?? null
}
