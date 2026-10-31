import type { PhotoSource } from '../../shared/display'
import { PHOTO_SOURCES } from '../../shared/display'
import { photoUrl } from '../../shared/photos'
import type { PhotoInfo } from '../../shared/photos'
import type { Db } from '../db/client'
import type { PhotoAssetRow } from '../db/schema'
import { createPhotoCache } from './cache'
import { peek, take } from './playlist'
import type { Random } from './playlist'
import { PhotoRenderError } from './render'
import type { RenderedPhoto } from './render'
import { getAsset, listPool, loadPlaylist, markShown, savePlaylist, syncListing } from './store'
import { PhotoProviderError, safePhotoError } from './types'
import type { PhotoProvider } from './types'

// The photo frame's engine (architecture §5.1). It lists each configured
// provider now and then and keeps the pool in the database, and answers
// "what does this display show next?" from a shuffled playlist: the photo is
// fetched and rendered on demand, the one after it is prepared in the
// background, and the cache keeps to its size cap without ever evicting a
// photo that is on a display. If a provider is down, the photos already
// cached keep rotating. Everything it touches comes in through the options, so
// a test uses a fake provider, fake timers and an in-memory database.

export interface PhotoServiceOptions {
  db: Db
  /** The photo cache folder. */
  dir: string
  /** The providers that are set up in the config. */
  providers: readonly PhotoProvider[]
  /** The cache's size cap in bytes. */
  maxBytes: number
  /** Leave out portrait photos (`photos.landscape_only`). */
  landscapeOnly: boolean
  /** Turns the bytes of a photo into the image to cache. Injected so the service doesn't load sharp until a photo needs it. */
  render: (input: Buffer) => Promise<RenderedPhoto>
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
  /** How many of them are in the cache now. */
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
   * nothing to show. The provider is `preferred` if it is set up, otherwise the
   * first that is. Never rejects.
   */
  next: (displayId: string, preferred: PhotoSource) => Promise<PhotoInfo | null>
  status: () => { providers: PhotoProviderStatus[], cache_bytes: number }
  /** Resolves when the background preparation of next photos has finished. For tests. */
  idle: () => Promise<void>
}

export const REFRESH_INTERVAL_MS = 10 * 60 * 1000

/** Why a photo can't be had when a listing took it out of the pool while it was being chosen: not a failure of the provider. */
const LEFT_THE_POOL = new Error('The photo is no longer in the pool')

/** How many photos `next` tries before it gives up: a few bad ones in a row shouldn't blank the frame, but a pool of bad ones shouldn't spin. */
const MAX_ATTEMPTS = 8

/** A photo a display has or is about to have, and the file it was in the cache as. */
interface Held {
  id: string
  file: string | null
}

interface ProviderState {
  lastSuccessAt: Date | null
  lastError: string | null
  /** The failure last logged, so the same one is not logged at every listing. */
  loggedError: string | null
}

export function createPhotoService(options: PhotoServiceOptions): PhotoService {
  const { db, providers, landscapeOnly, render, refreshIntervalMs = REFRESH_INTERVAL_MS, random = Math.random, now = () => new Date(), log = console } = options
  let started = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let refreshing: Promise<void> | undefined

  const states = new Map(providers.map(provider => [provider.id, { lastSuccessAt: null, lastError: null, loggedError: null } as ProviderState]))
  /**
   * The photo each display shows now, and the one it will be shown next (being
   * prepared): neither may be evicted. The file is kept too, because the photo
   * can leave the pool (and its row go) while it is still on the display.
   */
  const shown = new Map<string, Held>()
  const upcoming = new Map<string, Held>()
  /** Photos being fetched and rendered right now. */
  const working = new Set<string>()
  /** Photos that could not be rendered, left out until the server restarts. */
  const broken = new Set<string>()
  const fetching = new Map<string, Promise<PhotoAssetRow>>()
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
      for (const { id, file } of held()) {
        if (file) files.add(file)
        const current = getAsset(db, id)?.cacheFile
        if (current) files.add(current)
      }
      // A photo being rendered right now, which may be about to be stored.
      for (const id of working) {
        const current = getAsset(db, id)?.cacheFile
        if (current) files.add(current)
      }
      return files
    },
  })

  /** The provider a display on `preferred` gets. */
  function choose(preferred: PhotoSource): PhotoProvider | undefined {
    return providers.find(provider => provider.id === preferred)
      ?? PHOTO_SOURCES.map(id => providers.find(provider => provider.id === id)).find(Boolean)
  }

  /** The photos that may be shown from this provider now. */
  function poolOf(provider: PhotoProvider): string[] {
    return listPool(db, provider.id)
      .filter(row => !broken.has(row.id) && !(landscapeOnly && row.orientation === 'portrait'))
      .map(row => row.id)
  }

  const isCached = (id: string): boolean => {
    const file = getAsset(db, id)?.cacheFile
    return !!file && cache.has(file)
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

  /** Makes sure the photo has a rendered file in the cache, fetching and rendering it if not. Many callers for the same photo share one fetch. */
  function ensureCached(provider: PhotoProvider, id: string): Promise<PhotoAssetRow> {
    const row = getAsset(db, id)
    if (!row) return Promise.reject(LEFT_THE_POOL)
    if (row.cacheFile && cache.has(row.cacheFile)) return Promise.resolve(row)

    const running = fetching.get(id)
    if (running) return running
    working.add(id)
    const job = (async () => {
      const bytes = await provider.fetch(row.providerAssetId)
      let rendered: RenderedPhoto
      try {
        rendered = await render(bytes)
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
      cache.store(id, rendered)
      return getAsset(db, id)!
    })().finally(() => {
      working.delete(id)
      fetching.delete(id)
    })
    fetching.set(id, job)
    return job
  }

  function toInfo(row: PhotoAssetRow, provider: PhotoProvider): PhotoInfo {
    return {
      id: row.id,
      url: photoUrl(row.cacheFile!),
      width: row.width,
      height: row.height,
      orientation: row.orientation,
      taken_at: row.takenAt?.toISOString() ?? null,
      provider: provider.id,
    }
  }

  /** Starts preparing the photo after this one, so the next request is answered from the cache. */
  function prepare(displayId: string, provider: PhotoProvider, id: string | null): void {
    if (!id) {
      upcoming.delete(displayId)
      return
    }
    const entry: Held = { id, file: null }
    upcoming.set(displayId, entry)
    const job = ensureCached(provider, id).then((row) => {
      entry.file = row.cacheFile
    }, () => {
      // Tried again when it is asked for, and handled there if it fails again.
    }).finally(() => background.delete(job))
    background.add(job)
  }

  async function pick(displayId: string, preferred: PhotoSource): Promise<PhotoInfo | null> {
    const provider = choose(preferred)
    if (!provider) return null

    if (poolOf(provider).length === 0 && refreshing) await refreshing
    let playlist = loadPlaylist(db, displayId, provider.id)
    // Once the provider has failed, only photos already cached are candidates.
    let down = false

    for (let attempt = 0; attempt < MAX_ATTEMPTS && !stopped; attempt++) {
      const pool = poolOf(provider)
      const taken = take(playlist, pool, random, down ? isCached : undefined)
      if (!taken.id) {
        savePlaylist(db, displayId, provider.id, taken.playlist, now())
        return null
      }

      let row: PhotoAssetRow
      try {
        row = await ensureCached(provider, taken.id)
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
      if (landscapeOnly && row.orientation === 'portrait') {
        playlist = taken.playlist
        continue
      }

      markShown(db, row.id, now())
      shown.set(displayId, { id: row.id, file: row.cacheFile })
      savePlaylist(db, displayId, provider.id, taken.playlist, now())
      cache.evict()
      prepare(displayId, provider, peek(taken.playlist, poolOf(provider), random))
      return toInfo(getAsset(db, row.id)!, provider)
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

    next(displayId, preferred) {
      if (stopped) return Promise.resolve(null)
      return inTurn(displayId, () => pick(displayId, preferred)).catch((error) => {
        log.error(`[photos] could not choose the next photo: ${error instanceof PhotoProviderError ? error.message : safePhotoError(error)}`)
        return null
      })
    },

    status() {
      return {
        providers: providers.map((provider) => {
          const state = states.get(provider.id)!
          const rows = listPool(db, provider.id)
          return {
            id: provider.id,
            photos: rows.length,
            cached: rows.filter(row => row.cacheFile !== null).length,
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
