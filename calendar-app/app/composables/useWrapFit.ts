import { fitRows } from '../utils/wrapFit'

/**
 * Lets event titles wrap onto more lines only where there is room
 * (architecture §4.8), for the views with a "wrap long titles" option. The view
 * marks up its template and this does the measuring:
 *
 * - `root` is the view's root element (a template ref).
 * - Every `[data-wrap-box]` under it is a fixed-size container with
 *   `overflow: hidden`, such as the panel's list, a day tile or a part-of-day
 *   cell. Whatever is wrapped must grow inside it and never push the box's own
 *   height.
 * - Every `[data-wrap-item]` inside a box is one event row, in the order they
 *   should get room (the DOM order).
 * - This sets `data-wrap="on"` on the items that may wrap and removes it from
 *   the rest. The view's CSS does the wrapping, as in
 *   `[data-wrap='on'] .name { white-space: normal; … }`; a title of one line
 *   looks as it always did.
 * - An item may hold one element with `data-location-line`, the event's
 *   location as a second, quieter line. The view renders it only when the
 *   event has a location to show and locations are switched on, and its CSS
 *   hides it unless the item has `data-location="on"`. This sets that
 *   attribute on the item (not on the line) where there is room left over
 *   after the titles, and removes it from the rest. Titles get their room
 *   first: the locations are tried only once the wraps are settled, from the
 *   first item to the last, and one that does not fit never stops a later one.
 *
 * `enabled` is read each time, so pass the option (`() => options.wrap_titles`).
 * When it is false every `data-wrap` this set is removed and no title is
 * measured for wrapping; the locations are still fitted, in the boxes that
 * have at least one `data-location-line`, and a box with none is not measured
 * at all. The fit runs after mount, after each update, when `root` changes
 * size and when the fonts have loaded, batched into one animation frame. The
 * clock ticks every second and re-renders, so a box is only fitted again when
 * its signature changed: its size, its items' text, or the item elements
 * themselves. With no layout engine (happy-dom) everything measures 0, so
 * nothing overflows and every item ends up with `data-wrap="on"` (when enabled)
 * and `data-location="on"` (when it has a location line).
 */
export function useWrapFit(root: Ref<HTMLElement | null>, enabled: () => boolean) {
  /** What each box looked like when it was last fitted. */
  let fitted = new WeakMap<HTMLElement, { signature: string, items: readonly HTMLElement[] }>()
  let frame = 0
  let observer: ResizeObserver | null = null

  const sameItems = (a: readonly HTMLElement[], b: readonly HTMLElement[]) => a.length === b.length && a.every((item, index) => item === b[index])

  function clear() {
    fitted = new WeakMap()
    for (const item of root.value?.querySelectorAll('[data-wrap-item][data-wrap], [data-wrap-item][data-location]') ?? []) {
      item.removeAttribute('data-wrap')
      item.removeAttribute('data-location')
    }
  }

  function fitBox(box: HTMLElement, wrap: boolean) {
    const items = [...box.querySelectorAll<HTMLElement>('[data-wrap-item]')]
    const hasLocation = (item: HTMLElement) => item.querySelector('[data-location-line]') !== null
    // A box with no location line has nothing to fit unless titles may wrap.
    if (!wrap && !items.some(hasLocation)) {
      for (const item of items) item.removeAttribute('data-location')
      return
    }
    const signature = `${wrap ? 'wrap' : 'plain'}|${box.clientWidth}x${box.clientHeight}|${items.map(item => item.textContent).join('\u0000')}`
    const last = fitted.get(box)
    if (last && last.signature === signature && sameItems(last.items, items)) return
    fitRows(items, {
      wrap,
      hasLocation,
      setWrap: (item, on) => (on ? item.setAttribute('data-wrap', 'on') : item.removeAttribute('data-wrap')),
      setLocation: (item, on) => (on ? item.setAttribute('data-location', 'on') : item.removeAttribute('data-location')),
      overflows: () => box.scrollHeight > box.clientHeight + 1,
    })
    fitted.set(box, { signature, items })
  }

  function run() {
    frame = 0
    if (!root.value) return
    const wrap = enabled()
    // Wraps turned off since the last run must go, whatever the boxes' signatures say.
    if (!wrap) for (const item of root.value.querySelectorAll('[data-wrap-item][data-wrap]')) item.removeAttribute('data-wrap')
    for (const box of root.value.querySelectorAll<HTMLElement>('[data-wrap-box]')) fitBox(box, wrap)
  }

  function schedule() {
    if (frame || typeof requestAnimationFrame === 'undefined') return
    frame = requestAnimationFrame(run)
  }

  onMounted(() => {
    schedule()
    if (typeof ResizeObserver !== 'undefined' && root.value) {
      observer = new ResizeObserver(schedule)
      observer.observe(root.value)
    }
    // A web font that arrives late changes how wide a title is.
    void document.fonts?.ready.then(schedule)
  })
  onUpdated(schedule)
  watch(enabled, schedule)

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    observer?.disconnect()
    observer = null
    clear()
  })
}
