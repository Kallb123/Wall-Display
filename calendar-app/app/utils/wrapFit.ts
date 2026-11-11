// The greedy fit behind "wrap long titles" (architecture §4.8): in a box that
// cannot grow, titles may wrap onto more lines only while everything still
// fits. Pure: no DOM, no Vue. `useWrapFit` is the part that measures.

/**
 * Decides which items of a fixed-size box may wrap. All are turned off first,
 * so the box starts as small as it can be. Then, from the first to the last,
 * each is turned on and, if the box now overflows, turned off again. The
 * earlier items (the sooner events) get the room first, and one that does not
 * fit never stops a later, shorter one from wrapping. Returns the items left
 * on, in order.
 *
 * `set` changes one item and `overflows` measures the box as it now is, both
 * synchronously, so a caller can use the DOM or a fake.
 */
export function fitWraps<T>(items: readonly T[], set: (item: T, on: boolean) => void, overflows: () => boolean): T[] {
  for (const item of items) set(item, false)
  const kept: T[] = []
  for (const item of items) {
    set(item, true)
    if (overflows()) set(item, false)
    else kept.push(item)
  }
  return kept
}

/** What `fitRows` decided for a box: the items that wrap, and the items that show a location line, each in order. */
export interface RowsFit<T> {
  wrapped: T[]
  located: T[]
}

/**
 * Decides which items of a fixed-size box wrap their title and which show
 * their location line (a quieter second line under the title). Titles come
 * first, so a location only gets the room that is left over:
 *
 * 1. Every location is turned off.
 * 2. With `wrap`, the wrap fit runs as `fitWraps` does; without it, every
 *    wrap is turned off.
 * 3. From the first to the last, each item that has a location has it turned
 *    on and, if the box now overflows, turned off again. One that does not
 *    fit never stops a later one from showing.
 *
 * `setWrap`, `setLocation` and `overflows` work on the box synchronously, as
 * with `fitWraps`. Returns the items left wrapping and the items left showing
 * a location.
 */
export function fitRows<T>(items: readonly T[], options: {
  wrap: boolean
  hasLocation: (item: T) => boolean
  setWrap: (item: T, on: boolean) => void
  setLocation: (item: T, on: boolean) => void
  overflows: () => boolean
}): RowsFit<T> {
  const { wrap, hasLocation, setWrap, setLocation, overflows } = options
  for (const item of items) setLocation(item, false)
  let wrapped: T[]
  if (wrap) {
    wrapped = fitWraps(items, setWrap, overflows)
  } else {
    for (const item of items) setWrap(item, false)
    wrapped = []
  }
  const located: T[] = []
  for (const item of items) {
    if (!hasLocation(item)) continue
    setLocation(item, true)
    if (overflows()) setLocation(item, false)
    else located.push(item)
  }
  return { wrapped, located }
}
