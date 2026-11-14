import { poolSourceProviderId } from '../../photos/poolIds'
import { photoFeedsOf } from '../../photos/feeds'
import { sourceProblems } from '../../photoPools/checks'
import type { PhotoPoolSourceStatus, PhotoPoolsResponse } from '../../../shared/photoPools'
import type { PhotoFeedChoice } from '../../../shared/settings'

// Every pool, by name, for the Photos tab: each source with how it is doing
// (from the photo engine's provider for it), why it can't run (from the config),
// and the layouts showing the pool. Also what the config offers a new source:
// whether Unsplash and Immich are set up, and the feeds a `feed` source may name.
// Reading is open, like the rest of the reads.
export default defineEventHandler((): PhotoPoolsResponse => {
  const photos = useSettings().config().photos
  const providers = usePhotos()?.status().providers ?? []
  const layouts = useLayouts().get()

  const feeds: PhotoFeedChoice[] = photos ? photoFeedsOf(photos).map(feed => ({ id: feed.id, name: feed.name, source: feed.source })) : []

  const pools = usePhotoPools().get().map((pool) => {
    const problems = sourceProblems(pool.sources, photos)
    const status = pool.sources.map((source, index): PhotoPoolSourceStatus => {
      const provider = providers.find(candidate => candidate.id === poolSourceProviderId(source))
      return {
        photos: provider?.photos ?? 0,
        cached: provider?.cached ?? 0,
        last_success_at: provider?.last_success_at ?? null,
        last_error: provider?.last_error ?? null,
        problem: problems[index] ?? null,
      }
    })
    return { ...pool, status, used_by: layouts.filter(layout => layout.photo_feed === pool.id).map(layout => layout.name) }
  })

  return {
    configured: photos !== undefined,
    unsplash_available: photos?.unsplash !== undefined,
    immich_available: photos?.immich !== undefined,
    feeds,
    pools,
  }
})
