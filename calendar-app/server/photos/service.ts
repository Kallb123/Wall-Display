import type { PhotoSource } from '../../shared/display'
import { PHOTO_SOURCES } from '../../shared/display'
import { coversBox, photoUrl } from '../../shared/photos'
import type { PhotoBox, PhotoInfo, PhotoRendition, StageRendition } from '../../shared/photos'
import type { Db } from '../db/client'
import type { PhotoAssetRow } from '../db/schema'
import { createPhotoCache } from './cache'
import { peek, take } from './playlist'
import type { Random } from './playlist'
import { PhotoRenderError } from './render'
import type { RenderedPhoto } from './render'
import { cachedRenditions, getAsset, getRendition, listPool, loadPlaylist, markShown, savePlaylist, syncListing } from './store'
import { PhotoProviderError, safePhotoError } from './types'
import type { PhotoProvider } from './types'

// The photo frame's engine (architecture §5.1). It lists each configured
// provider now and then and keeps the pool in the database, and answers
// "what does this display show next?" from a shuffled playlist: the photo is
// fetched and rendered on demand, the one after it is prepared in the
// background, and the cache keeps to its size cap without ever evicting a
// photo that is on a display. A photo is rendered to the shape of the stage that
// asks for it, so the cache holds a landscape and a portrait file per photo, as
// they are wanted. A display that also says the size of the box it draws the
// photo in gets the `cover` rendition (the plain photo, see render.ts) when the
// photo's own shape is close to the box's (`coversBox`), and the composite of
// its stage otherwise. A photo whose size isn't known yet is first rendered as a
// composite, which finds it out, and then judged. The held photos, `markShown`
// and the cache all go by the rendition actually served, so a cover file is
// kept, shown-stamped and evicted like any other. If a provider is down, the
// photos already cached keep rotating. Everything it touches comes in through the options, so
// a test uses a fake provider, fake timers and an in-memory database.

export interface PhotoServiceOptions {
  db: Db
  /** The photo cache folder. */
  dir: string
  /** The providers that are set up in the config. */
  providers: readonly PhotoProvider[]
  /** The cache's size cap in bytes. */
  maxBytes: number
  /** Show a display only photos of its own shape (`photos.match_orientation`, or the older `landscape_only`). */
  matchOrientation: boolean
  /** Turns the bytes of a photo into the image to cache, drawn for the shape of stage. Injected so the service doesn't load sharp until a photo needs it. */
  render: (input: Buffer, rendition: PhotoRendition) => Promise<RenderedPhoto>
  /** The time between listings of each provider's pool. Default: 10 minutes. */
  refreshIntervalMs?: number
  /** For tests. Default: `Math.random`. */
  random?: Random
  /** For tests. Default: the real time. */
  now?: () => Date
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

/** How a provider is doing, for the settings page. Neither message holds a URL or a key. */
export interface PhotoProviderStatus {
  id: PhotoSource
  /** Photos in the pool, as last listed. */
  photos: number
  /** How many of them are in the cache now, in at least one rendition. */
  cached: number
  last_success_at: string | null
  last_error: string | null
}

export interface PhotoService {
  /** Prepares the cache folder and lists every provider, without waiting for the answer. */
  start: () => void
  /** Cancels the next listing and ignores whatever is still in flight. */
  stop: () => void
  /** The providers that are set up. */
  configured: () => PhotoSource[]
  /** Lists every provider now. Never rejects. If a listing is under way it waits for that one. */
  refresh: () => Promise<void>
  /**
   * Moves the display on to its next photo and answers it, or null if there is
   * nothing to show. The feed is the first of `preferred` (most specific first:
   * a schedule window's, the layout's, the display's own) that is set up,
   * otherwise the first source that is. The image is rendered for the `rendition` of stage the display
   * has (landscape unless it says otherwise), or, if `box` (the size of what it
   * is drawn in) is given and the photo is close to its shape, as the plain
   * photo to be cropped to the box. Never rejects.
   */
  next: (displayId: string, preferred: string | readonly string[], rendition?: StageRendition, box?: PhotoBox) => Promise<PhotoInfo | null>
  status: () => { providers: PhotoProviderStatus[], cache_bytes: number }
  /** Resolves when the background preparation of next photos has finished. For tests. */
  idle: () => Promise<void>
}

export const REFRESH_INTERVAL_MS = 10 * 60 * 1000

/** Why a photo can't be had when a listing took it out of the pool while it was being chosen: not a failure of the provider. */
const LEFT_THE_POOL = new Error('The photo is no longer in the pool')

/** How many photos `next` tries before it gives up: a few bad ones in a row shouldn't blank the frame, but a pool of bad ones shouldn't spin. */
const MAX_ATTEMPTS = 8

/** A photo a display has or is about to have, in one rendition, and the file it was in the cache as. */
interface Held {
  id: string
  rendition: PhotoRendition
  file: string | null
}

/** A photo in the cache in one rendition. */
interface Cached {
  asset: PhotoAssetRow
  file: string
  /** The rendition the file is of: the one asked for, or `cover` if the photo is close to the box's shape. */
  rendition: PhotoRendition
}

interface ProviderState {
  lastSuccessAt: Date | null
  lastError: string | null
  /** The failure last logged, so the same one is not logged at every listing. */
  loggedError: string | null
}

export function createPhotoService(options: PhotoServiceOptions): PhotoService {
  const { db, providers, matchOrientation, render, refreshIntervalMs = REFRESH_INTERVAL_MS, random = Math.random, now = () => new Date(), log = console } = options
  let started = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let refreshing: Promise<void> | undefined

  const states = new Map(providers.map(provider => [provider.id, { lastSuccessAt: null, lastError: null, loggedError: null } as ProviderState]))
  /**
   * The photo each display shows now, and the one it will be shown next (being
   * prepared): neither may be evicted. The file is kept too, because the photo
   * can leave the pool (and its row go) while it is still on the display. Keyed
   * by display and rendition, because a wall and a phone of another shape on
   * one display each have a photo of their own.
   */
  const shown = new Map<string, Held>()
  const upcoming = new Map<string, Held>()
  /** Photos being fetched and rendered right now, by `${id}:${rendition}`. */
  const working = new Map<string, Held>()
  /** Photos that could not be rendered, left out until the server restarts. */
  const broken = new Set<string>()
  const fetching = new Map<string, Promise<Cached>>()
  const background = new Set<Promise<unknown>>()
  const queues = new Map<string, Promise<unknown>>()

  const held = () => [...shown.values(), ...upcoming.values()]
  const cache = createPhotoCache({
    db,
    dir: options.dir,
    maxBytes: options.maxBytes,
    now,
    log,
    protect: () => {
      const files = new Set<string>()
      for (const { id, rendition, file } of [...held(), ...working.values()]) {
        // For a photo being rendered right now, the file it has is the one about to be replaced.
        if (file) files.add(file)
        const current = getRendition(db, id, rendition)?.cacheFile
        if (current) files.add(current)
      }
      return files
    },
  })

  /** The provider a display gets: the first of `preferred` that is set up, otherwise the first source that is. */
  function choose(preferred: string | readonly string[]): PhotoProvider | undefined {
    const wanted: readonly string[] = typeof preferred === 'string' ? [preferred] : preferred
    for (const id of wanted) {
      const found = providers.find(provider => provider.id === id)
      if (found) return found
    }
    return PHOTO_SOURCES.map(id => providers.find(provider => provider.id === id)).find(Boolean)
  }

  /**
   * The photos that may be shown from this provider now. Photos of the other
   * shape are not taken out (`fits` passes them over instead), so they keep
   * their place in the playlist for a display of their own shape.
   */
  function poolOf(provider: PhotoProvider): string[] {
    return listPool(db, provider.id).filter(row => !broken.has(row.id)).map(row => row.id)
  }

  /** Whether a photo may be shown on a stage of this shape: always, unless the shapes are to match. */
  const fits = (id: string, rendition: StageRendition): boolean => {
    if (!matchOrientation) return true
    const row = getAsset(db, id)
    // A photo whose size isn't known yet is tried, and judged once it has been rendered.
    return !!row && (row.width === 0 || row.orientation === rendition)
  }

  const isCached = (id: string, rendition: PhotoRendition): boolean => {
    const file = getRendition(db, id, rendition)?.cacheFile
    return !!file && cache.has(file)
  }

  /**
   * The rendition to show a photo in: `cover` if its shape is close to the box's,
   * otherwise the stage's. Null when that can't be said yet because its size isn't
   * known. Without a box it is always the stage's, as for an older page.
   */
  function variantOf(id: string, rendition: StageRendition, box: PhotoBox | undefined): PhotoRendition | null {
    if (!box) return rendition
    const row = getAsset(db, id)
    if (!row) return rendition
    if (row.width === 0) return null
    return coversBox(row, box) ? 'cover' : rendition
  }

  /**
   * Whether a file this photo can be shown from is in the cache already: its
   * `cover` file if it is close to the box's shape, or else the stage's composite,
   * which serves just as well when the cover file can't be made (an unknown size
   * counts as no, unless the stage's file is, which has told its size).
   */
  const isReady = (id: string, rendition: StageRendition, box: PhotoBox | undefined): boolean => {
    const variant = variantOf(id, rendition, box)
    return isCached(id, rendition) || (variant !== null && isCached(id, variant))
  }

  /** The photo's composite for the stage, if it is in the cache: what is shown when its cover file can't be had. */
  function cachedComposite(id: string, rendition: StageRendition): Cached | null {
    const row = getAsset(db, id)
    const file = getRendition(db, id, rendition)?.cacheFile
    return row && file && cache.has(file) ? { asset: row, file, rendition } : null
  }

  // -------------------------------------------------------------------------
  // Listing

  async function refreshProvider(provider: PhotoProvider): Promise<void> {
    const state = states.get(provider.id)!
    try {
      const listing = await provider.list()
      if (stopped) return
      const result = syncListing(db, provider.id, listing, now())
      // Files of photos that have gone, and any a display was still showing, go once it moves on.
      cache.release(result.files)
      state.lastSuccessAt = now()
      state.lastError = null
      if (state.loggedError !== null) log.info(`[photos] ${provider.id}: working again`)
      state.loggedError = null
      if (result.added > 0 || result.removed > 0) {
        log.info(`[photos] ${provider.id}: ${listing.length} ${listing.length === 1 ? 'photo' : 'photos'} (${result.added} new, ${result.removed} gone)`)
      }
    } catch (error) {
      if (stopped) return
      const message = safePhotoError(error)
      state.lastError = message
      // The pool in the database stays as it was, so the cache keeps rotating.
      if (message !== state.loggedError) {
        state.loggedError = message
        log.warn(`[photos] ${provider.id}: ${message}; the photos already known are kept`)
      }
    }
  }

  /** Deletes files nothing refers to now, such as the one a display was showing when its photo left the pool. */
  function tidy(): void {
    if (stopped) return
    try {
      cache.sweep()
    } catch (error) {
      log.warn(`[photos] could not tidy the cache folder: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (refreshing) return refreshing
    const current = Promise.all(providers.map(refreshProvider)).then(tidy).finally(() => {
      if (refreshing === current) refreshing = undefined
      if (started && !stopped) {
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), refreshIntervalMs)
      }
    })
    refreshing = current
    return current
  }

  // -------------------------------------------------------------------------
  // Picking

  /** Makes sure the photo has a rendered file in the cache for this shape of stage, fetching and rendering it if not. Many callers for the same photo and shape share one fetch. */
  function ensureCached(provider: PhotoProvider, id: string, rendition: PhotoRendition): Promise<Cached> {
    const row = getAsset(db, id)
    if (!row) return Promise.reject(LEFT_THE_POOL)
    const file = getRendition(db, id, rendition)?.cacheFile
    if (file && cache.has(file)) return Promise.resolve({ asset: row, file, rendition })

    const key = `${id}:${rendition}`
    const running = fetching.get(key)
    if (running) return running
    working.set(key, { id, rendition, file: null })
    const job = (async () => {
      // The original is fetched again for each shape: it is not kept, only what is drawn from it.
      const bytes = await provider.fetch(row.providerAssetId)
      let rendered: RenderedPhoto
      try {
        rendered = await render(bytes, rendition)
      } catch (error) {
        // Noted here, before the job ends, so nothing can ask for the photo again in between.
        if (error instanceof PhotoRenderError) {
          log.warn(`[photos] ${provider.id}: ${id} can't be shown (${error.message}); it is skipped`)
          broken.add(id)
        }
        throw error
      }
      if (stopped) throw new Error('stopped')
      // A listing may have taken it out of the pool while it was being fetched (a random pick from
      // Immich replaces the pool at every listing). It is not stored: nothing would refer to the file.
      if (!getAsset(db, id)) throw LEFT_THE_POOL
      const stored = cache.store(id, rendition, rendered)
      return { asset: getAsset(db, id)!, file: stored, rendition }
    })().finally(() => {
      working.delete(key)
      fetching.delete(key)
    })
    fetching.set(key, job)
    return job
  }

  /**
   * Makes sure the photo has the file it is to be shown from: its `cover` file if
   * it is close to the box's shape, otherwise its composite for the stage. A photo
   * of unknown size gets the composite first, which records the size, and is then
   * judged; if it turns out close, the cover file is made as well.
   */
  async function ensureShown(provider: PhotoProvider, id: string, rendition: StageRendition, box: PhotoBox | undefined): Promise<Cached> {
    // A cover file that can't be made (the provider is down, say) falls back to the composite if there is one.
    const cover = async (): Promise<Cached> => {
      try {
        return await ensureCached(provider, id, 'cover')
      } catch (error) {
        const composite = error === LEFT_THE_POOL ? null : cachedComposite(id, rendition)
        if (composite) return composite
        throw error
      }
    }
    const variant = variantOf(id, rendition, box)
    if (variant === 'cover') return cover()
    if (variant) return ensureCached(provider, id, variant)
    const composite = await ensureCached(provider, id, rendition)
    return variantOf(id, rendition, box) === 'cover' ? cover() : composite
  }

  function toInfo(row: PhotoAssetRow, file: string, provider: PhotoProvider): PhotoInfo {
    return {
      id: row.id,
      url: photoUrl(file),
      width: row.width,
      height: row.height,
      orientation: row.orientation,
      taken_at: row.takenAt?.toISOString() ?? null,
      provider: provider.id,
    }
  }

  /** Starts preparing the photo after this one, in the same rendition and for the same box, so the next request is answered from the cache. */
  function prepare(heldKey: string, provider: PhotoProvider, id: string | null, rendition: StageRendition, box: PhotoBox | undefined): void {
    if (!id) {
      upcoming.delete(heldKey)
      return
    }
    const entry: Held = { id, rendition: variantOf(id, rendition, box) ?? rendition, file: null }
    upcoming.set(heldKey, entry)
    const job = ensureShown(provider, id, rendition, box).then((cached) => {
      entry.rendition = cached.rendition
      entry.file = cached.file
    }, () => {
      // Tried again when it is asked for, and handled there if it fails again.
    }).finally(() => background.delete(job))
    background.add(job)
  }

  async function pick(displayId: string, preferred: string | readonly string[], rendition: StageRendition, box: PhotoBox | undefined): Promise<PhotoInfo | null> {
    const provider = choose(preferred)
    if (!provider) return null

    const heldKey = `${displayId}:${rendition}`
    if (poolOf(provider).length === 0 && refreshing) await refreshing
    let playlist = loadPlaylist(db, displayId, provider.id)
    // Once the provider has failed, only photos already cached are candidates.
    let down = false

    for (let attempt = 0; attempt < MAX_ATTEMPTS && !stopped; attempt++) {
      const pool = poolOf(provider)
      const taken = take(playlist, pool, random, down ? id => fits(id, rendition) && isReady(id, rendition, box) : id => fits(id, rendition))
      if (!taken.id) {
        savePlaylist(db, displayId, provider.id, taken.playlist, now())
        return null
      }

      let cached: Cached
      try {
        cached = await ensureShown(provider, taken.id, rendition, box)
      } catch (error) {
        if (error instanceof PhotoRenderError) {
          // Already noted as broken, so it is not in the pool next time.
          playlist = taken.playlist
        } else if (error !== LEFT_THE_POOL) {
          const message = safePhotoError(error)
          const state = states.get(provider.id)!
          state.lastError = message
          if (message !== state.loggedError) {
            state.loggedError = message
            log.warn(`[photos] ${provider.id}: ${message}; showing cached photos`)
          }
          // Back to where the playlist was, so the photos passed over are still to come.
          down = true
        }
        continue
      }
      // Its true shape is known only now it has been rendered.
      if (matchOrientation && cached.asset.orientation !== rendition) {
        playlist = taken.playlist
        continue
      }

      markShown(db, cached.asset.id, cached.rendition, now())
      shown.set(heldKey, { id: cached.asset.id, rendition: cached.rendition, file: cached.file })
      savePlaylist(db, displayId, provider.id, taken.playlist, now())
      cache.evict()
      prepare(heldKey, provider, peek(taken.playlist, poolOf(provider), random, id => fits(id, rendition)), rendition, box)
      return toInfo(getAsset(db, cached.asset.id)!, cached.file, provider)
    }
    return null
  }

  /** Runs `job` after the display's earlier requests, so two at once don't both start from the same place in the playlist. */
  function inTurn<T>(displayId: string, job: () => Promise<T>): Promise<T> {
    const run = (queues.get(displayId) ?? Promise.resolve()).then(job, job)
    const tail = run.catch(() => {})
    queues.set(displayId, tail)
    void tail.then(() => {
      if (queues.get(displayId) === tail) queues.delete(displayId)
    })
    return run
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      void refresh()
    },

    stop() {
      stopped = true
      clearTimeout(timer)
      timer = undefined
    },

    configured: () => providers.map(provider => provider.id),

    refresh,

    next(displayId, preferred, rendition = 'landscape', box) {
      if (stopped) return Promise.resolve(null)
      return inTurn(displayId, () => pick(displayId, preferred, rendition, box)).catch((error) => {
        log.error(`[photos] could not choose the next photo: ${error instanceof PhotoProviderError ? error.message : safePhotoError(error)}`)
        return null
      })
    },

    status() {
      const withFiles = new Set(cachedRenditions(db).map(row => row.assetId))
      return {
        providers: providers.map((provider) => {
          const state = states.get(provider.id)!
          const rows = listPool(db, provider.id)
          return {
            id: provider.id,
            photos: rows.length,
            cached: rows.filter(row => withFiles.has(row.id)).length,
            last_success_at: state.lastSuccessAt?.toISOString() ?? null,
            last_error: state.lastError,
          }
        }),
        cache_bytes: cache.bytes(),
      }
    },

    async idle() {
      while (background.size > 0) await Promise.allSettled([...background])
    },
  }
}
