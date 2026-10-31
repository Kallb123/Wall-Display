import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { photoResponseSchema } from '../../shared/photos'
import type { PhotoInfo } from '../../shared/photos'

// The photo routes on the dev config, with `photos.local.path` pointing at the
// fixture photos by an absolute path (the config is copied to a temporary folder,
// so its relative path would not find them). The tests build on each other.
describe('the photo routes', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  const devConfig = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8')
  expect(devConfig).toContain('path: ./test/fixtures/photos')
  writeFileSync(configFile, devConfig
    .replaceAll('file:./', `file:${appDir}/`)
    .replace('path: ./test/fixtures/photos', `path: ${appDir}/test/fixtures/photos`))
  const photoDir = join(dir, 'data', 'photos')

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const next = async (display = 'hallway') => photoResponseSchema.parse(await $fetch(`/api/photos/next?display=${display}`)).photo
  const message = async (response: Response) => ((await response.json()) as { message: string }).message

  /** The four fixtures, by the shape they should come back as. */
  const SHAPES: Record<string, [number, number, PhotoInfo['orientation']]> = {
    'local:sunset-landscape.jpg': [1280, 720, 'landscape'],
    'local:tall-portrait.jpg': [720, 1080, 'portrait'],
    'local:trip/square-rings.jpg': [800, 800, 'landscape'],
    // Stored 960×640 with an EXIF orientation of 6.
    'local:trip/phone-rotated.jpg': [640, 960, 'portrait'],
  }

  describe('GET /api/photos/next', () => {
    it('is a 400 without a display, and with an empty or repeated one', async () => {
      for (const query of ['', '?display=', '?display=hallway&display=hallway']) {
        const response = await fetch(`/api/photos/next${query}`)
        expect(response.status, query).toBe(400)
        expect(await message(response)).toBe('display is required')
      }
    })

    it('is a 404 for a display that is not in the config', async () => {
      const response = await fetch('/api/photos/next?display=attic')

      expect(response.status).toBe(404)
      expect(await message(response)).toContain('attic')
    })

    let first: PhotoInfo

    it('answers a photo from the folder, and is never cached', async () => {
      const response = await fetch('/api/photos/next?display=hallway')

      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const { photo } = photoResponseSchema.parse(await response.json())
      expect(photo).not.toBeNull()
      first = photo!
      expect(first.provider).toBe('local')
      expect(first.id in SHAPES).toBe(true)
      expect([first.width, first.height, first.orientation]).toEqual(SHAPES[first.id])
      expect(first.url).toMatch(/^\/photos\/[0-9a-f]{64}\.webp$/)
      expect(first.taken_at).toBeNull()
      // The server's own paths are not in the answer.
      expect(JSON.stringify(first)).not.toContain(appDir)
    })

    it('shows every photo once before any repeats, with their true shapes', async () => {
      const round = [first]
      for (let i = 0; i < 3; i++) round.push((await next())!)
      const again = []
      for (let i = 0; i < 4; i++) again.push((await next())!)

      expect(new Set(round.map(photo => photo.id)).size).toBe(4)
      expect(new Set(again.map(photo => photo.id)).size).toBe(4)
      expect(again[0]!.id).not.toBe(round[3]!.id)
      for (const photo of [...round, ...again]) expect([photo.width, photo.height, photo.orientation]).toEqual(SHAPES[photo.id])
    })

    it('does not move on when asked for a display that does not exist', async () => {
      await fetch('/api/photos/next?display=attic')

      expect((await next())).not.toBeNull()
    })

    it('goes on, whatever the display\'s photo source, when only the folder is set up', async () => {
      const state = await $fetch<{ photo_source: string }>('/api/displays/hallway/state')
      expect(state.photo_source).toBe('immich')

      await $fetch('/api/displays/hallway/commands', { method: 'POST', body: { type: 'set_photo_source', photo_source: 'google' } })

      expect((await next())!.provider).toBe('local')
    })
  })

  describe('GET /photos/:name', () => {
    it('serves a rendered photo as a 2560×1440 WebP, cached for good', async () => {
      const photo = (await next())!

      const response = await fetch(photo.url)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/webp')
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      const bytes = Buffer.from(await response.arrayBuffer())
      expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 2560, height: 1440 })
      expect(bytes.length).toBeLessThan(500_000)
    })

    it('is the file in the photos folder of the data directory, named after its hash', () => {
      const files = readdirSync(photoDir)

      expect(files.length).toBeGreaterThanOrEqual(4)
      for (const file of files) expect(file).toMatch(/^[0-9a-f]{64}\.webp$/)
    })

    it('is a 404 for a name that is not a photo', async () => {
      const names = [
        `${'0'.repeat(64)}.webp`, // the right shape, but no such file
        `${'A'.repeat(64)}.webp`,
        `${'0'.repeat(63)}.webp`,
        `${'0'.repeat(64)}.png`,
        `${'0'.repeat(64)}.svg`,
        `${'0'.repeat(64)}.webp.bak`,
        '..%2F..%2Fwallcal.db',
        '..%2fwallcal.db',
        '%2e%2e%2fwallcal.db',
        '..%5Cwallcal.db',
        'wallcal.db',
        `${readdirSync(photoDir)[0]}%00.webp`,
        `.${readdirSync(photoDir)[0]}`,
      ]
      for (const name of names) {
        const response = await fetch(`/photos/${name}`)
        expect(response.status, name).toBe(404)
        expect(response.headers.get('content-type') ?? '', name).not.toContain('image/')
      }
    })

    it('never serves a file for a path that has more than one part', async () => {
      // These don't reach the route at all (the app answers them as it does any page), but they must not give a file.
      const file = readdirSync(photoDir)[0]!
      for (const path of ['/photos/', `/photos/${file}/x`, '/photos/....//wallcal.db', `/photos//${file}`, '/photos/..', '/photos/%2e%2e', '/photos/../wallcal.db']) {
        const response = await fetch(path)
        const bytes = Buffer.from(await response.arrayBuffer())
        expect(response.headers.get('content-type') ?? '', path).not.toContain('image/')
        expect(bytes.subarray(0, 15).toString(), path).not.toBe('SQLite format 3')
      }
    })

    it('is a 404 once a file has gone', async () => {
      const photo = (await next())!
      const file = join(photoDir, photo.url.split('/').pop()!)
      expect(existsSync(file)).toBe(true)
      const { rmSync: remove } = await import('node:fs')
      remove(file)

      expect((await fetch(photo.url)).status).toBe(404)
    })
  })
})
