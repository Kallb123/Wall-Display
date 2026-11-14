import { poolSourceNeeds } from '../../shared/photoPools'
import type { PhotoPoolInput, PhotoPoolSource } from '../../shared/photoPools'
import type { PhotosConfig } from '../config/schema'
import { photoFeedIdsOf } from '../photos/feeds'

// What a pool may ask for, given the config. Pools live in SQLite and the
// photo sources in config.yaml, so, as with layouts' feeds, this is where the
// two meet. Pure: the routes pass the config's `photos` block in.

/** Why one source can't run against this config, or null if it can. */
export function sourceProblem(source: PhotoPoolSource, photos: PhotosConfig | undefined): string | null {
  if (!photos) return 'the config has no photos block'
  const needs = poolSourceNeeds(source)
  if (needs === 'unsplash' && !photos.unsplash) return 'needs a photos.unsplash block (the access key) in the config'
  if (needs === 'immich' && !photos.immich) return 'needs a photos.immich block (the address and key) in the config'
  if (source.kind === 'feed' && !photoFeedIdsOf(photos).includes(source.feed)) return `the feed "${source.feed}" is not set up in the config`
  return null
}

/** Each source's problem (or null), in the same order as `sources`, for the GET status. */
export function sourceProblems(sources: readonly PhotoPoolSource[], photos: PhotosConfig | undefined): (string | null)[] {
  return sources.map(source => sourceProblem(source, photos))
}

/** A refusal of a pool input: the status the route answers with and the message. */
export interface PoolRefusal {
  statusCode: 400 | 409
  message: string
}

/**
 * Why a pool may not be saved against this config, or null if it may. With no
 * `photos` block nothing would show a pool (409); otherwise the first source
 * that can't run is a 400 naming `sources.N` (and the feeds that are set up, for a bad feed).
 */
export function poolRefusal(input: PhotoPoolInput, photos: PhotosConfig | undefined): PoolRefusal | null {
  if (!photos) return { statusCode: 409, message: 'There is no photos block in the config, so a pool would have nothing to show it. Set up photos in config.yaml first' }
  for (const [index, source] of input.sources.entries()) {
    const problem = sourceProblem(source, photos)
    if (!problem) continue
    const hint = source.kind === 'feed' ? ` (use ${photoFeedIdsOf(photos).join(', ') || 'none are set up'})` : ''
    return { statusCode: 400, message: `sources.${index} ${problem}${hint}` }
  }
  return null
}
