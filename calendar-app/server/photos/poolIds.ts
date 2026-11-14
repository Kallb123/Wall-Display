import { createHash } from 'node:crypto'
import { poolSourceKey } from '../../shared/photoPools'
import type { PhotoPoolSource } from '../../shared/photoPools'

// The provider a pool's source is listed by. A `feed` source is the feed the
// config already runs, so it is that feed's id and costs nothing more. Any other
// source (an Unsplash search, collection or topic, an Immich album) runs as a
// provider of its own, named after what it asks for, so two pools with the same
// search share one provider: one listing, one set of requests, one set of
// photos. The name starts with `~`, which a feed id can never have, so it can't
// collide with a config feed or a pool, and it has no `:`, so asset ids
// (`<provider>:<asset>`) still split cleanly.

/** The provider id that lists `source`: the feed's id for a `feed` source, otherwise `~` and a hash of its canonical key. */
export function poolSourceProviderId(source: PhotoPoolSource): string {
  if (source.kind === 'feed') return source.feed
  return `~${createHash('sha256').update(poolSourceKey(source)).digest('hex').slice(0, 16)}`
}

/** Whether a provider id is one made for a pool's source, rather than a feed the config sets up. */
export function isPoolSourceProviderId(id: string): boolean {
  return id.startsWith('~')
}
