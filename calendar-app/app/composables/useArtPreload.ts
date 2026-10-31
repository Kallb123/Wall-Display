import { specialDayArtUrl } from '../../shared/special-days'

/**
 * Loads the special day art the wall will need tomorrow, ahead of the switch
 * at midnight (architecture §6.5), so it appears at once instead of when the
 * file has crossed the network. A name is only fetched while `enabled` (the
 * evening), and once: the `Image` is kept so the decoded picture stays in
 * memory, until the name is no longer wanted. A file that fails to load costs
 * nothing: it is loaded as usual when it is drawn.
 */
export function useArtPreload(names: MaybeRefOrGetter<readonly string[]>, enabled: MaybeRefOrGetter<boolean>) {
  const held = new Map<string, HTMLImageElement>()

  function preload(name: string) {
    const image = new Image()
    image.src = specialDayArtUrl(name)
    held.set(name, image)
    // `decode` rejects for a missing or broken file; an unhandled rejection is noise, not a fault.
    image.decode().catch(() => {})
  }

  watch([() => toValue(names), () => toValue(enabled)], ([wanted, evening]) => {
    // Only dropped once the server no longer lists it, which at midnight is after the art is on show.
    for (const name of held.keys()) {
      if (!wanted.includes(name)) held.delete(name)
    }
    if (!evening) return
    for (const name of wanted) {
      if (!held.has(name)) preload(name)
    }
  }, { immediate: true })

  onScopeDispose(() => held.clear())

  return { held }
}
