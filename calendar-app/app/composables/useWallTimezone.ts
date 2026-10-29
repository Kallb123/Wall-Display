import type { DisplaySettings } from '../../shared/display'

/**
 * The time zone the wall keeps, for the settings pages' dates ("Today", "Tomorrow")
 * so they agree with what the wall shows. The settings API doesn't carry it, so
 * it is read from `/api/displays`; until that answers, or if it can't, it is
 * the browser's own zone, which is the same place for most households.
 */
export function useWallTimezone(): Ref<string> {
  const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone)

  onMounted(async () => {
    try {
      const displays = await $fetch<DisplaySettings[]>('/api/displays')
      if (displays[0]) timezone.value = displays[0].timezone
    } catch {
      // Out of reach: the browser's zone will do.
    }
  })

  return timezone
}
