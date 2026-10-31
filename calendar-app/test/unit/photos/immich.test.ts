import { describe, expect, it, vi } from 'vitest'
import { createImmichProvider, toListing } from '../../../server/photos/immich'
import type { ImmichProviderOptions } from '../../../server/photos/immich'
import { PhotoProviderError } from '../../../server/photos/types'
import type { PhotoListing } from '../../../server/photos/types'
import { ALBUM_A, ALBUM_B, BASE, KEY, PERSON, idOf, ids, imageResponse, immich, json, jsonResponse, server, thumbnail } from './immichServer'
import type { Handler } from './immichServer'

// The Immich provider against answers replayed from test/fixtures/immich/. `fetch`
// is a stub (see immichServer.ts): nothing here reaches a network.

type Settings = Parameters<typeof createImmichProvider>[0]
const settings = (changes: Partial<Settings> = {}): Settings => ({
  url: BASE,
  api_key: KEY,
  mode: 'random',
  album_ids: [],
  random: { count: 200, person_ids: [] },
  ...changes,
})

function provider(changes: Partial<Settings>, handler: Handler = server(), options: ImmichProviderOptions = {}) {
  const stub = immich(handler)
  const log = { info: vi.fn(), warn: vi.fn() }
  return { ...stub, log, provider: createImmichProvider(settings(changes), { fetch: stub.fetch, log, ...options }) }
}

/** What a listing says, as `name: widthxheight` for the photos that have a size. */
const brief = (listing: PhotoListing[], names: Map<string, string>) =>
  listing.map(item => `${names.get(item.providerAssetId)}${item.width ? ` ${item.width}x${item.height}` : ''}`)
const byId = new Map([...ids].map(([name, id]) => [id, name]))

const failure = async (job: Promise<unknown>) => {
  try {
    await job
  } catch (error) {
    expect(error).toBeInstanceOf(PhotoProviderError)
    return error as PhotoProviderError
  }
  throw new Error('expected a PhotoProviderError')
}

describe('albums mode', () => {
  it('lists the images of an album, following nextPage until there is none', async () => {
    const { provider: immichProvider, calls } = provider({ mode: 'albums', album_ids: [ALBUM_A] })

    const listing = await immichProvider.list()

    expect(immichProvider.id).toBe('immich')
    expect(calls.map(call => [call.method, call.url.pathname])).toEqual([['POST', '/api/search/metadata'], ['POST', '/api/search/metadata']])
    expect(calls.map(call => call.body)).toEqual([
      { albumIds: [ALBUM_A], type: 'IMAGE', page: 1, size: 1000, withExif: true },
      { albumIds: [ALBUM_A], type: 'IMAGE', page: 2, size: 1000, withExif: true },
    ])
    // The video is left out; the selfie is stored on its side (orientation 6), so its size is turned.
    expect(brief(listing, byId)).toEqual(['beach 4032x3024', 'picnic 4032x3024', 'castle 6000x4000', 'kite 4000x3000', 'selfie 3024x4032'])
  })

  it('reads every album and lists a photo that is in two of them once', async () => {
    const { provider: immichProvider, calls } = provider({ mode: 'albums', album_ids: [ALBUM_A, ALBUM_B] })

    const listing = await immichProvider.list()

    expect(calls.map(call => call.body.albumIds[0])).toEqual([ALBUM_A, ALBUM_A, ALBUM_B])
    const names = brief(listing, byId).map(line => line.split(' ')[0])
    expect(names).toEqual(['beach', 'picnic', 'castle', 'kite', 'selfie', 'lighthouse', 'sideways'])
    expect(new Set(listing.map(item => item.providerAssetId)).size).toBe(listing.length)
  })

  it('leaves out videos, photos in the bin and archived photos (either way Immich says it)', async () => {
    const { provider: immichProvider } = provider({ mode: 'albums', album_ids: [ALBUM_B] })

    const names = (await immichProvider.list()).map(item => byId.get(item.providerAssetId))

    expect(names).toEqual(['picnic', 'lighthouse', 'sideways'])
  })

  it('turns the size of a photo saved on its side, whichever way, and gives the date taken', async () => {
    const { provider: immichProvider } = provider({ mode: 'albums', album_ids: [ALBUM_B] })

    const listing = await immichProvider.list()

    // Orientation 8 (a quarter turn the other way) swaps too; the lighthouse is upright and is not swapped.
    expect(listing.find(item => item.providerAssetId === idOf('sideways'))).toMatchObject({ width: 3000, height: 4000 })
    expect(listing.find(item => item.providerAssetId === idOf('lighthouse'))).toMatchObject({ width: 5472, height: 3648, takenAt: new Date('2020-09-05T07:30:00.000Z') })
  })

  it('stops with an error if the paging never moves on', async () => {
    const stuck = jsonResponse({ assets: { items: [], nextPage: '1' } })
    const { provider: immichProvider, calls } = provider({ mode: 'albums', album_ids: [ALBUM_A] }, () => stuck.clone())

    const error = await failure(immichProvider.list())

    expect(error.message).toContain('not understood')
    expect(calls).toHaveLength(1)
  })

  it('fails the whole listing if one album fails, so the pool is not cut down', async () => {
    const { provider: immichProvider } = provider({ mode: 'albums', album_ids: [ALBUM_A, ALBUM_B] }, call => call.body.albumIds[0] === ALBUM_B ? new Response(null, { status: 400 }) : server()(call))

    const error = await failure(immichProvider.list())

    expect(error.message).toContain('HTTP 400')
  })
})

describe('random mode', () => {
  it('asks for a random pick of images with the defaults, and lists them with what is known of their size and date', async () => {
    const { provider: immichProvider, calls } = provider({ mode: 'random' })

    const listing = await immichProvider.list()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url.pathname).toBe('/api/search/random')
    expect(calls[0]!.body).toEqual({ size: 200, type: 'IMAGE', withExif: true })
    // `snow` is stored 3000x2000 on its side; `no-exif` has no size, so none is given.
    expect(brief(listing, byId)).toEqual(['garden 4032x3024', 'harbour 5000x2800', 'snow 2000x3000', 'no-exif', 'no-date 4032x3024', 'old-bike 4032x3024'])
    expect(listing.find(item => item.providerAssetId === idOf('garden'))!.takenAt).toEqual(new Date('2024-07-04T11:11:11.000Z'))
    // Without dateTimeOriginal the date falls back to localDateTime; with no EXIF at all, too.
    expect(listing.find(item => item.providerAssetId === idOf('no-date'))!.takenAt).toEqual(new Date('2017-03-03T03:03:03.000Z'))
    expect(listing.find(item => item.providerAssetId === idOf('no-exif'))!.takenAt).toEqual(new Date('2024-06-01T10:00:00.000Z'))
  })

  it('sends the count and the person and date filters in the body', async () => {
    const { provider: immichProvider, calls } = provider({
      mode: 'random',
      random: { count: 50, person_ids: [PERSON], taken_after: '2023-01-01T00:00:00.000Z', taken_before: '2023-12-31T23:59:59.999Z' },
    })

    await immichProvider.list()

    expect(calls[0]!.body).toEqual({
      size: 50,
      type: 'IMAGE',
      withExif: true,
      personIds: [PERSON],
      takenAfter: '2023-01-01T00:00:00.000Z',
      takenBefore: '2023-12-31T23:59:59.999Z',
    })
  })

  it('is a new batch at every listing, but keeps the photos it has fetched, up to a limit', async () => {
    const batches = [
      [{ ...(json('search-random.json') as any[])[0] }, { ...(json('search-random.json') as any[])[1] }], // eslint-disable-line @typescript-eslint/no-explicit-any
      [{ ...(json('search-random.json') as any[])[2] }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ]
    let batch = 0
    const { provider: immichProvider } = provider({ mode: 'random' }, call => call.url.pathname === '/api/search/random' ? jsonResponse(batches[batch++]) : imageResponse())

    const first = await immichProvider.list()
    await immichProvider.fetch(idOf('harbour'))
    const second = await immichProvider.list()

    expect(first.map(item => byId.get(item.providerAssetId))).toEqual(['garden', 'harbour'])
    // The new batch, then the photo that was fetched; `garden` was never shown, so it goes.
    expect(second.map(item => byId.get(item.providerAssetId))).toEqual(['snow', 'harbour'])
  })

  it('keeps no more than 100 shown photos', async () => {
    const many = Array.from({ length: 130 }, (_, index) => ({
      ...(json('search-random.json') as any[])[0], // eslint-disable-line @typescript-eslint/no-explicit-any
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }))
    let empty = false
    const { provider: immichProvider } = provider({ mode: 'random' }, call => call.url.pathname === '/api/search/random' ? jsonResponse(empty ? [] : many) : imageResponse())

    await immichProvider.list()
    for (const photo of many) await immichProvider.fetch(photo.id)
    empty = true
    const kept = await immichProvider.list()

    expect(kept).toHaveLength(100)
    // The most recently shown stay.
    expect(kept.map(item => item.providerAssetId)).toEqual(many.slice(30).map(photo => photo.id))
  })

  it('drops a photo from the pool once Immich says it is gone', async () => {
    let gone = false
    const { provider: immichProvider } = provider({ mode: 'random' }, (call) => {
      if (call.url.pathname === '/api/search/random') return jsonResponse([(json('search-random.json') as any[])[0]]) // eslint-disable-line @typescript-eslint/no-explicit-any
      return gone ? new Response(null, { status: 404 }) : imageResponse()
    })
    await immichProvider.list()
    await immichProvider.fetch(idOf('garden'))
    gone = true

    const error = await failure(immichProvider.fetch(idOf('garden')))

    expect(error.message).toBe('That photo is no longer in Immich (HTTP 404)')
  })
})

describe('memories mode', () => {
  it('asks for the memories for now, and lists the images in them once', async () => {
    const { provider: immichProvider, calls } = provider({ mode: 'memories' }, server(), { now: () => new Date('2026-10-31T09:30:00.000Z') })

    const listing = await immichProvider.list()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url.pathname).toBe('/api/memories')
    expect(calls[0]!.url.searchParams.get('for')).toBe('2026-10-31T09:30:00.000Z')
    expect(calls[0]!.init.body).toBeUndefined()
    // `pumpkins` is in both memories, and the video is left out.
    expect(brief(listing, byId)).toEqual(['pumpkins 4032x3024', 'costumes 3000x4000', 'bonfire 4032x3024'])
  })

  it('falls back to a random pick when there are no memories today, and says so once', async () => {
    const { provider: immichProvider, calls, log } = provider({ mode: 'memories' }, server({ memories: json('memories-empty.json') }))

    const first = await immichProvider.list()
    await immichProvider.list()

    expect(calls.map(call => call.url.pathname)).toEqual(['/api/memories', '/api/search/random', '/api/memories', '/api/search/random'])
    expect(calls[1]!.body).toEqual({ size: 200, type: 'IMAGE', withExif: true })
    expect(first).toHaveLength(6)
    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.info.mock.calls[0]![0]).toContain('no memories today')
  })

  it('falls back when the memories hold only videos, and goes back to memories when they come', async () => {
    let memories: unknown = [{ ...(json('memories.json') as any[])[0], assets: [(json('memories.json') as any[])[0].assets[2]] }] // eslint-disable-line @typescript-eslint/no-explicit-any
    const { provider: immichProvider, log } = provider({ mode: 'memories' }, call => server({ memories })(call))

    expect(await immichProvider.list()).toHaveLength(6)
    memories = json('memories.json')
    expect(await immichProvider.list()).toHaveLength(3)

    expect(log.info.mock.calls.map(args => args[0])).toEqual([
      '[photos] immich: no memories today, so random photos are shown instead',
      '[photos] immich: there are memories again',
    ])
  })

  it('applies the random filters to the fallback', async () => {
    const { provider: immichProvider, calls } = provider(
      { mode: 'memories', random: { count: 10, person_ids: [PERSON] } },
      server({ memories: [] }),
    )

    await immichProvider.list()

    expect(calls[1]!.body).toEqual({ size: 10, type: 'IMAGE', withExif: true, personIds: [PERSON] })
  })

  it('does not fall back when Immich cannot be reached', async () => {
    const { provider: immichProvider, calls } = provider({ mode: 'memories' }, () => new Response(null, { status: 503 }))

    await failure(immichProvider.list())

    expect(calls).toHaveLength(1)
  })
})

describe('the asset mapping', () => {
  const base = { id: '3f1c5a0e-3b7d-4c1a-9e57-6a1d2b8c4f90', type: 'IMAGE' }

  it('prefers the EXIF date, then the local date, then the date the file was created', () => {
    const all = { ...base, localDateTime: '2020-01-02T00:00:00Z', fileCreatedAt: '2020-01-03T00:00:00Z', exifInfo: { dateTimeOriginal: '2020-01-01T00:00:00Z' } }

    expect(toListing(all)!.takenAt).toEqual(new Date('2020-01-01T00:00:00Z'))
    expect(toListing({ ...all, exifInfo: undefined })!.takenAt).toEqual(new Date('2020-01-02T00:00:00Z'))
    expect(toListing({ ...all, exifInfo: undefined, localDateTime: undefined })!.takenAt).toEqual(new Date('2020-01-03T00:00:00Z'))
    expect(toListing({ ...all, exifInfo: { dateTimeOriginal: 'not a date' }, localDateTime: null })!.takenAt).toEqual(new Date('2020-01-03T00:00:00Z'))
    expect(toListing(base)!.takenAt).toBeNull()
  })

  it('turns the size for orientations 5 to 8, as text or a number, and not for the others', () => {
    const sized = (orientation: string | number | null | undefined) => toListing({ ...base, exifInfo: { exifImageWidth: 400, exifImageHeight: 300, orientation } })!
    for (const turned of ['5', '6', '7', '8', 5, 6, 7, 8]) expect(sized(turned), String(turned)).toMatchObject({ width: 300, height: 400 })
    for (const upright of ['1', '2', '3', '4', 1, 4, null, undefined, 'Rotate 90 CW']) expect(sized(upright), String(upright)).toMatchObject({ width: 400, height: 300 })
  })

  it('gives no size when EXIF has none, or a nonsense one', () => {
    expect(toListing(base)).not.toHaveProperty('width')
    expect(toListing({ ...base, exifInfo: { exifImageWidth: 0, exifImageHeight: 300 } })).not.toHaveProperty('width')
    expect(toListing({ ...base, exifInfo: { exifImageWidth: 400, exifImageHeight: null } })).not.toHaveProperty('height')
  })

  it('skips what is not a photo to show', () => {
    expect(toListing({ ...base, type: 'VIDEO' })).toBeNull()
    expect(toListing({ ...base, type: 'AUDIO' })).toBeNull()
    expect(toListing({ ...base, isTrashed: true })).toBeNull()
    expect(toListing({ ...base, isArchived: true })).toBeNull()
    expect(toListing({ ...base, visibility: 'archive' })).toBeNull()
    expect(toListing({ ...base, visibility: 'hidden' })).toBeNull()
    expect(toListing({ ...base, visibility: 'timeline' })).not.toBeNull()
    // An id that couldn't go in an address is never listed.
    expect(toListing({ ...base, id: '../etc/passwd' })).toBeNull()
  })

  it('skips an item that is not shaped like an asset instead of failing the listing', async () => {
    const { provider: immichProvider } = provider({ mode: 'random' }, server({ random: [null, 'text', { id: 5 }, { id: base.id }, { ...base, exifInfo: 'odd' }] }))

    const listing = await immichProvider.list()

    expect(listing.map(item => item.providerAssetId)).toEqual([base.id])
  })
})

describe('the address', () => {
  it('puts every call under <url>/api, whether or not the address ends in a slash or has a path', async () => {
    for (const [url, prefix] of [[BASE, ''], [`${BASE}/`, ''], [`${BASE}/immich`, '/immich'], [`${BASE}/immich//`, '/immich'], [`${BASE}/?token=1#top`, '']] as const) {
      const { provider: immichProvider, calls } = provider({ mode: 'memories', url }, (call) => {
        if (call.url.pathname === `${prefix}/api/memories`) return jsonResponse(json('memories.json'))
        if (call.url.pathname === `${prefix}/api/search/random`) return jsonResponse([])
        return imageResponse()
      })

      await immichProvider.list()
      await immichProvider.fetch(idOf('pumpkins'))

      expect(calls.map(call => call.url.origin + call.url.pathname), url).toEqual([
        `${BASE}${prefix}/api/memories`,
        `${BASE}${prefix}/api/assets/${idOf('pumpkins')}/thumbnail`,
      ])
      // Nothing from the configured address' own query goes on.
      expect(calls[1]!.url.search).toBe('?size=preview')
    }
  })

  it('is an error, without the address, if it is not a URL at all', async () => {
    const { provider: immichProvider } = provider({ url: 'not a url' })

    const error = await failure(immichProvider.list())

    expect(error.message).toBe('The Immich address is not valid')
  })
})

describe('fetch', () => {
  const id = () => idOf('beach')

  it('asks for the preview thumbnail, never the original, and answers its bytes', async () => {
    const { provider: immichProvider, calls } = provider({ mode: 'albums', album_ids: [ALBUM_A] })

    const bytes = await immichProvider.fetch(id())

    expect(bytes.equals(thumbnail())).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url.pathname).toBe(`/api/assets/${id()}/thumbnail`)
    expect(calls[0]!.url.search).toBe('?size=preview')
    expect(calls.some(call => call.url.pathname.endsWith('/original'))).toBe(false)
  })

  it('sends only valid ids, so nothing can add a path or a query to the address', async () => {
    const { provider: immichProvider, calls } = provider({})
    const bad = ['', 'beach', '../../api/users/me', `${id()}/original`, `${id()}?size=fullsize`, `${id()}#x`, `${id()}\n`, `${id()} `, ` ${id()}`, '%2e%2e', id().slice(1), `${id()}0`, 'g'.repeat(36), id().replaceAll('-', '')]

    for (const value of bad) {
      const error = await failure(immichProvider.fetch(value))
      expect(error.message, JSON.stringify(value)).toBe('That is not a photo in Immich')
    }

    expect(calls).toHaveLength(0)
  })

  it('accepts a UUID in capitals', async () => {
    const { provider: immichProvider, calls } = provider({})

    await immichProvider.fetch(id().toUpperCase())

    expect(calls[0]!.url.pathname).toBe(`/api/assets/${id()}/thumbnail`)
  })

  it('is an error if Immich answers with something that is not an image', async () => {
    const { provider: immichProvider } = provider({}, () => new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))

    expect((await failure(immichProvider.fetch(id()))).message).toBe('Immich did not send an image')
  })

  it('is an error if the image is empty or too large', async () => {
    const empty = provider({}, () => new Response(new Uint8Array(0), { headers: { 'Content-Type': 'image/jpeg' } }))
    expect((await failure(empty.provider.fetch(id()))).message).toBe('Immich did not send an image')

    const large = provider({}, () => new Response('x', { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(64 * 1024 * 1024) } }))
    expect((await failure(large.provider.fetch(id()))).message).toContain('more than 32 MB')
  })
})

describe('what is sent', () => {
  it('puts the API key in the x-api-key header of every kind of call, and asks for JSON or an image', async () => {
    const { provider: albums, calls } = provider({ mode: 'albums', album_ids: [ALBUM_A] })
    await albums.list()
    await albums.fetch(idOf('beach'))
    const random = provider({ mode: 'random' })
    await random.provider.list()
    const memories = provider({ mode: 'memories' })
    await memories.provider.list()

    const all = [...calls, ...random.calls, ...memories.calls]
    expect(all.length).toBeGreaterThan(4)
    for (const call of all) {
      expect(call.headers['x-api-key'], call.url.pathname).toBe(KEY)
      expect(call.headers.Accept, call.url.pathname).toBe(call.url.pathname.endsWith('/thumbnail') ? 'image/*' : 'application/json')
      // Not in the address, and no other kind of credential.
      expect(call.url.href).not.toContain(KEY)
      expect(call.headers).not.toHaveProperty('Authorization')
    }
    expect(all.filter(call => call.method === 'POST').every(call => call.headers['Content-Type'] === 'application/json')).toBe(true)
  })

  it('has a timeout on every request, and does not follow redirects with the key', async () => {
    const { provider: immichProvider, calls } = provider({ mode: 'albums', album_ids: [ALBUM_A] })
    await immichProvider.list()
    await immichProvider.fetch(idOf('beach'))

    for (const call of calls) {
      expect(call.init.signal, call.url.pathname).toBeInstanceOf(AbortSignal)
      expect(call.init.redirect).toBe('manual')
    }
  })
})

describe('errors', () => {
  const secrets = (error: PhotoProviderError) => {
    // Nothing that could identify the server, the request or the key; and nothing kept as a cause.
    expect(error.message).not.toContain(KEY)
    expect(error.message).not.toContain('immich.example.test')
    expect(error.message).not.toContain('2283')
    expect(error.message).not.toContain('http')
    expect(error.message).not.toContain('?')
    expect(error.cause).toBeUndefined()
    expect(error.provider).toBe('immich')
  }

  const both = (handler: Handler, options: ImmichProviderOptions = {}) => {
    const { provider: immichProvider } = provider({ mode: 'random' }, handler, options)
    return [() => immichProvider.list(), () => immichProvider.fetch(idOf('beach'))] as const
  }

  it.each([401, 403])('says the API key was refused for a %i, when listing and when fetching', async (status) => {
    for (const run of both(() => new Response(JSON.stringify({ message: `bad key ${KEY}` }), { status }))) {
      const error = await failure(run())
      expect(error.message).toBe(`Immich refused the API key (HTTP ${status})`)
      secrets(error)
    }
  })

  it.each([500, 502, 503])('says Immich could not be reached for a %i', async (status) => {
    for (const run of both(() => new Response('upstream said http://10.0.0.5:2283/api?key=abc', { status }))) {
      const error = await failure(run())
      expect(error.message).toBe(`Immich could not be reached: it answered with an error (HTTP ${status})`)
      secrets(error)
    }
  })

  it('says Immich could not be reached when the connection fails, without the address or the key in the message', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error(`connect ECONNREFUSED 10.0.0.5:2283 for ${BASE}/api/search/random?key=${KEY}`), { code: 'ECONNREFUSED' }),
    })
    for (const run of both(() => { throw refused })) {
      const error = await failure(run())
      expect(error.message).toBe('Immich could not be reached (ECONNREFUSED)')
      secrets(error)
    }
    const unknown = both(() => { throw new Error(`boom ${KEY}`) })
    expect((await failure(unknown[0]())).message).toBe('Immich could not be reached')
  })

  it('times out, with the signal the request was given, in the listing and in the thumbnail', async () => {
    const hang: Handler = call => new Promise((_resolve, reject) => {
      call.init.signal!.addEventListener('abort', () => reject(call.init.signal!.reason))
    })
    for (const run of both(hang, { timeoutMs: 20 })) {
      const error = await failure(run())
      expect(error.message).toBe('Immich could not be reached (no answer within 0.02 s)')
      secrets(error)
    }
  })

  it('times out while the body is coming, too', async () => {
    const stalled: Handler = call => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('['))
        call.init.signal!.addEventListener('abort', () => controller.error(call.init.signal!.reason))
      },
    }), { headers: { 'Content-Type': 'application/json' } })
    const { provider: immichProvider } = provider({ mode: 'random' }, stalled, { timeoutMs: 20 })

    const error = await failure(immichProvider.list())

    expect(error.message).toContain('no answer within')
  })

  it('explains the other statuses without echoing anything', async () => {
    const say = async (status: number, run: 0 | 1) => (await failure(both(() => new Response(null, { status }))[run]())).message
    expect(await say(301, 0)).toContain('use the address it redirects to')
    expect(await say(307, 1)).toContain('HTTP 307')
    expect(await say(400, 0)).toContain('check photos.immich')
    expect(await say(404, 0)).toContain('check photos.immich.url')
    expect(await say(404, 1)).toBe('That photo is no longer in Immich (HTTP 404)')
    expect(await say(429, 0)).toBe('Immich answered with an unexpected status (HTTP 429)')
  })

  it('is an error if the answer is not JSON, or not a list', async () => {
    const html = both(() => new Response('<html>' + KEY + '</html>', { headers: { 'Content-Type': 'text/html' } }))
    const notJson = await failure(html[0]())
    expect(notJson.message).toBe('Immich did not answer with JSON; check photos.immich.url')
    secrets(notJson)

    const object = both(() => jsonResponse({ message: 'hello' }))
    expect((await failure(object[0]())).message).toBe('Immich answered in a form that was not understood')
  })

  it('never logs the key or the address, in any mode', async () => {
    const cases: [Partial<Settings>, Handler][] = [
      [{ mode: 'albums', album_ids: [ALBUM_A, ALBUM_B] }, server()],
      [{ mode: 'random' }, server()],
      [{ mode: 'memories' }, server({ memories: [] })],
      [{ mode: 'random' }, () => new Response(null, { status: 401 })],
    ]
    for (const [changes, handler] of cases) {
      const { provider: immichProvider, log } = provider(changes, handler)
      await immichProvider.list().catch(() => undefined)
      await immichProvider.fetch(idOf('beach')).catch(() => undefined)
      const logged = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls])
      expect(logged).not.toContain(KEY)
      expect(logged).not.toContain('immich.example.test')
    }
  })
})
