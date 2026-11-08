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
