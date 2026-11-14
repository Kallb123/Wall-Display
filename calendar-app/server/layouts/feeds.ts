import type { PhotosConfig } from '../config/schema'

// Which photo feeds a layout may name (PR 5.17 with photo feeds, architecture
// §5). A layout lives in SQLite and the feeds in config.yaml, so, as with the
// schedules that name a layout (checks.ts), this is where the two meet: a save
// that names a feed nothing is set up for is refused with the ones that are.

/**
 * The ids a layout's `photo_feed` may hold now: each top-level source that is
 * set up (`immich`, `local`, `unsplash`; `google` is accepted in the config but
 * has no provider yet) followed by the `id` of each of `photos.feeds`, in config
 * order. Empty when there is no `photos` block.
 *
 * It reads `unsplash` and `feeds` defensively, as the config's photos block is
 * still gaining them; when the config's own resolved list of feeds is in place
 * this is swapped for it, so the two can never disagree.
 */
export function configuredFeedIds(photos: PhotosConfig | undefined): string[] {
  if (!photos) return []
  const block = photos as Record<string, unknown>
  const sources = (['immich', 'local', 'unsplash'] as const).filter(source => block[source] !== undefined)
  const feeds = (photos as { feeds?: { id: string }[] }).feeds ?? []
  return [...sources, ...feeds.map(feed => feed.id)]
}

/**
 * The message that refuses a layout's `photo_feed`, or null if it is fine: not
 * set (null or left out), or a feed that is set up. It lists the valid ids so
 * the person fixing a body by hand, or an editor with a stale list, can see them.
 */
export function photoFeedRefusal(feed: string | null | undefined, photos: PhotosConfig | undefined): string | null {
  if (feed === null || feed === undefined) return null
  const ids = configuredFeedIds(photos)
  if (ids.includes(feed)) return null
  return `photo_feed "${feed}" is not a photo feed that is set up (${ids.length > 0 ? `use ${ids.join(', ')}` : 'there is no photos block in the config'}), or leave it out for the display's own choice`
}
