import { z } from 'zod'
import type { ImmichConfig } from '../config/schema'
import { discard, errorCode } from '../sources/http'
import { PhotoProviderError } from './types'
import type { PhotoListing, PhotoProvider } from './types'

// The Immich provider (architecture §5.2). It lists the pool by album, at
// random, or from today's memories, and fetches `thumbnail?size=preview` of a
// photo: a display-sized image, never the original. The API key goes in the
// `x-api-key` header and nowhere else. Every message is written here as plain
// text and never built from the request, the response or the error that was
// caught, because those can quote the address and Node's can carry the whole URL.

export interface ImmichProviderOptions {
  /** For tests. Default: the global `fetch`. */
  fetch?: typeof fetch
  /** For each request, the body included. Default 30 000. */
  timeoutMs?: number
  /** For tests. Default: the real time. */
  now?: () => Date
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn'>
}

type Settings = Pick<ImmichConfig, 'url' | 'api_key' | 'mode' | 'album_ids' | 'random'>

const DEFAULT_TIMEOUT_MS = 30_000
/** The largest JSON answer accepted: a page of 1000 assets with their EXIF is a few MB. */
const MAX_JSON_BYTES = 64 * 1024 * 1024
/** The largest preview accepted. They are a few hundred KB. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
/** What the search asks for per page, which is the most Immich gives. */
const PAGE_SIZE = 1000
/** A stop for a server whose paging never ends: 500 pages is half a million photos in one album. */
const MAX_PAGES = 500
/** How many photos shown from earlier random batches stay in the pool, so that the cache is not thrown away at every listing. */
const KEEP_SHOWN = 100

const GONE = 'That photo is no longer in Immich'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Only what the pool needs, and anything of the wrong type in a field that is
// only a nicety is dropped rather than failing the asset. Keys we don't use are ignored.
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().catch(undefined)
const asset = z.object({
  id: z.string(),
  type: z.string(),
  isTrashed: optional(z.boolean()),
  isArchived: optional(z.boolean()),
  visibility: optional(z.string()),
  localDateTime: optional(z.string()),
  fileCreatedAt: optional(z.string()),
  exifInfo: optional(z.object({
    exifImageWidth: optional(z.number()),
    exifImageHeight: optional(z.number()),
    // Immich keeps the EXIF number as text ("6"); an older server may send a number.
    orientation: optional(z.union([z.string(), z.number()])),
    dateTimeOriginal: optional(z.string()),
  })),
})
type ImmichAsset = z.output<typeof asset>

const searchPage = z.object({
  assets: z.object({
    items: z.array(z.unknown()),
    nextPage: z.union([z.string(), z.number()]).nullish(),
  }),
})
const memories = z.array(z.object({ assets: z.array(z.unknown()).default([]) }))

const date = (value: string | null | undefined): Date | null => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** The listing for an asset, or null if it isn't a photo to show: not an image, in the bin, archived, or with an id that can't be fetched. */
export function toListing(item: ImmichAsset): PhotoListing | null {
  if (item.type !== 'IMAGE' || item.isTrashed === true || item.isArchived === true) return null
  if (item.visibility != null && item.visibility !== 'timeline') return null
  if (!UUID.test(item.id)) return null

  const listing: PhotoListing = {
    providerAssetId: item.id,
    takenAt: date(item.exifInfo?.dateTimeOriginal) ?? date(item.localDateTime) ?? date(item.fileCreatedAt),
  }
  // The EXIF size is the size as stored. Immich's previews are turned upright already, so a
  // photo saved on its side (orientation 5 to 8) is shown the other way round.
  const width = item.exifInfo?.exifImageWidth
  const height = item.exifInfo?.exifImageHeight
  if (width && height && width > 0 && height > 0) {
    const turned = [5, 6, 7, 8].includes(Number(item.exifInfo?.orientation))
    listing.width = Math.round(turned ? height : width)
    listing.height = Math.round(turned ? width : height)
  }
  return listing
}

/** The assets in `items` that are photos to show. Anything that isn't shaped like an asset is skipped, not an error: one odd asset shouldn't empty the frame. */
function listings(items: readonly unknown[]): PhotoListing[] {
  const found: PhotoListing[] = []
  for (const item of items) {
    const parsed = asset.safeParse(item)
    const listing = parsed.success ? toListing(parsed.data) : null
    if (listing) found.push(listing)
  }
  return found
}

function unique(items: readonly PhotoListing[]): PhotoListing[] {
  const seen = new Set<string>()
  return items.filter(item => !seen.has(item.providerAssetId) && seen.add(item.providerAssetId))
}

export function createImmichProvider(settings: Settings, options: ImmichProviderOptions = {}): PhotoProvider {
  const fetchFn = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = options.now ?? (() => new Date())
  const log = options.log ?? console

  /** `<url>/api/<path>`, whether or not the base has a trailing slash or a path of its own. */
  function endpoint(path: string, search = ''): string {
    let url: URL
    try {
      url = new URL(settings.url)
    } catch {
      throw new PhotoProviderError('immich', 'The Immich address is not valid')
    }
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/api${path}`
    url.search = search
    url.hash = ''
    return url.href
  }

  /** One request, answered with its body read up to `maxBytes`. */
  async function send(path: string, search: string, body: unknown, accept: string, maxBytes: number, notFound?: string): Promise<{ bytes: Buffer, type: string }> {
    const headers: Record<string, string> = { 'x-api-key': settings.api_key, 'Accept': accept }
    // Not followed: a redirect would send the key on to wherever it points.
    const init: RequestInit = { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) }
    if (body !== undefined) {
      init.method = 'POST'
      init.body = JSON.stringify(body)
      headers['Content-Type'] = 'application/json'
    }
    const url = endpoint(path, search)

    let response: Response
    try {
      response = await fetchFn(url, init)
    } catch (error) {
      throw unreachable(error)
    }

    if (!response.ok) {
      await discard(response)
      throw refused(response.status, notFound)
    }
    try {
      return { bytes: await readBytes(response, maxBytes), type: response.headers.get('content-type') ?? '' }
    } catch (error) {
      if (error instanceof PhotoProviderError) throw error
      throw unreachable(error)
    }
  }

  function unreachable(error: unknown): PhotoProviderError {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return new PhotoProviderError('immich', `Immich could not be reached (no answer within ${+(timeoutMs / 1000).toFixed(2)} s)`)
    }
    const code = errorCode(error)
    return new PhotoProviderError('immich', code ? `Immich could not be reached (${code})` : 'Immich could not be reached')
  }

  function refused(status: number, notFound?: string): PhotoProviderError {
    if (status === 401 || status === 403) return new PhotoProviderError('immich', `Immich refused the API key (HTTP ${status})`)
    if (status >= 300 && status < 400) return new PhotoProviderError('immich', `Immich sent the request somewhere else (HTTP ${status}); use the address it redirects to in photos.immich.url`)
    if (status === 400) return new PhotoProviderError('immich', 'Immich did not accept the request (HTTP 400); check photos.immich')
    if (status === 404 && notFound) return new PhotoProviderError('immich', `${notFound} (HTTP 404)`)
    if (status === 404) return new PhotoProviderError('immich', 'Immich has nothing at that address (HTTP 404); check photos.immich.url')
    if (status >= 500) return new PhotoProviderError('immich', `Immich could not be reached: it answered with an error (HTTP ${status})`)
    return new PhotoProviderError('immich', `Immich answered with an unexpected status (HTTP ${status})`)
  }

  async function json<Schema extends z.ZodType>(path: string, schema: Schema, request: { search?: string, body?: unknown } = {}): Promise<z.output<Schema>> {
    const { bytes } = await send(path, request.search ?? '', request.body, 'application/json', MAX_JSON_BYTES)
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new PhotoProviderError('immich', 'Immich did not answer with JSON; check photos.immich.url')
    }
    const result = schema.safeParse(parsed)
    if (!result.success) throw new PhotoProviderError('immich', 'Immich answered in a form that was not understood')
    return result.data
  }

  // -------------------------------------------------------------------------
  // The three modes

  /** Every photo in an album, a page of 1000 at a time. */
  async function albumPhotos(albumId: string): Promise<PhotoListing[]> {
    const found: PhotoListing[] = []
    let page = 1
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const answer = await json('/search/metadata', searchPage, {
        body: { albumIds: [albumId], type: 'IMAGE', page, size: PAGE_SIZE, withExif: true },
      })
      found.push(...listings(answer.assets.items))
      const next = answer.assets.nextPage == null ? null : Number(answer.assets.nextPage)
      if (next === null) return found
      // A page that doesn't move on would ask for ever.
      if (!Number.isInteger(next) || next <= page) throw new PhotoProviderError('immich', 'Immich answered in a form that was not understood')
      page = next
    }
    log.warn(`[photos] immich: stopped reading an album after ${MAX_PAGES} pages`)
    return found
  }

  async function fromAlbums(): Promise<PhotoListing[]> {
    const found: PhotoListing[] = []
    // One after the other: a big album is already a lot to ask of a small server.
    for (const albumId of settings.album_ids) found.push(...await albumPhotos(albumId))
    return unique(found)
  }

  async function fromRandom(): Promise<PhotoListing[]> {
    const { count, person_ids: personIds, taken_after: takenAfter, taken_before: takenBefore } = settings.random
    const body: Record<string, unknown> = { size: count, type: 'IMAGE', withExif: true }
    if (personIds.length > 0) body.personIds = personIds
    if (takenAfter) body.takenAfter = takenAfter
    if (takenBefore) body.takenBefore = takenBefore
    // The answer is a plain list of assets.
    return unique(listings(await json('/search/random', z.array(z.unknown()), { body })))
  }

  async function fromMemories(): Promise<PhotoListing[]> {
    const answer = await json('/memories', memories, { search: new URLSearchParams({ for: now().toISOString() }).toString() })
    return unique(answer.flatMap(memory => listings(memory.assets)))
  }

  // -------------------------------------------------------------------------

  /** Everything listed last time and the photos kept from before, by id, for the size and date of a photo fetched. */
  const known = new Map<string, PhotoListing>()
  /** Photos shown from earlier random batches, oldest first. */
  const shown = new Map<string, PhotoListing>()
  /** Whether the last listing in memories mode found no memories, so that the fallback is only logged when it starts or stops. */
  let noMemories = false

  /**
   * A random pick is a new batch at every listing, so on its own the pool would
   * lose the photos in the cache every 10 minutes, and with Immich down only
   * the few shown from the latest batch would be left to rotate. The photos
   * shown lately stay in the pool for that.
   */
  async function randomPool(): Promise<PhotoListing[]> {
    return unique([...await fromRandom(), ...shown.values()])
  }

  async function pool(): Promise<PhotoListing[]> {
    if (settings.mode === 'albums') return fromAlbums()
    if (settings.mode === 'random') return randomPool()
    const memoryPhotos = await fromMemories()
    if (memoryPhotos.length > 0) {
      if (noMemories) log.info('[photos] immich: there are memories again')
      noMemories = false
      return memoryPhotos
    }
    // No memories today: a random pick, so the frame is never empty.
    if (!noMemories) log.info('[photos] immich: no memories today, so random photos are shown instead')
    noMemories = true
    return randomPool()
  }

  return {
    id: 'immich',

    async list() {
      const listing = await pool()
      known.clear()
      for (const item of listing) known.set(item.providerAssetId, item)
      return listing
    },

    async fetch(providerAssetId) {
      // Checked before it goes into the address, so no id can add a path or a query.
      if (!UUID.test(providerAssetId)) throw new PhotoProviderError('immich', 'That is not a photo in Immich')
      let image: { bytes: Buffer, type: string }
      try {
        image = await send(`/assets/${providerAssetId.toLowerCase()}/thumbnail`, '?size=preview', undefined, 'image/*', MAX_IMAGE_BYTES, GONE)
      } catch (error) {
        // Taken out of Immich since it was listed: not worth keeping in the pool until the next listing.
        if (error instanceof PhotoProviderError && error.message === `${GONE} (HTTP 404)`) shown.delete(providerAssetId)
        throw error
      }
      if (!image.type.toLowerCase().startsWith('image/') || image.bytes.length === 0) {
        throw new PhotoProviderError('immich', 'Immich did not send an image')
      }
      const listing = known.get(providerAssetId)
      if (listing && (settings.mode === 'random' || noMemories)) {
        shown.delete(providerAssetId)
        shown.set(providerAssetId, listing)
        for (const oldest of shown.keys()) {
          if (shown.size <= KEEP_SHOWN) break
          shown.delete(oldest)
        }
      }
      return image.bytes
    },
  }
}

/** The body of a response, stopping as soon as it passes the limit. */
async function readBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const tooLarge = () => new PhotoProviderError('immich', `Immich sent more than ${Math.round(maxBytes / (1024 * 1024))} MB in one answer`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response)
    throw tooLarge()
  }
  if (!response.body) return Buffer.from(await response.arrayBuffer())
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) throw tooLarge()
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
