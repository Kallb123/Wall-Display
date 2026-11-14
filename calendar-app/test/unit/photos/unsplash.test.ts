import { describe, expect, it } from 'vitest'
import { createUnsplashProvider, imageUrl } from '../../../server/photos/unsplash'
import type { UnsplashProviderOptions } from '../../../server/photos/unsplash'
import { PhotoProviderError } from '../../../server/photos/types'

// The Unsplash provider against a fake `fetch`: nothing here reaches a network.
// The fake keeps a record of every call, so the tests can say what was sent
// where, and above all that the key went to api.unsplash.com and nowhere else.

const KEY = 'unsplash-key-0123456789-SECRET'
type Settings = Parameters<typeof createUnsplashProvider>[0]
const settings = (changes: Partial<Settings> = {}): Settings => ({
  access_key: KEY,
  query: 'landscape',
  content_filter: 'high',
  count: 60,
  pick: 'fixed',
  refresh_minutes: 720,
  ...changes,
})

interface Call {
  url: URL
  headers: Record<string, string>
  init: RequestInit
}
type Handler = (call: Call) => Response | Promise<Response>

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
const imageResponse = () => new Response(new Uint8Array(JPEG), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })

/** A photo as Unsplash describes it, with a lot we don't use. */
const item = (id: string, changes: Record<string, unknown> = {}) => ({
  id,
  created_at: '2020-01-01T00:00:00Z',
  width: 6000,
  height: 4000,
  color: '#aabbcc',
  urls: { raw: `https://images.unsplash.com/photo-${id}?ixid=abc${id}&ixlib=rb-4.1.0`, full: 'https://images.unsplash.com/full', regular: 'https://images.unsplash.com/regular' },
  user: { name: `Photographer ${id}`, username: `p${id}` },
  links: { html: `https://unsplash.com/photos/${id}`, download_location: `https://api.unsplash.com/photos/${id}/download?ixid=abc${id}` },
  ...changes,
})
const ids = (prefix: string, count: number, from = 0) => Array.from({ length: count }, (_, i) => `${prefix}${from + i}`)
const photos = (prefix: string, count: number, from = 0) => ids(prefix, count, from).map(id => item(id))

function fake(handler: Handler) {
  const calls: Call[] = []
  const fetchStub = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = {
      url: new URL(input instanceof Request ? input.url : input.toString()),
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      init,
    }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
  return { calls, fetch: fetchStub }
}

function provider(changes: Partial<Settings>, handler: Handler, options: UnsplashProviderOptions = {}) {
  const stub = fake(handler)
  return { ...stub, provider: createUnsplashProvider(settings(changes), { fetch: stub.fetch, ...options }) }
}

const failure = async (job: Promise<unknown>) => {
  try {
    await job
  } catch (error) {
    expect(error).toBeInstanceOf(PhotoProviderError)
    return error as PhotoProviderError
  }
  throw new Error('expected a PhotoProviderError')
}

/** Lets the fire-and-forget request after a fetch go through. */
const settle = () => new Promise(resolve => setTimeout(resolve, 5))

/** A server of pages: `search` is the number of photos a search has, split in pages of 30. */
const searchServer = (total: number, prefix = 's'): Handler => (call) => {
  if (call.url.pathname !== '/search/photos') return new Response(null, { status: 404 })
  const page = Number(call.url.searchParams.get('page'))
  const all = photos(prefix, total)
  return jsonResponse({ total, total_pages: Math.ceil(total / 30), results: all.slice((page - 1) * 30, page * 30) })
}

describe('a search', () => {
  it('lists pages of 30 with the headers Unsplash wants, up to the count', async () => {
    const { provider: unsplash, calls } = provider({ query: 'mountain lake', count: 60, orientation: 'landscape', content_filter: 'low' }, searchServer(500))

    const listing = await unsplash.list()

    expect(unsplash.id).toBe('unsplash')
    expect(unsplash.source).toBe('unsplash')
    expect(unsplash.refreshIntervalMs).toBe(720 * 60_000)
    expect(listing).toHaveLength(60)
    expect(calls.map(call => `${call.url.origin}${call.url.pathname}`)).toEqual(['https://api.unsplash.com/search/photos', 'https://api.unsplash.com/search/photos'])
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ query: 'mountain lake', per_page: '30', page: '1', content_filter: 'low', orientation: 'landscape' })
    expect(calls[1]!.url.searchParams.get('page')).toBe('2')
    for (const call of calls) {
      expect(call.headers).toMatchObject({ 'Authorization': `Client-ID ${KEY}`, 'Accept-Version': 'v1' })
      expect(call.init.redirect).toBe('manual')
    }
  })

  it('describes each photo: its size, no date taken, and who to credit', async () => {
    const { provider: unsplash } = provider({}, () => jsonResponse({ total_pages: 1, results: [item('a1', { width: 4000.4, height: 6000 })] }))

    expect(await unsplash.list()).toEqual([
      { providerAssetId: 'a1', width: 4000, height: 6000, takenAt: null, credit: 'Photo by Photographer a1 on Unsplash' },
    ])
  })

  it('leaves orientation out when none is set, and stops at a short page', async () => {
    const { provider: unsplash, calls } = provider({ count: 300 }, searchServer(45))

    expect(await unsplash.list()).toHaveLength(45)

    expect(calls).toHaveLength(2)
    expect(calls[0]!.url.searchParams.has('orientation')).toBe(false)
  })

  it('stops after the last page a search says it has, even when that page is full', async () => {
    const { provider: unsplash, calls } = provider({ count: 300 }, searchServer(60))

    expect(await unsplash.list()).toHaveLength(60)
    expect(calls).toHaveLength(2)
  })

  it('asks for no more pages than the count needs', async () => {
    const { provider: unsplash, calls } = provider({ count: 31 }, searchServer(500))

    expect(await unsplash.list()).toHaveLength(31)
    expect(calls).toHaveLength(2)
  })

  it('skips photos that are odd rather than failing the listing', async () => {
    const results = [
      item('good1'),
      { id: 'no-urls', width: 1, height: 1 },
      'a string',
      null,
      item('bad id!'),
      item('plain-http', { urls: { raw: 'http://images.unsplash.com/photo-x?ixid=1' } }),
      item('other-host', { urls: { raw: 'https://evil.example.test/photo-x?ixid=1' } }),
      item('nameless', { user: { name: '   ' } }),
      item('no-download', { links: {} }),
      item('good2', { width: 'wide', height: null }),
      item('good1'),
    ]
    const { provider: unsplash } = provider({}, () => jsonResponse({ total_pages: 1, results }))

    const listing = await unsplash.list()

    // A photo listed twice counts once; the size of good2 is just unknown.
    expect(listing.map(entry => entry.providerAssetId)).toEqual(['good1', 'good2'])
    expect(listing[1]).not.toHaveProperty('width')
  })

  it('tidies a photographer name that has odd characters, and caps its length', async () => {
    const results = [item('a', { user: { name: `Jane\n  Doe\u0000${'x'.repeat(200)}` } })]
    const { provider: unsplash } = provider({}, () => jsonResponse({ total_pages: 1, results }))

    const [first] = await unsplash.list()

    expect(first!.credit).toMatch(/^Photo by Jane Doe x{70,80} on Unsplash$/)
    expect(first!.credit).not.toContain('\n')
    expect(first!.credit).not.toContain('\u0000')
  })
})

describe('collections', () => {
  const collectionsServer: Handler = (call) => {
    const match = /^\/collections\/([^/]+)\/photos$/.exec(call.url.pathname)
    if (!match) return new Response(null, { status: 404 })
    if (match[1] === '404404') return new Response('{"errors":["Couldn\'t find Collection"]}', { status: 404 })
    const page = Number(call.url.searchParams.get('page'))
    const all = photos(`c${match[1]}-`, match[1] === '111' ? 100 : 12)
    return jsonResponse(all.slice((page - 1) * 30, page * 30))
  }

  it('lists a collection\'s photos, a page at a time, with its orientation', async () => {
    const { provider: unsplash, calls } = provider({ query: undefined, collections: ['111'], count: 70, orientation: 'portrait' }, collectionsServer)

    expect(await unsplash.list()).toHaveLength(70)

    expect(calls.map(call => call.url.pathname)).toEqual(Array(3).fill('/collections/111/photos'))
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ per_page: '30', page: '1', orientation: 'portrait' })
  })

  it('splits the count across collections, dealing their photos out in turn', async () => {
    const { provider: unsplash, calls } = provider({ query: undefined, collections: ['111', '222'], count: 20 }, collectionsServer)

    const listing = await unsplash.list()

    // Ten from each, rounded up, one request for each.
    expect(calls.map(call => call.url.pathname)).toEqual(['/collections/111/photos', '/collections/222/photos'])
    expect(listing).toHaveLength(20)
    expect(listing.slice(0, 4).map(entry => entry.providerAssetId)).toEqual(['c111-0', 'c222-0', 'c111-1', 'c222-1'])
  })

  it('lists fewer than the count when the collections are small', async () => {
    const { provider: unsplash } = provider({ query: undefined, collections: ['111', '222'], count: 300 }, collectionsServer)

    expect(await unsplash.list()).toHaveLength(100 + 12)
  })

  it('refuses an id that could change the path, without asking', async () => {
    const { provider: unsplash, calls } = provider({ query: undefined, collections: ['1/../../me'] }, collectionsServer)

    expect((await failure(unsplash.list())).message).toBe('photos.unsplash.collections has an id that is not valid')
    expect(calls).toEqual([])
  })

  it('explains a collection that is not there', async () => {
    const { provider: unsplash } = provider({ query: undefined, collections: ['404404'] }, collectionsServer)

    expect((await failure(unsplash.list())).message).toBe('Unsplash has no such collection (HTTP 404)')
  })
})

describe('topics', () => {
  it('lists a topic\'s photos with its orientation, and leaves the content filter out, which a topic does not take', async () => {
    const { provider: unsplash, calls } = provider({ query: undefined, topics: ['nature'], count: 30, orientation: 'landscape', content_filter: 'high' }, (call) => {
      return call.url.pathname === '/topics/nature/photos' ? jsonResponse(photos('t', 30)) : new Response(null, { status: 404 })
    })

    expect(await unsplash.list()).toHaveLength(30)

    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ per_page: '30', page: '1', orientation: 'landscape' })
  })

  it('explains a topic that is not there, and refuses a slug that could change the path', async () => {
    const { provider: unsplash } = provider({ query: undefined, topics: ['nope'] }, () => new Response(null, { status: 404 }))
    expect((await failure(unsplash.list())).message).toBe('Unsplash has no such topic (HTTP 404)')

    const { provider: bad, calls } = provider({ query: undefined, topics: ['a?b=c'] }, () => jsonResponse([]))
    expect((await failure(bad.list())).message).toBe('photos.unsplash.topics has a topic that is not valid')
    expect(calls).toEqual([])
  })
})

describe('a feed of its own', () => {
  it('takes its id and name, and puts its id in its errors', async () => {
    const { provider: unsplash } = provider({}, () => new Response(null, { status: 401 }), { id: 'mountains', name: 'Mountains' })

    expect(unsplash).toMatchObject({ id: 'mountains', source: 'unsplash', name: 'Mountains' })
    expect((await failure(unsplash.list())).provider).toBe('mountains')
  })
})

describe('what Unsplash can answer', () => {
  const cases: [string, () => Response, string][] = [
    ['401', () => new Response(null, { status: 401 }), 'Unsplash refused the access key (HTTP 401)'],
    ['403 with the limit used up', () => new Response('Rate Limit Exceeded', { status: 403, headers: { 'X-Ratelimit-Remaining': '0' } }), 'Unsplash\'s hourly request limit was reached (HTTP 403); photos already known are kept'],
    ['403 that says rate limit', () => new Response('Rate Limit Exceeded', { status: 403 }), 'Unsplash\'s hourly request limit was reached (HTTP 403); photos already known are kept'],
    ['403 otherwise', () => new Response('OAuth error: The access token is invalid', { status: 403, headers: { 'X-Ratelimit-Remaining': '12' } }), 'Unsplash refused the access key (HTTP 403)'],
    ['404', () => new Response(null, { status: 404 }), 'Unsplash found nothing at that address (HTTP 404)'],
    ['500', () => new Response(null, { status: 500 }), 'Unsplash could not be reached: it answered with an error (HTTP 500)'],
    ['503', () => new Response(null, { status: 503 }), 'Unsplash could not be reached: it answered with an error (HTTP 503)'],
    ['a redirect', () => new Response(null, { status: 302, headers: { Location: `https://evil.example.test/?k=${KEY}` } }), 'Unsplash sent the request somewhere else (HTTP 302)'],
    ['a strange status', () => new Response(null, { status: 418 }), 'Unsplash answered with an unexpected status (HTTP 418)'],
    ['not JSON', () => new Response('<html>', { status: 200 }), 'Unsplash did not answer with JSON'],
    ['JSON of another shape', () => jsonResponse({ results: 'none' }), 'Unsplash answered in a form that was not understood'],
  ]
  it.each(cases)('%s', async (_name, respond, message) => {
    const { provider: unsplash } = provider({}, respond)

    const error = await failure(unsplash.list())

    expect(error.message).toBe(message)
    expect(error.message).not.toContain(KEY)
    expect(error.message).not.toMatch(/https?:/)
  })

  it('keeps what was listed when a later listing fails, so photos can still be fetched', async () => {
    let failing = false
    const { provider: unsplash } = provider({}, (call) => {
      if (call.url.pathname === '/search/photos') return failing ? new Response(null, { status: 500 }) : jsonResponse({ total_pages: 1, results: [item('a1')] })
      return imageResponse()
    })
    await unsplash.list()
    failing = true
    await failure(unsplash.list())

    expect(await unsplash.fetch('a1')).toEqual(JPEG)
  })

  it('does not leak the address or the key when the network fails', async () => {
    const { provider: unsplash } = provider({}, () => {
      throw Object.assign(new TypeError(`fetch failed: https://api.unsplash.com/?key=${KEY}`), { cause: { code: 'ECONNREFUSED' } })
    })

    const error = await failure(unsplash.list())

    expect(error.message).toBe('Unsplash could not be reached (ECONNREFUSED)')
  })

  it('gives up on an answer that does not come in time', async () => {
    const { provider: unsplash } = provider({}, (call) => new Promise<Response>((_resolve, reject) => {
      call.init.signal!.addEventListener('abort', () => reject(call.init.signal!.reason))
    }), { timeoutMs: 20 })

    expect((await failure(unsplash.list())).message).toBe('Unsplash could not be reached (no answer within 0.02 s)')
  })

  it('refuses an answer that is too big', async () => {
    const { provider: unsplash } = provider({}, () => new Response('{}', { status: 200, headers: { 'Content-Length': String(100 * 1024 * 1024) } }))

    expect((await failure(unsplash.list())).message).toBe('Unsplash sent more than 8 MB in one answer')
  })
})

describe('fetching a photo', () => {
  const server = (extra: Handler = () => imageResponse()): Handler => (call) => {
    if (call.url.pathname === '/search/photos') return jsonResponse({ total_pages: 1, results: [item('a1'), item('b2')] })
    return extra(call)
  }

  it('asks the image host for a display-sized JPEG, keeping Unsplash\'s own parameters, and sends it no key', async () => {
    const { provider: unsplash, calls } = provider({}, server())
    await unsplash.list()

    const bytes = await unsplash.fetch('a1')

    expect(bytes).toEqual(JPEG)
    const call = calls.find(candidate => candidate.url.hostname === 'images.unsplash.com')!
    expect(call).toBeDefined()
    expect(call.url.pathname).toBe('/photo-a1')
    expect(Object.fromEntries(call.url.searchParams)).toEqual({ ixid: 'abca1', ixlib: 'rb-4.1.0', w: '2560', h: '2560', fit: 'max', fm: 'jpg', q: '85' })
    expect(Object.keys(call.headers).map(name => name.toLowerCase())).not.toContain('authorization')
    expect(JSON.stringify(call.headers)).not.toContain(KEY)
    expect(call.init.redirect).toBe('manual')
  })

  it('replaces a size that was already on the raw address', async () => {
    expect(imageUrl('https://images.unsplash.com/photo-1?ixid=x&w=100&q=10&fit=crop')).toBe('https://images.unsplash.com/photo-1?ixid=x&w=2560&q=85&fit=max&h=2560&fm=jpg')
  })

  it('refuses addresses that are not Unsplash\'s image host over https', () => {
    for (const raw of ['http://images.unsplash.com/a', 'https://api.unsplash.com/a', 'https://images.unsplash.com.evil.test/a', 'https://user:pw@images.unsplash.com/a', 'https://images.unsplash.com:8443/a', 'not a url', 'file:///etc/passwd']) {
      expect(imageUrl(raw), raw).toBeNull()
    }
  })

  it('tells Unsplash the photo was used, once, with the key, to api.unsplash.com only', async () => {
    const { provider: unsplash, calls } = provider({}, server((call) => call.url.hostname === 'images.unsplash.com' ? imageResponse() : jsonResponse({ url: 'https://images.unsplash.com/x' })))
    await unsplash.list()

    await unsplash.fetch('a1')
    await settle()
    await unsplash.fetch('a1')
    await unsplash.fetch('b2')
    await settle()

    const downloads = calls.filter(call => call.url.pathname.endsWith('/download'))
    expect(downloads.map(call => call.url.pathname)).toEqual(['/photos/a1/download', '/photos/b2/download'])
    expect(downloads[0]!.url.searchParams.get('ixid')).toBe('abca1')
    expect(downloads[0]!.headers).toMatchObject({ 'Authorization': `Client-ID ${KEY}`, 'Accept-Version': 'v1' })
    // The key goes to the API and to nothing else.
    for (const call of calls.filter(call => call.headers.Authorization !== undefined)) expect(call.url.origin).toBe('https://api.unsplash.com')
  })

  it('does not call a download address that is not on api.unsplash.com over https', async () => {
    const results = [
      item('a1', { links: { download_location: 'https://evil.example.test/photos/a1/download' } }),
      item('b2', { links: { download_location: 'http://api.unsplash.com/photos/b2/download' } }),
    ]
    const { provider: unsplash, calls } = provider({}, (call) => call.url.pathname === '/search/photos' ? jsonResponse({ total_pages: 1, results }) : imageResponse())
    await unsplash.list()

    await unsplash.fetch('a1')
    await unsplash.fetch('b2')
    await settle()

    expect(calls.filter(call => call.url.hostname !== 'images.unsplash.com' && call.url.pathname !== '/search/photos')).toEqual([])
  })

  it('does not mind if reporting the download fails', async () => {
    const { provider: unsplash, calls } = provider({}, server((call) => {
      if (call.url.hostname === 'api.unsplash.com') throw new Error(`boom ${KEY}`)
      return imageResponse()
    }))
    await unsplash.list()

    expect(await unsplash.fetch('a1')).toEqual(JPEG)
    await settle()

    expect(calls.some(call => call.url.pathname === '/photos/a1/download')).toBe(true)
  })

  it('does not report a photo that could not be fetched', async () => {
    const { provider: unsplash, calls } = provider({}, server(() => new Response(null, { status: 500 })))
    await unsplash.list()

    await failure(unsplash.fetch('a1'))
    await settle()

    expect(calls.some(call => call.url.pathname.endsWith('/download'))).toBe(false)
  })

  it('refuses a photo it has not listed, or an id that is not one, without asking', async () => {
    const { provider: unsplash, calls } = provider({}, server())

    expect((await failure(unsplash.fetch('a1'))).message).toBe('That photo has not been listed from Unsplash yet')
    expect((await failure(unsplash.fetch('../x'))).message).toBe('That is not a photo from Unsplash')
    expect(calls).toEqual([])
  })

  it('explains the ways an image can fail, without an address or the key', async () => {
    const cases: [Response, string][] = [
      [new Response(null, { status: 404 }), 'That photo is no longer on Unsplash (HTTP 404)'],
      [new Response(null, { status: 502 }), 'Unsplash could not be reached: it answered with an error (HTTP 502)'],
      [new Response(null, { status: 302, headers: { Location: 'https://evil.example.test/' } }), 'Unsplash sent the request somewhere else (HTTP 302)'],
      [new Response(null, { status: 403 }), 'Unsplash answered with an unexpected status (HTTP 403)'],
      [new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), 'Unsplash did not send an image'],
      [new Response(new Uint8Array(0), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }), 'Unsplash did not send an image'],
      [new Response(new Uint8Array(JPEG), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(64 * 1024 * 1024) } }), 'Unsplash sent more than 32 MB in one answer'],
    ]
    for (const [response, message] of cases) {
      const { provider: unsplash } = provider({}, server(() => response))
      await unsplash.list()
      const error = await failure(unsplash.fetch('a1'))
      expect(error.message).toBe(message)
    }
  })

  it('forgets the photos of an earlier listing', async () => {
    let results = [item('a1')]
    const { provider: unsplash } = provider({}, (call) => call.url.pathname === '/search/photos' ? jsonResponse({ total_pages: 1, results }) : imageResponse())
    await unsplash.list()
    results = [item('b2')]
    await unsplash.list()

    await failure(unsplash.fetch('a1'))
    expect(await unsplash.fetch('b2')).toEqual(JPEG)
  })
})

describe('a random pick', () => {
  /** `/photos/random`: answers `count` photos, new ones each time (`r0`, `r1`, ...), unless the pool is `limit` photos. */
  const randomServer = (limit = Infinity) => {
    let next = 0
    const handler: Handler = (call) => {
      if (call.url.pathname !== '/photos/random') return call.url.hostname === 'images.unsplash.com' ? imageResponse() : new Response(null, { status: 404 })
      const asked = Number(call.url.searchParams.get('count'))
      const given = Math.max(0, Math.min(asked, limit - next))
      const batch = photos('r', given, next)
      next += given
      return jsonResponse(batch)
    }
    return handler
  }
  const random = (changes: Partial<Settings>, handler: Handler, options: UnsplashProviderOptions = {}) => provider({ pick: 'random', ...changes }, handler, options)

  it('asks /photos/random for a search, with its orientation and content filter', async () => {
    const { provider: unsplash, calls } = random({ query: 'mountain lake', count: 20, orientation: 'landscape', content_filter: 'low' }, randomServer())

    const listing = await unsplash.list()

    expect(listing).toHaveLength(20)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url.pathname).toBe('/photos/random')
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ query: 'mountain lake', count: '20', orientation: 'landscape', content_filter: 'low' })
    expect(calls[0]!.headers).toMatchObject({ 'Authorization': `Client-ID ${KEY}`, 'Accept-Version': 'v1' })
    expect(calls[0]!.init.redirect).toBe('manual')
  })

  it('sends collections as one comma-separated list, and no query', async () => {
    const { provider: unsplash, calls } = random({ query: undefined, collections: ['111', '222'], count: 5 }, randomServer())

    await unsplash.list()

    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ collections: '111,222', count: '5', content_filter: 'high' })
  })

  it('sends topics as one comma-separated list, and no query', async () => {
    const { provider: unsplash, calls } = random({ query: undefined, topics: ['nature', 'travel'], count: 5, orientation: 'squarish' }, randomServer())

    await unsplash.list()

    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ topics: 'nature,travel', count: '5', orientation: 'squarish', content_filter: 'high' })
  })

  it('makes a request for each 30 photos, asking only for what is still needed', async () => {
    const { provider: unsplash, calls } = random({ count: 70 }, randomServer())

    expect(await unsplash.list()).toHaveLength(70)

    expect(calls.map(call => call.url.searchParams.get('count'))).toEqual(['30', '30', '10'])
  })

  it('stops at a request that gave fewer than it was asked for', async () => {
    const { provider: unsplash, calls } = random({ count: 90 }, randomServer(40))

    expect(await unsplash.list()).toHaveLength(40)

    expect(calls).toHaveLength(2)
  })

  it('lists a photo that came in two requests once', async () => {
    const { provider: unsplash } = random({ count: 60 }, (call) => jsonResponse(photos('d', Number(call.url.searchParams.get('count')))))

    expect((await unsplash.list()).map(entry => entry.providerAssetId)).toEqual(ids('d', 30))
  })

  it('refuses an id that could change the request, without asking', async () => {
    const { provider: unsplash, calls } = random({ query: undefined, collections: ['1,2&query=x'] }, randomServer())

    expect((await failure(unsplash.list())).message).toBe('photos.unsplash.collections has an id that is not valid')
    expect(calls).toEqual([])
  })

  it('brings new photos at each listing and keeps the ones shown, newest shown last, for the pool', async () => {
    const { provider: unsplash } = random({ count: 3 }, randomServer())
    await unsplash.list()
    await unsplash.fetch('r0')
    await unsplash.fetch('r1')

    const second = (await unsplash.list()).map(entry => entry.providerAssetId)

    // The new three first, then what was shown; r2 was never shown, so it is gone.
    expect(second).toEqual(['r3', 'r4', 'r5', 'r0', 'r1'])
    // A kept photo can still be fetched, though the request did not give it again.
    expect(await unsplash.fetch('r1')).toEqual(JPEG)
  })

  it('does not list a shown photo twice when Unsplash gives it again, and moves it to the newest', async () => {
    let batch = [item('a'), item('b')]
    const { provider: unsplash } = random({ count: 2 }, (call) => call.url.pathname === '/photos/random' ? jsonResponse(batch) : imageResponse())
    await unsplash.list()
    await unsplash.fetch('a')
    await unsplash.fetch('b')
    await unsplash.fetch('a')
    batch = [item('a'), item('c')]

    expect((await unsplash.list()).map(entry => entry.providerAssetId)).toEqual(['a', 'c', 'b'])
  })

  it('keeps the photos shown lately when Unsplash fails, so they keep rotating', async () => {
    let failing = false
    const { provider: unsplash } = random({ count: 2 }, (call) => {
      if (call.url.pathname !== '/photos/random') return imageResponse()
      return failing ? new Response(null, { status: 403, headers: { 'X-Ratelimit-Remaining': '0' } }) : jsonResponse(photos('r', 2))
    })
    await unsplash.list()
    await unsplash.fetch('r0')
    failing = true
    await failure(unsplash.list())

    // The pool as it was is what is fetched from.
    expect(await unsplash.fetch('r1')).toEqual(JPEG)
  })

  it('keeps at most 100 shown photos, the oldest dropped first', async () => {
    // Five batches of 30 listed in turn, with every photo shown.
    let batchStart = 0
    const server = (call: Call) => call.url.pathname === '/photos/random' ? jsonResponse(photos('r', 30, batchStart)) : imageResponse()
    const { provider: many } = random({ count: 30 }, server)
    for (; batchStart < 150; batchStart += 30) {
      await many.list()
      for (const id of ids('r', 30, batchStart)) await many.fetch(id)
    }
    batchStart = 1000

    const listing = (await many.list()).map(entry => entry.providerAssetId)

    expect(listing).toHaveLength(30 + 100)
    // The newest 100 shown are r50 to r149, the oldest of them last in the pool.
    expect(listing.slice(30)).toEqual(ids('r', 100, 50))
  })

  it('drops a photo that is gone (404) from the ones kept', async () => {
    let gone = false
    const { provider: unsplash } = random({ count: 2 }, (call) => {
      if (call.url.pathname === '/photos/random') return jsonResponse(photos('r', 2, gone ? 10 : 0))
      return gone && call.url.pathname === '/photo-r0' ? new Response(null, { status: 404 }) : imageResponse()
    })
    await unsplash.list()
    await unsplash.fetch('r0')
    await unsplash.fetch('r1')
    gone = true
    await unsplash.list()
    expect((await failure(unsplash.fetch('r0'))).message).toBe('That photo is no longer on Unsplash (HTTP 404)')

    expect((await unsplash.list()).map(entry => entry.providerAssetId)).toEqual(['r10', 'r11', 'r1'])
  })

  it('shows what each listing found and nothing is kept in fixed mode', async () => {
    const { provider: unsplash } = provider({ pick: 'fixed' }, (call) => call.url.pathname === '/search/photos' ? jsonResponse({ total_pages: 1, results: [item('a1')] }) : imageResponse())
    await unsplash.list()
    await unsplash.fetch('a1')

    expect((await unsplash.list()).map(entry => entry.providerAssetId)).toEqual(['a1'])
    expect((await failure(unsplash.fetch('zz'))).message).toBe('That photo has not been listed from Unsplash yet')
  })
})

describe('download pings and the request limit', () => {
  /** Listing answers say how many requests are left, as set by `left`; pings and images are answered plainly. */
  function budget(initial: number | null) {
    const state = { left: initial as number | null, status: 200 }
    const handler: Handler = (call) => {
      if (call.url.hostname === 'images.unsplash.com') return imageResponse()
      const headers: Record<string, string> = state.left === null ? {} : { 'X-Ratelimit-Remaining': String(state.left) }
      if (call.url.pathname === '/search/photos') {
        if (state.status !== 200) return new Response('Rate Limit Exceeded', { status: state.status, headers })
        return jsonResponse({ total_pages: 1, results: photos('p', 5) }, 200, headers)
      }
      return jsonResponse({ url: 'https://images.unsplash.com/x' }, 200, headers)
    }
    return { state, handler }
  }
  const pings = (calls: Call[]) => calls.filter(call => call.url.pathname.endsWith('/download')).map(call => call.url.pathname)
  const logger = () => {
    const lines: string[] = []
    return { lines, log: { info: (line: string) => lines.push(line), warn: (line: string) => lines.push(line) } }
  }

  it('pings while the budget is not known or is above the reserve', async () => {
    const { state, handler } = budget(null)
    const { provider: unsplash, calls } = provider({ pick: 'fixed' }, handler)
    await unsplash.list()
    await unsplash.fetch('p0')
    await settle()
    state.left = 40
    await unsplash.list()
    await unsplash.fetch('p1')
    await settle()

    expect(pings(calls)).toEqual(['/photos/p0/download', '/photos/p1/download'])
  })

  it('skips pings while fewer than 10 requests are left, logging once, and resumes when a listing shows the budget is back', async () => {
    const { state, handler } = budget(9)
    const { lines, log } = logger()
    const { provider: unsplash, calls } = provider({ pick: 'fixed' }, handler, { log })
    await unsplash.list()

    await unsplash.fetch('p0')
    await unsplash.fetch('p1')
    await settle()
    expect(pings(calls)).toEqual([])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/not reported to it until there is room again/)

    state.left = 10
    await unsplash.list()
    // The skipped photo was not marked as reported, so it is pinged now.
    await unsplash.fetch('p0')
    await unsplash.fetch('p2')
    await settle()

    expect(pings(calls)).toEqual(['/photos/p0/download', '/photos/p2/download'])
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/reported to it again/)
    for (const line of lines) {
      expect(line).not.toContain(KEY)
      expect(line).not.toMatch(/https?:/)
    }
  })

  it('learns the budget from the answer to a ping too', async () => {
    const { state, handler } = budget(null)
    const { provider: unsplash, calls } = provider({ pick: 'fixed' }, handler)
    await unsplash.list()
    state.left = 3
    await unsplash.fetch('p0')
    await settle()
    await unsplash.fetch('p1')
    await settle()

    expect(pings(calls)).toEqual(['/photos/p0/download'])
  })

  it('stops pinging after a rate-limit answer, until an answer shows the budget back above the reserve', async () => {
    const { state, handler } = budget(30)
    const { lines, log } = logger()
    const { provider: unsplash, calls } = provider({ pick: 'fixed' }, handler, { log })
    await unsplash.list()
    // A 403 that says rate limit, with no header at all.
    state.left = null
    state.status = 403
    await failure(unsplash.list())

    await unsplash.fetch('p0')
    await settle()
    expect(pings(calls)).toEqual([])
    expect(lines).toHaveLength(1)

    state.status = 200
    state.left = 25
    await unsplash.list()
    await unsplash.fetch('p0')
    await settle()

    expect(pings(calls)).toEqual(['/photos/p0/download'])
    expect(lines).toHaveLength(2)
  })

  it('does not take a header that is not a number for a budget', async () => {
    const { provider: unsplash, calls } = provider({ pick: 'fixed' }, (call) => call.url.pathname === '/search/photos'
      ? jsonResponse({ total_pages: 1, results: photos('p', 1) }, 200, { 'X-Ratelimit-Remaining': 'lots' })
      : imageResponse())
    await unsplash.list()
    await unsplash.fetch('p0')
    await settle()

    expect(pings(calls)).toEqual(['/photos/p0/download'])
  })
})
