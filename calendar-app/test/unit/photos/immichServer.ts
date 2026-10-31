import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A fake Immich for the tests: answers replayed from test/fixtures/immich/ (made
// by scripts/make-immich-fixtures.mjs) through a stub `fetch`, so nothing reaches
// a network, and a record of every call that was made.

const fixtureDir = join(import.meta.dirname, '../../fixtures/immich')
export const fixture = (name: string) => readFileSync(join(fixtureDir, name))
export const json = (name: string) => JSON.parse(fixture(name).toString()) as unknown
export const thumbnail = () => fixture('thumbnail.jpg')

type Item = { id: string, originalFileName: string }
const items = (name: string, pick: (answer: any) => Item[] = answer => answer.assets.items) => pick(json(name)) // eslint-disable-line @typescript-eslint/no-explicit-any
/** The id of a fixture photo, by its name. */
export const ids = new Map<string, string>(
  [
    ...items('search-metadata-album-a-page-1.json'),
    ...items('search-metadata-album-a-page-2.json'),
    ...items('search-metadata-album-b.json'),
    ...items('search-random.json', answer => answer),
    ...(json('memories.json') as { assets: Item[] }[]).flatMap(memory => memory.assets),
  ].map(item => [item.originalFileName.replace(/\.\w+$/, ''), item.id]),
)
export const idOf = (name: string): string => {
  const found = ids.get(name)
  if (!found) throw new Error(`no fixture photo ${name}`)
  return found
}

export const ALBUM_A = '0b6a1c52-7a3e-4a47-9c1d-1d8d4a8f1a01'
export const ALBUM_B = '9d2f4e6a-5b1c-4f3a-8a7e-2c4b6d8e0f02'
export const PERSON = '5c7e9a1b-3d5f-4b7a-9c2e-4f6a8b0c2d03'
export const KEY = 'imm-key-0123456789-SECRET-abcdef'
export const BASE = 'http://immich.example.test:2283'

export interface Call {
  method: string
  url: URL
  headers: Record<string, string>
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any
  init: RequestInit
}

export type Handler = (call: Call) => Response | Promise<Response>

export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
export const imageResponse = () => new Response(new Uint8Array(thumbnail()), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })

/** An Immich that answers from the fixtures: what the stubbed `fetch` runs. */
export function immich(handler: Handler) {
  const calls: Call[] = []
  const fetchStub = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      init,
    }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
  return { calls, fetch: fetchStub }
}

/** The usual server: albums A and B, a random pick, memories, and thumbnails. */
export const server = (overrides: { memories?: unknown, random?: unknown } = {}): Handler => (call) => {
  const path = call.url.pathname
  if (path === '/api/search/metadata') {
    if (call.body.albumIds[0] === ALBUM_A) return jsonResponse(json(call.body.page === 1 ? 'search-metadata-album-a-page-1.json' : 'search-metadata-album-a-page-2.json'))
    if (call.body.albumIds[0] === ALBUM_B) return jsonResponse(json('search-metadata-album-b.json'))
  }
  if (path === '/api/search/random') return jsonResponse(overrides.random ?? json('search-random.json'))
  if (path === '/api/memories') return jsonResponse(overrides.memories ?? json('memories.json'))
  if (/^\/api\/assets\/[^/]+\/thumbnail$/.test(path)) return imageResponse()
  return new Response(null, { status: 404 })
}

