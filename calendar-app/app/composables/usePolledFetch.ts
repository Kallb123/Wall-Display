/**
 * Fetches `url` when the component mounts and again every `intervalMs`, for
 * as long as it lives. The settings pages use it to stay true without a socket
 * (architecture §7.6). It rests while the tab is hidden, and fetches at once
 * when the tab comes back, so a laptop left overnight doesn't wake up showing
 * yesterday's answer for a whole interval. A failed fetch keeps the last data
 * and sets `failed`, which the next good one clears.
 *
 * The next wait starts when a fetch ends, so slow answers never pile up, and
 * only the latest fetch's answer is kept: `reload()` straight after a write
 * can overtake a poll that was already on its way with the old data.
 */
export function usePolledFetch<T>(url: string, intervalMs: number) {
  /** The last answer, or null until there has been one. */
  const data = shallowRef<T | null>(null)
  const failed = ref(false)

  let timer: ReturnType<typeof setTimeout> | undefined
  let fetches = 0
  let stopped = false

  function schedule() {
    clearTimeout(timer)
    if (!stopped && !document.hidden) timer = setTimeout(reload, intervalMs)
  }

  async function reload() {
    clearTimeout(timer)
    const count = ++fetches
    try {
      const next = await $fetch<T>(url)
      if (count === fetches) {
        data.value = next
        failed.value = false
      }
    } catch {
      if (count === fetches) failed.value = true
    }
    if (count === fetches) schedule()
  }

  function onVisibilityChange() {
    if (document.hidden) clearTimeout(timer)
    else void reload()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    void reload()
  })
  onScopeDispose(() => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { data, failed, reload }
}
