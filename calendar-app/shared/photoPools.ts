import { z } from 'zod'
import { photoFeedIdSchema } from './display'
import type { PhotoFeedChoice } from './settings'

// Photo pools: pools of photos a person makes on the settings page's Photos tab
// (stored in SQLite, unlike `photos.feeds`, which live in config.yaml). A pool
// mixes several sources: any number of Unsplash searches, collections and
// topics, Immich albums, and the feeds the config already sets up (a source's
// own, such as `local`, or a `photos.feeds` entry). A layout's photo pane (and
// anything else that takes a `photo_feed`) names a pool by its id, as it names
// a feed. Unsplash and Immich sources use the key and address of the config's
// `photos.unsplash` and `photos.immich` blocks: no secret is ever entered on
// the settings page or stored here. Pure: no I/O, and no imports from server/.

export const MAX_POOL_NAME = 60
export const MAX_POOL_SOURCES = 12
export const MAX_UNSPLASH_QUERY = 100
/** How many photos one Unsplash source of a pool lists, if it doesn't say: one request (30 a page) per listing, to spare the hourly limit. */
export const DEFAULT_POOL_UNSPLASH_COUNT = 30
export const MAX_POOL_UNSPLASH_COUNT = 300

export const UNSPLASH_ORIENTATIONS = ['landscape', 'portrait', 'squarish'] as const
export type UnsplashOrientation = (typeof UNSPLASH_ORIENTATIONS)[number]

const orientation = z.enum(UNSPLASH_ORIENTATIONS).optional()
const count = z.number().int().min(1, 'must be at least 1').max(MAX_POOL_UNSPLASH_COUNT, `must be at most ${MAX_POOL_UNSPLASH_COUNT}`).optional()

/** One source of a pool. Each Unsplash search, collection, topic or Immich album is a source of its own. */
export const photoPoolSourceSchema = z.discriminatedUnion('kind', [
  /** An Unsplash search, such as "mountain lake". */
  z.strictObject({
    kind: z.literal('unsplash_search'),
    query: z.string().trim().min(1, 'must not be empty').max(MAX_UNSPLASH_QUERY, `must be at most ${MAX_UNSPLASH_QUERY} characters`),
    orientation,
    count,
  }),
  /** An Unsplash collection, by the id in its address (unsplash.com/collections/<id>/…). */
  z.strictObject({
    kind: z.literal('unsplash_collection'),
    collection: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, 'must be the collection\'s id, from its address (like "317099")'),
    orientation,
    count,
  }),
  /** An Unsplash topic, by its slug (unsplash.com/t/<slug>), such as "nature". */
  z.strictObject({
    kind: z.literal('unsplash_topic'),
    topic: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/, 'must be the topic\'s slug, from its address (like "nature")'),
    orientation,
    count,
  }),
  /** Every photo in one Immich album, by the id in its address. */
  z.strictObject({
    kind: z.literal('immich_album'),
    album_id: z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/, 'must be the album\'s id, from its address in Immich'),
  }),
  /** A feed the config sets up: a source's own (`immich`, `local`, `unsplash`) or a `photos.feeds` id. Not another pool. */
  z.strictObject({
    kind: z.literal('feed'),
    feed: photoFeedIdSchema,
  }),
])
export type PhotoPoolSource = z.infer<typeof photoPoolSourceSchema>
export type PhotoPoolSourceKind = PhotoPoolSource['kind']

export const POOL_SOURCE_KINDS = ['unsplash_search', 'unsplash_collection', 'unsplash_topic', 'immich_album', 'feed'] as const satisfies readonly PhotoPoolSourceKind[]

/** What each kind of source is called in the editor. */
export const POOL_SOURCE_LABELS: Record<PhotoPoolSourceKind, string> = {
  unsplash_search: 'Unsplash search',
  unsplash_collection: 'Unsplash collection',
  unsplash_topic: 'Unsplash topic',
  immich_album: 'Immich album',
  feed: 'Feed from the config',
}

/**
 * A source written out canonically, so two sources that ask for the same thing
 * give the same key (the query is compared without case or extra spaces, and a
 * count left out is the default). Used to refuse duplicates within a pool, and
 * on the server to name the provider that lists it, so pools that share a
 * search share its photos and its requests.
 */
export function poolSourceKey(source: PhotoPoolSource): string {
  switch (source.kind) {
    case 'unsplash_search':
      return ['unsplash_search', source.query.trim().replace(/\s+/g, ' ').toLowerCase(), source.orientation ?? '', source.count ?? DEFAULT_POOL_UNSPLASH_COUNT].join('|')
    case 'unsplash_collection':
      return ['unsplash_collection', source.collection.trim(), source.orientation ?? '', source.count ?? DEFAULT_POOL_UNSPLASH_COUNT].join('|')
    case 'unsplash_topic':
      return ['unsplash_topic', source.topic.trim(), source.orientation ?? '', source.count ?? DEFAULT_POOL_UNSPLASH_COUNT].join('|')
    case 'immich_album':
      return ['immich_album', source.album_id.trim().toLowerCase()].join('|')
    case 'feed':
      return ['feed', source.feed].join('|')
  }
}

/** Which config block a source needs: `unsplash` or `immich` for its key and address, or null (a feed is checked against the feeds set up instead). */
export function poolSourceNeeds(source: PhotoPoolSource): 'unsplash' | 'immich' | null {
  if (source.kind === 'immich_album') return 'immich'
  if (source.kind === 'feed') return null
  return 'unsplash'
}

/** What the editor sends to add or replace a pool. */
export const photoPoolInputSchema = z.strictObject({
  name: z.string().trim().min(1, 'must not be empty').max(MAX_POOL_NAME, `must be at most ${MAX_POOL_NAME} characters`),
  sources: z.array(photoPoolSourceSchema)
    .min(1, 'needs at least one source')
    .max(MAX_POOL_SOURCES, `may have at most ${MAX_POOL_SOURCES} sources`),
}).superRefine((input, ctx) => {
  const seen = new Set<string>()
  input.sources.forEach((source, index) => {
    const key = poolSourceKey(source)
    if (seen.has(key)) ctx.addIssue({ code: 'custom', message: 'is the same as another source of this pool', path: ['sources', index] })
    seen.add(key)
  })
})
export type PhotoPoolInput = z.infer<typeof photoPoolInputSchema>

/** A stored pool, as the API answers it. The id is a slug of the name, and is what a layout's `photo_feed` holds. */
export const photoPoolSchema = z.strictObject({
  id: photoFeedIdSchema,
  name: z.string().min(1).max(MAX_POOL_NAME),
  sources: z.array(photoPoolSourceSchema).min(1).max(MAX_POOL_SOURCES),
  created_at: z.string(),
  updated_at: z.string(),
})
export type PhotoPool = z.infer<typeof photoPoolSchema>

/** How one source of a pool is doing, for the Photos tab. */
export interface PhotoPoolSourceStatus {
  /** Photos it gives, as last listed. */
  photos: number
  /** How many of them are rendered and in the cache now. */
  cached: number
  last_success_at: string | null
  /** The last listing's safe message (never a URL or a key), or null. */
  last_error: string | null
  /**
   * Why the source can't run at all, or null when it can: the config has no
   * `photos.unsplash` (or `photos.immich`) block for its key, or the feed it
   * names is no longer set up. Such a source is skipped; the rest of the pool still shows.
   */
  problem: string | null
}

/** A pool with how each of its sources is doing, in the same order as `sources`. */
export interface PhotoPoolWithStatus extends PhotoPool {
  status: PhotoPoolSourceStatus[]
  /** Layouts whose photo pane shows this pool, by name. A pool in use can't be deleted. */
  used_by: string[]
}

/** `GET /api/photo-pools`. */
export interface PhotoPoolsResponse {
  /** Whether the config has a `photos` block. Without one a pool can't be made (nothing would show it). */
  configured: boolean
  /** Whether the config has a `photos.unsplash` block (the access key) and a `photos.immich` block (the address and key), which Unsplash and Immich sources need. */
  unsplash_available: boolean
  immich_available: boolean
  /** The config's feeds a pool can take in as a source (`feed`): the sources set up, then `photos.feeds`. Pools are not among them. */
  feeds: PhotoFeedChoice[]
  /** Every pool, by name. */
  pools: PhotoPoolWithStatus[]
}

/** In a few words, what a source asks for, for a chip or a list: `"mountain lake"`, `collection 317099`, `topic nature`, `album 0b6a…`, or the feed's name. */
export function poolSourceSummary(source: PhotoPoolSource, feeds: readonly PhotoFeedChoice[] = []): string {
  const shape = 'orientation' in source && source.orientation ? `, ${source.orientation}` : ''
  switch (source.kind) {
    case 'unsplash_search':
      return `"${source.query}"${shape}`
    case 'unsplash_collection':
      return `collection ${source.collection}${shape}`
    case 'unsplash_topic':
      return `topic ${source.topic}${shape}`
    case 'immich_album':
      return `album ${source.album_id.length > 13 ? `${source.album_id.slice(0, 8)}…` : source.album_id}`
    case 'feed':
      return feeds.find(feed => feed.id === source.feed)?.name ?? source.feed
  }
}
