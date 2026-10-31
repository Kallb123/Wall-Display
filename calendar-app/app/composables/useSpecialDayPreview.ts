import type { WatchSource } from 'vue'
import type { Preview } from '../../shared/display'
import { specialDaysResolutionSchema } from '../../shared/special-days'
import type { SpecialDaysResolution } from '../../shared/special-days'
import { previewKey, previewQuery } from '~/utils/specialDays'

/**
 * The special days of a preview (architecture §6.5), asked of the server while
 * `preview` is set: the state only names the day or scene, and the server works
 * out its date, tiles and takeover, as it does for today. The answer is null
 * until it arrives, when the preview ends and if the request fails (the page
 * still says it is a preview, and shows the view as it would be with no special
 * days). It is asked again when the target changes, and whenever `refreshOn`
 * changes: the days or scenes were edited, so the answer may be different.
 */
export function useSpecialDayPreview(preview: MaybeRefOrGetter<Preview | null>, refreshOn: WatchSource) {
  const resolution = ref<SpecialDaysResolution | null>(null)

  // A slow answer for an old target, or one that has since ended, must not land.
  let requests = 0

  async function load(target: Preview) {
    const request = ++requests
    try {
      const response = await $fetch<{ special_days: unknown }>('/api/special-days/preview', { query: previewQuery(target) })
      if (request !== requests) return
      const parsed = specialDaysResolutionSchema.nullable().safeParse(response.special_days)
      resolution.value = parsed.success ? parsed.data : null
    } catch {
      if (request === requests) resolution.value = null
    }
  }

  // By key: the state arrives whole on every change, so the preview is a new object each time without having changed.
  watch(() => previewKey(toValue(preview)), (key) => {
    const target = toValue(preview)
    if (!key || !target) {
      requests++
      resolution.value = null
      return
    }
    // Another day's answer must not show while this one is on its way.
    resolution.value = null
    void load(target)
  }, { immediate: true })

  // Not for the first answer, or for a wall that isn't previewing.
  watch(refreshOn, () => {
    const target = toValue(preview)
    if (target) void load(target)
  })

  return { resolution }
}
