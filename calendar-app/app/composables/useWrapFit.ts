import { fitWraps } from '../utils/wrapFit'

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
 *
 * `enabled` is read each time, so pass the option (`() => options.wrap_titles`).
 * When it is false every `data-wrap` this set is removed and nothing is
 * measured. The fit runs after mount, after each update, when `root` changes
 * size and when the fonts have loaded, batched into one animation frame. The
 * clock ticks every second and re-renders, so a box is only fitted again when
 * its signature changed: its size, its items' text, or the item elements
 * themselves. With no layout engine (happy-dom) everything measures 0, so
 * nothing overflows and every item ends up with `data-wrap="on"`.
 */
export function useWrapFit(root: Ref<HTMLElement | null>, enabled: () => boolean) {
  /** What each box looked like when it was last fitted. */
  let fitted = new WeakMap<HTMLElement, { signature: string, items: readonly HTMLElement[] }>()
  let frame = 0
  let observer: ResizeObserver | null = null

  const sameItems = (a: readonly HTMLElement[], b: readonly HTMLElement[]) => a.length === b.length && a.every((item, index) => item === b[index])

  function clear() {
    fitted = new WeakMap()
    for (const item of root.value?.querySelectorAll('[data-wrap-item][data-wrap]') ?? []) item.removeAttribute('data-wrap')
  }

  function fitBox(box: HTMLElement) {
    const items = [...box.querySelectorAll<HTMLElement>('[data-wrap-item]')]
    const signature = `${box.clientWidth}x${box.clientHeight}|${items.map(item => item.textContent).join('\u0000')}`
    const last = fitted.get(box)
    if (last && last.signature === signature && sameItems(last.items, items)) return
    fitWraps(
      items,
      (item, on) => (on ? item.setAttribute('data-wrap', 'on') : item.removeAttribute('data-wrap')),
      () => box.scrollHeight > box.clientHeight + 1,
    )
    fitted.set(box, { signature, items })
  }

  function run() {
    frame = 0
    if (!root.value) return
    if (!enabled()) return clear()
    for (const box of root.value.querySelectorAll<HTMLElement>('[data-wrap-box]')) fitBox(box)
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
