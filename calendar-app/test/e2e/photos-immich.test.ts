import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { photoResponseSchema } from '../../shared/photos'

// The photo routes with `photos.immich` pointing at a small fake Immich on a
// random local port (it answers from test/fixtures/immich/, as the real one
// does, and wants the API key): the first photo is rendered into the cache from
// Immich's preview, and once the fake is stopped the photos in the cache keep
// rotating. The tests build on each other.
describe('photos from Immich', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const fixtures = join(appDir, 'test', 'fixtures', 'immich')
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const fixture = (name: string) => readFileSync(join(fixtures, name))
  const album = '0b6a1c52-7a3e-4a47-9c1d-1d8d4a8f1a01'
  const apiKey = 'immich-e2e-key-0123456789abcdef'
  // The album has two pages, as a big one would: nextPage "2" and then null.
  const photoIds = new Set<string>()
  for (const page of ['search-metadata-album-a-page-1.json', 'search-metadata-album-a-page-2.json']) {
    for (const item of JSON.parse(fixture(page).toString()).assets.items as { id: string, type: string }[]) {
      if (item.type === 'IMAGE') photoIds.add(`immich:${item.id}`)
    }
  }
  expect(photoIds.size).toBe(5)

  const seen: { method: string | undefined, url: string | undefined, headers: IncomingHttpHeaders, body: string }[] = []
  const immich = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      seen.push({ method: request.method, url: request.url, headers: request.headers, body })
      if (request.headers['x-api-key'] !== apiKey) {
        response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Invalid API key' }))
        return
      }
      if (request.method === 'POST' && request.url === '/api/search/metadata') {
        const page = (JSON.parse(body) as { page: number }).page
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(fixture(`search-metadata-album-a-page-${page}.json`))
      } else if (request.method === 'GET' && /^\/api\/assets\/[0-9a-f-]{36}\/thumbnail\?size=preview$/.test(request.url ?? '')) {
        response.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(fixture('thumbnail.jpg'))
      } else {
        response.writeHead(404).end()
      }
    })
  })
  await new Promise<void>(resolve => immich.listen(0, '127.0.0.1', resolve))
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    immich.closeAllConnections()
    await new Promise(resolve => immich.close(resolve))
  }
  afterAll(stop)

  const port = (immich.address() as AddressInfo).port
  const devConfig = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)
  const photosAt = devConfig.indexOf('\nphotos:\n')
  expect(photosAt).toBeGreaterThan(0)
  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${devConfig.slice(0, photosAt)}
photos:
  interval_seconds: 15
  immich:
    url: http://127.0.0.1:${port}
    api_key: ${apiKey}
    album_ids: ["${album}"]
`)

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const next = async () => photoResponseSchema.parse(await $fetch('/api/photos/next?display=hallway')).photo

  it('answers an Immich photo, rendered into the cache from its preview', async () => {
    const response = await fetch('/api/photos/next?display=hallway')
    expect(response.status).toBe(200)
    const { photo } = photoResponseSchema.parse(await response.json())

    expect(photo).not.toBeNull()
    expect(photo!.provider).toBe('immich')
    expect(photoIds.has(photo!.id)).toBe(true)
    // The size the preview turned out to have (the fixture is 480x270).
    expect([photo!.width, photo!.height, photo!.orientation]).toEqual([480, 270, 'landscape'])
    expect(photo!.taken_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const image = await fetch(photo!.url)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/webp')
    expect(await sharp(Buffer.from(await image.arrayBuffer())).metadata()).toMatchObject({ format: 'webp', width: 2560, height: 1440 })
  })

  it('asked Immich with the key in the header, for the preview and never the original', () => {
    const listings = seen.filter(call => call.url === '/api/search/metadata')
    expect(listings.map(call => JSON.parse(call.body))).toEqual([
      { albumIds: [album], type: 'IMAGE', page: 1, size: 1000, withExif: true },
      { albumIds: [album], type: 'IMAGE', page: 2, size: 1000, withExif: true },
    ])
    const downloads = seen.filter(call => call.url?.includes('/assets/'))
    expect(downloads.length).toBeGreaterThanOrEqual(1)
    for (const call of downloads) expect(call.url).toMatch(/\/thumbnail\?size=preview$/)
    for (const call of seen) {
      expect(call.headers['x-api-key']).toBe(apiKey)
      expect(call.url).not.toContain(apiKey)
    }
  })

  it('shows every photo of the album once before any repeats, and nothing secret is in the answers', async () => {
    const round = new Set<string>()
    const texts: string[] = []
    // One has been shown already, so four more are the rest of the round.
    for (let i = 0; i < 4; i++) {
      const photo = (await next())!
      round.add(photo.id)
      texts.push(JSON.stringify(photo))
    }

    expect(round.size).toBe(4)
    for (const text of texts) {
      expect(text).not.toContain(apiKey)
      expect(text).not.toContain(String(port))
    }
  })

  it('keeps rotating the photos in the cache once Immich is stopped', async () => {
    // Every photo of the album has been shown, so all of them are in the cache.
    await stop()
    const before = seen.length

    const shown = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const photo = await next()
      expect(photo, `request ${i}`).not.toBeNull()
      expect(photo!.provider).toBe('immich')
      expect((await fetch(photo!.url)).status).toBe(200)
      shown.add(photo!.id)
    }

    expect(shown.size).toBe(5)
    expect(seen.length).toBe(before)
  })
})
