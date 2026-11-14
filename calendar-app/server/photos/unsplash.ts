import { z } from 'zod'
import type { UnsplashConfig } from '../config/schema'
import { discard, errorCode } from '../sources/http'
import { readBytes } from './http'
import { PhotoProviderError } from './types'
import type { PhotoListing, PhotoProvider } from './types'

// The Unsplash provider. It lists a pool of photos from a search, from some
// collections or from some topics, a page of 30 at a time, and fetches an
// image of each from Unsplash's image host at a display's size, never the
// full-size original. The access key goes in the `Authorization: Client-ID`
// header of requests to api.unsplash.com and nowhere else: the image host is
// sent no credentials at all, and the one other address that is followed (the
// `download_location` Unsplash asks to be pinged when a photo is used) is only
// called if it is on api.unsplash.com over https. Every message is written
// here as plain text and never built from the request, the response or the
// error that was caught, because those can quote the address.
//
// Unsplash allows a demo key 50 requests an hour. A listing costs one request
// per page of 30 (a pool of 60 is two), the photos themselves come from the
// image host, which is not counted, and the service lists this provider only
// every `refresh_minutes` (see `refreshIntervalMs`), so a listing alone stays
// far from the limit. The other thing that costs requests is the ping Unsplash's
// API guidelines ask for when a photo is used (its `download_location`): one per
// new photo shown, which for a frame that changes photo every minute would be
// 60 an hour, more than the whole allowance. So every answer from the API says
// how many requests are left (`X-Ratelimit-Remaining`), and the pings are
// skipped while that is below a reserve, so the listings keep their budget. If
// the limit is reached all the same, the photos already known keep rotating.
//
// The pick is either `fixed` (the search, collection or topic is read page by
// page, which gives the same photos until they change on Unsplash) or `random`
// (each listing asks `/photos/random`, which gives new photos every time; the
// ones shown lately stay in the pool, as Immich's random mode does).

export interface UnsplashProviderOptions {
  /** The feed id this provider is. Default: `unsplash`, the source's own. */
  id?: string
  /** The feed's name for the settings page. */
  name?: string
  /** For tests. Default: the global `fetch`. */
  fetch?: typeof fetch
  /** For each request, the body included. Default 30 000. */
  timeoutMs?: number
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn'>
}

type Settings = Pick<UnsplashConfig, 'access_key' | 'query' | 'collections' | 'topics' | 'orientation' | 'content_filter' | 'count' | 'pick' | 'refresh_minutes'>

const API = 'https://api.unsplash.com'
const API_HOST = 'api.unsplash.com'
const IMAGE_HOST = 'images.unsplash.com'

const DEFAULT_TIMEOUT_MS = 30_000
/** The largest JSON answer accepted: a page of 30 photos is some tens of KB. */
const MAX_JSON_BYTES = 8 * 1024 * 1024
/** The largest image accepted. At 2560 px they are a few hundred KB. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
/** How much of a 403's body is read to tell a rate limit from a refused key. */
const MAX_ERROR_BYTES = 64 * 1024
/** What a page asks for, which is Unsplash's default and most of what it gives for a search. */
const PAGE_SIZE = 30
/** The most `/photos/random` gives in one request. */
const RANDOM_MAX = 30
/** How many photos shown from earlier random listings stay in the pool, so that the cache is not thrown away at every listing. */
const KEEP_SHOWN = 100
/** The requests left in the hour below which a download ping is not worth one of them. */
const RESERVE = 10
/** The longest side asked of the image host: the stage is 2560 px, so this is never upscaled. */
const IMAGE_SIDE = 2560
/** The longest credit kept, so an odd name can't fill the frame. */
const MAX_CREDIT_NAME = 80

/** What may be put in a path: a collection id or a topic slug (or topic id). */
const PATH_ID = /^[A-Za-z0-9_-]{1,64}$/
/** The id of a photo: what Unsplash uses in its own addresses. */
const PHOTO_ID = /^[A-Za-z0-9_-]{1,64}$/

const GONE = 'That photo is no longer on Unsplash'

// Only what the pool needs. A photo that lacks any of it is skipped (see
// `listings`), but keys we don't use are ignored.
const photo = z.object({
  id: z.string(),
  width: z.number().nullish().catch(undefined),
  height: z.number().nullish().catch(undefined),
  urls: z.object({ raw: z.string() }),
  user: z.object({ name: z.string() }),
  links: z.object({ download_location: z.string() }),
})
type UnsplashPhoto = z.output<typeof photo>

const searchPage = z.object({
  results: z.array(z.unknown()),
  total_pages: z.number().nullish().catch(undefined),
})
const photoPage = z.array(z.unknown())

/** A listed photo and what is kept of it until it is fetched. */
interface Entry {
  listing: PhotoListing
  known: Known
}

/** What is kept of a listed photo until it is fetched. */
interface Known {
  /** The image address, already checked and with the size asked for. */
  image: string
  /** Where to report that the photo was used, or null if it isn't an address we will call. */
  download: string | null
}

/**
 * `raw` as an address on Unsplash's image host asking for a display-sized
 * JPEG, or null if it is anything else (another host, plain http, credentials
 * in it). It keeps the parameters Unsplash put on it (`ixid`, which its
 * statistics use) and sets the size, the format and the quality over them.
 */
export function imageUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== IMAGE_HOST || url.port !== '' || url.username !== '' || url.password !== '') return null
  url.hash = ''
  url.searchParams.set('w', String(IMAGE_SIDE))
  url.searchParams.set('h', String(IMAGE_SIDE))
  url.searchParams.set('fit', 'max')
  url.searchParams.set('fm', 'jpg')
  url.searchParams.set('q', '85')
  return url.href
}

/** `address` if it is on api.unsplash.com over https and carries no credentials, otherwise null. */
function apiAddress(address: string): string | null {
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:' || url.hostname !== API_HOST || url.port !== '' || url.username !== '' || url.password !== '') return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

/** The credit to show: the photographer's name with anything unprintable taken out, or null if nothing is left. */
function creditFor(name: string): string | null {
  const clean = name.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CREDIT_NAME).trim()
  return clean === '' ? null : `Photo by ${clean} on Unsplash`
}

/** The listing for a photo and what to keep of it, or null if it isn't one to show: no usable id, address or photographer. */
export function toListing(item: UnsplashPhoto): Entry | null {
  if (!PHOTO_ID.test(item.id)) return null
  const image = imageUrl(item.urls.raw)
  const credit = creditFor(item.user.name)
  if (!image || !credit) return null
  const listing: PhotoListing = {
    providerAssetId: item.id,
    // Unsplash's created_at is when it was uploaded, not when it was taken.
    takenAt: null,
    credit,
  }
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    listing.width = Math.round(item.width)
    listing.height = Math.round(item.height)
  }
  return { listing, known: { image, download: apiAddress(item.links.download_location) } }
}

export function createUnsplashProvider(settings: Settings, options: UnsplashProviderOptions = {}): PhotoProvider {
  const feedId = options.id ?? 'unsplash'
  const fetchFn = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const log = options.log ?? console

  /** What was listed last time and the photos kept from before, by photo id, for fetching one. */
  const known = new Map<string, Entry>()
  /** Photos shown from earlier random listings, oldest first. */
  const shown = new Map<string, Entry>()
  /** The requests left this hour as the last answer from the API said, or null before any has. */
  let remaining: number | null = null
  /** Whether download pings are being skipped, so that it is only logged when that starts or stops. */
  let skipping = false
  /** The photos already reported as used since the server started: once each is what Unsplash asks. */
  const reported = new Set<string>()

  const headers = (accept: string): Record<string, string> => ({
    'Authorization': `Client-ID ${settings.access_key}`,
    'Accept-Version': 'v1',
    'Accept': accept,
  })

  function unreachable(error: unknown): PhotoProviderError {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return new PhotoProviderError(feedId, `Unsplash could not be reached (no answer within ${+(timeoutMs / 1000).toFixed(2)} s)`)
    }
    const code = errorCode(error)
    return new PhotoProviderError(feedId, code ? `Unsplash could not be reached (${code})` : 'Unsplash could not be reached')
  }

  /**
   * Takes note of how many requests an answer from the API says are left. The
   * header is on every answer, a refused one too; an answer without it (or with
   * something that is not a number) changes nothing. This is also where pings
   * are seen to be allowed again: the limit is per hour, so a later listing
   * shows the budget has come back.
   */
  function noteRemaining(response: Response): void {
    const value = response.headers.get('x-ratelimit-remaining')
    if (value === null || !/^\d{1,9}$/.test(value.trim())) return
    setRemaining(Number(value))
  }

  function setRemaining(left: number): void {
    remaining = left
    if (skipping && left >= RESERVE) {
      skipping = false
      log.info(`[photos] ${feedId}: Unsplash has requests to spare again, so photos shown are reported to it again`)
    }
  }

  /** The error for a failed answer from the API. `notFound` says what a 404 means for this request. */
  async function refused(response: Response, notFound: string): Promise<PhotoProviderError> {
    const { status } = response
    if (status === 403 || status === 429) {
      // A 403 is Unsplash's way of saying both "that key is not allowed" and "too many requests this hour".
      let limited = status === 429 || response.headers.get('x-ratelimit-remaining') === '0'
      if (!limited) {
        try {
          limited = /rate limit/i.test((await readBytes(response, MAX_ERROR_BYTES, feedId, 'Unsplash')).toString('utf8'))
        } catch {
          // Not readable: taken as a refusal of the key.
        }
      } else {
        await discard(response)
      }
      // A 403 that says the limit is reached means none are left, whatever a header might not say.
      if (limited) setRemaining(0)
      return limited
        ? new PhotoProviderError(feedId, `Unsplash's hourly request limit was reached (HTTP ${status}); photos already known are kept`)
        : new PhotoProviderError(feedId, `Unsplash refused the access key (HTTP ${status})`)
    }
    await discard(response)
    if (status === 401) return new PhotoProviderError(feedId, 'Unsplash refused the access key (HTTP 401)')
    if (status >= 300 && status < 400) return new PhotoProviderError(feedId, `Unsplash sent the request somewhere else (HTTP ${status})`)
    if (status === 404) return new PhotoProviderError(feedId, `${notFound} (HTTP 404)`)
    if (status >= 500) return new PhotoProviderError(feedId, `Unsplash could not be reached: it answered with an error (HTTP ${status})`)
    return new PhotoProviderError(feedId, `Unsplash answered with an unexpected status (HTTP ${status})`)
  }

  async function json<Schema extends z.ZodType>(path: string, params: Record<string, string>, schema: Schema, notFound: string): Promise<z.output<Schema>> {
    const url = new URL(path, API)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    let response: Response
    try {
      // Not followed: a redirect would send the key on to wherever it points.
      response = await fetchFn(url.href, { headers: headers('application/json'), redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      throw unreachable(error)
    }
    noteRemaining(response)
    if (!response.ok) throw await refused(response, notFound)

    let parsed: unknown
    try {
      parsed = JSON.parse((await readBytes(response, MAX_JSON_BYTES, feedId, 'Unsplash')).toString('utf8'))
    } catch (error) {
      if (error instanceof PhotoProviderError) throw error
      if (error instanceof SyntaxError) throw new PhotoProviderError(feedId, 'Unsplash did not answer with JSON')
      throw unreachable(error)
    }
    const result = schema.safeParse(parsed)
    if (!result.success) throw new PhotoProviderError(feedId, 'Unsplash answered in a form that was not understood')
    return result.data
  }

  /** The photos of `items` that are ones to show. Anything that isn't shaped like a photo is skipped, not an error: one odd photo shouldn't empty the frame. */
  function usable(items: readonly unknown[]): Entry[] {
    const found: Entry[] = []
    for (const item of items) {
      const parsed = photo.safeParse(item)
      const entry = parsed.success ? toListing(parsed.data) : null
      if (entry) found.push(entry)
    }
    return found
  }

  /**
   * Up to `limit` photos from an endpoint, a page of 30 at a time. It stops
   * when enough are had, at a page that is short (the last one), or after the
   * last page a search says it has.
   */
  async function paged(path: string, params: Record<string, string>, limit: number, notFound: string): Promise<Entry[]> {
    const found: Entry[] = []
    const pages = Math.ceil(limit / PAGE_SIZE)
    for (let page = 1; page <= pages && found.length < limit; page++) {
      const query = { ...params, per_page: String(PAGE_SIZE), page: String(page) }
      let items: readonly unknown[]
      let last = false
      if (path === '/search/photos') {
        const answer = await json(path, query, searchPage, notFound)
        items = answer.results
        last = answer.total_pages != null && page >= answer.total_pages
      } else {
        items = await json(path, query, photoPage, notFound)
      }
      found.push(...usable(items))
      if (last || items.length < PAGE_SIZE) break
    }
    return found
  }

  /** The `fixed` pick: the search's, collections' or topics' photos, a page at a time, each photo once. */
  async function fixedPool(): Promise<Entry[]> {
    const { count, orientation } = settings
    const common: Record<string, string> = orientation ? { orientation } : {}

    // Collections and topics each give a share of `count`, rounded up, and the
    // result is dealt out one from each in turn so that cutting it to `count`
    // doesn't leave out the last ones altogether. Each is its own request path.
    const sources: { path: string, params: Record<string, string>, notFound: string }[] = []
    if (settings.collections && settings.collections.length > 0) {
      for (const id of settings.collections) {
        if (!PATH_ID.test(id)) throw new PhotoProviderError(feedId, 'photos.unsplash.collections has an id that is not valid')
        sources.push({ path: `/collections/${id}/photos`, params: common, notFound: 'Unsplash has no such collection' })
      }
    } else if (settings.topics && settings.topics.length > 0) {
      for (const id of settings.topics) {
        if (!PATH_ID.test(id)) throw new PhotoProviderError(feedId, 'photos.unsplash.topics has a topic that is not valid')
        // A topic's photos can't be filtered by content_filter: only the search takes it.
        sources.push({ path: `/topics/${id}/photos`, params: common, notFound: 'Unsplash has no such topic' })
      }
    } else {
      sources.push({
        path: '/search/photos',
        params: { query: settings.query ?? 'landscape', content_filter: settings.content_filter, ...common },
        notFound: 'Unsplash found nothing at that address',
      })
    }

    const share = Math.ceil(count / sources.length)
    // One after the other: the limit is per hour, and there is no hurry.
    const lists: Entry[][] = []
    for (const source of sources) lists.push(await paged(source.path, source.params, share, source.notFound))

    const seen = new Set<string>()
    const dealt: Entry[] = []
    for (let i = 0; dealt.length < count && lists.some(list => i < list.length); i++) {
      for (const list of lists) {
        const entry = list[i]
        if (entry && dealt.length < count && !seen.has(entry.listing.providerAssetId)) {
          seen.add(entry.listing.providerAssetId)
          dealt.push(entry)
        }
      }
    }
    return dealt
  }

  /**
   * The `random` pick: new photos from `/photos/random`, up to 30 a request, so
   * `count` of 60 is two requests, each answered with a JSON list of photos. It
   * stops early at a request that gave fewer than it was asked for (there are
   * not more to be had), and a photo that came twice counts once. What to pick
   * from is the one of `query`, `collections` and `topics` that is set, which
   * Unsplash takes in one request only if it is the one (the config allows no
   * more); ids are sent as one comma-separated list.
   */
  async function randomPicks(): Promise<Entry[]> {
    const { count, orientation } = settings
    const params: Record<string, string> = {}
    if (settings.collections && settings.collections.length > 0) {
      if (!settings.collections.every(id => PATH_ID.test(id))) throw new PhotoProviderError(feedId, 'photos.unsplash.collections has an id that is not valid')
      params.collections = settings.collections.join(',')
    } else if (settings.topics && settings.topics.length > 0) {
      if (!settings.topics.every(id => PATH_ID.test(id))) throw new PhotoProviderError(feedId, 'photos.unsplash.topics has a topic that is not valid')
      params.topics = settings.topics.join(',')
    } else {
      params.query = settings.query ?? 'landscape'
    }
    if (orientation) params.orientation = orientation
    params.content_filter = settings.content_filter

    const found = new Map<string, Entry>()
    // One after the other, as the limit is per hour and there is no hurry.
    for (let asked = 0; asked < count; asked += RANDOM_MAX) {
      const wanted = Math.min(RANDOM_MAX, count - asked)
      const items = await json('/photos/random', { ...params, count: String(wanted) }, photoPage, 'Unsplash has no such collection, topic or search')
      for (const entry of usable(items)) if (!found.has(entry.listing.providerAssetId)) found.set(entry.listing.providerAssetId, entry)
      if (items.length < wanted) break
    }
    return [...found.values()]
  }

  /**
   * A random pick is a new batch at every listing, so on its own the pool would
   * lose the photos in the cache at every listing, and with Unsplash down or
   * its limit reached only the few shown from the latest batch would be left to
   * rotate. The photos shown lately stay in the pool for that, after the new ones.
   */
  async function randomPool(): Promise<Entry[]> {
    const seen = new Set<string>()
    return [...await randomPicks(), ...shown.values()].filter(entry => !seen.has(entry.listing.providerAssetId) && seen.add(entry.listing.providerAssetId))
  }

  /**
   * Tells Unsplash the photo was used, as its API guidelines ask. Once per
   * photo, never waited for, and nothing that goes wrong with it matters. The
   * guidelines ask for it, but a frame that changes photo every minute would
   * spend the whole hourly allowance on pings and leave nothing for listing, so
   * while the requests left are below the reserve (or the limit was just
   * reached) it is skipped. A skipped photo is not marked as reported, so it is
   * still reported if it is shown again once there is budget.
   */
  function report(id: string, download: string | null): void {
    if (!download || reported.has(id)) return
    if (remaining !== null && remaining < RESERVE) {
      if (!skipping) {
        skipping = true
        log.info(`[photos] ${feedId}: Unsplash's request limit is nearly used up, so photos shown are not reported to it until there is room again`)
      }
      return
    }
    reported.add(id)
    try {
      fetchFn(download, { headers: headers('application/json'), redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
        .then((response) => {
          noteRemaining(response)
          return discard(response)
        })
        .catch(() => undefined)
    } catch {
      // Nothing to do.
    }
  }

  return {
    id: feedId,
    source: 'unsplash',
    ...(options.name === undefined ? {} : { name: options.name }),
    refreshIntervalMs: settings.refresh_minutes * 60_000,

    async list() {
      const entries = settings.pick === 'random' ? await randomPool() : await fixedPool()
      known.clear()
      for (const entry of entries) known.set(entry.listing.providerAssetId, entry)
      return entries.map(entry => entry.listing)
    },

    async fetch(providerAssetId) {
      if (!PHOTO_ID.test(providerAssetId)) throw new PhotoProviderError(feedId, 'That is not a photo from Unsplash')
      const entry = known.get(providerAssetId)
      if (!entry) throw new PhotoProviderError(feedId, 'That photo has not been listed from Unsplash yet')

      let response: Response
      try {
        // No key: the image host has no use for it and has no business seeing it.
        response = await fetchFn(entry.known.image, { headers: { Accept: 'image/*' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
      } catch (error) {
        throw unreachable(error)
      }
      if (!response.ok) {
        await discard(response)
        if (response.status === 404) {
          // Taken down from Unsplash since it was listed: not worth keeping in the pool until the next listing.
          shown.delete(providerAssetId)
          throw new PhotoProviderError(feedId, `${GONE} (HTTP 404)`)
        }
        if (response.status >= 300 && response.status < 400) throw new PhotoProviderError(feedId, `Unsplash sent the request somewhere else (HTTP ${response.status})`)
        if (response.status >= 500) throw new PhotoProviderError(feedId, `Unsplash could not be reached: it answered with an error (HTTP ${response.status})`)
        throw new PhotoProviderError(feedId, `Unsplash answered with an unexpected status (HTTP ${response.status})`)
      }
      let bytes: Buffer
      try {
        bytes = await readBytes(response, MAX_IMAGE_BYTES, feedId, 'Unsplash')
      } catch (error) {
        if (error instanceof PhotoProviderError) throw error
        throw unreachable(error)
      }
      if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('image/') || bytes.length === 0) {
        throw new PhotoProviderError(feedId, 'Unsplash did not send an image')
      }
      report(providerAssetId, entry.known.download)
      if (settings.pick === 'random') {
        shown.delete(providerAssetId)
        shown.set(providerAssetId, entry)
        for (const oldest of shown.keys()) {
          if (shown.size <= KEEP_SHOWN) break
          shown.delete(oldest)
        }
      }
      return bytes
    },
  }
}
