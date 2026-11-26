import { describe, expect, it } from 'vitest'
import { load, loadError, minimalConfig } from './helpers'

const ALBUM = '0b6a1c52-7a3e-4a47-9c1d-1d8d4a8f1a01'
const PERSON = '5c7e9a1b-3d5f-4b7a-9c2e-4f6a8b0c2d03'

async function immich(block: Record<string, unknown>) {
  const raw = minimalConfig()
  raw.photos = { immich: { url: 'http://immich.local:2283', api_key: 'k', ...block } }
  return (await load({ config: raw })).config.photos!.immich!
}

async function problem(block: Record<string, unknown>): Promise<string> {
  const raw = minimalConfig()
  raw.photos = { immich: { url: 'http://immich.local:2283', api_key: 'k', ...block } }
  return (await loadError({ config: raw })).message
}

describe('photos.immich', () => {
  describe('mode', () => {
    it('is albums when there are album ids, and random when there are none', async () => {
      expect((await immich({ album_ids: [ALBUM] })).mode).toBe('albums')
      expect((await immich({})).mode).toBe('random')
      expect((await immich({ album_ids: [] })).mode).toBe('random')
    })

    it('can be set, whatever the album ids', async () => {
      expect((await immich({ mode: 'random', album_ids: [ALBUM] })).mode).toBe('random')
      expect((await immich({ mode: 'memories' })).mode).toBe('memories')
      expect((await immich({ mode: 'albums', album_ids: [ALBUM] })).mode).toBe('albums')
    })

    it('is an error for albums without any album ids', async () => {
      const message = await problem({ mode: 'albums' })

      expect(message).toContain('photos.immich.album_ids')
      expect(message).toContain('mode "albums" needs at least one album id')
    })

    it('is an error for a mode that does not exist', async () => {
      expect(await problem({ mode: 'favourites' })).toContain('photos.immich.mode')
    })
  })

  describe('random', () => {
    it('has defaults: 200 photos, no filters', async () => {
      expect((await immich({})).random).toEqual({ count: 200, person_ids: [] })
      expect((await immich({ random: {} })).random).toEqual({ count: 200, person_ids: [] })
    })

    it('takes a count, people and dates', async () => {
      const { random } = await immich({ random: { count: 1000, person_ids: [PERSON], taken_after: '2023-01-01', taken_before: '2023-12-31' } })

      expect(random).toEqual({
        count: 1000,
        person_ids: [PERSON],
        // A bare day starts at midnight UTC for "after" and ends at the last millisecond for "before".
        taken_after: '2023-01-01T00:00:00.000Z',
        taken_before: '2023-12-31T23:59:59.999Z',
      })
    })

    it('takes a date and time, which is written out in UTC', async () => {
      const { random } = await immich({ random: { taken_after: '2024-03-10T09:30:00+01:00', taken_before: '2024-03-10T12:00:00Z' } })

      expect(random.taken_after).toBe('2024-03-10T08:30:00.000Z')
      expect(random.taken_before).toBe('2024-03-10T12:00:00.000Z')
    })

    it.each([
      ['a count of 0', { count: 0 }, 'photos.immich.random.count'],
      ['a count above 1000', { count: 1001 }, 'photos.immich.random.count'],
      ['a fractional count', { count: 2.5 }, 'photos.immich.random.count'],
      ['a person id that is not a UUID', { person_ids: ['mum'] }, 'photos.immich.random.person_ids[0]'],
      ['a date that is not one', { taken_after: 'last year' }, 'photos.immich.random.taken_after'],
      ['a day that does not exist', { taken_before: '2023-02-30' }, 'photos.immich.random.taken_before'],
      ['a month that does not exist', { taken_after: '2023-13-01' }, 'photos.immich.random.taken_after'],
      ['a time without a zone', { taken_after: '2023-01-01T10:00:00' }, 'photos.immich.random.taken_after'],
      ['an unknown setting', { limit: 5 }, 'photos.immich.random.limit: unknown setting'],
      ['dates the wrong way round', { taken_after: '2024-01-01', taken_before: '2023-01-01' }, 'taken_after must be earlier than taken_before'],
    ])('is an error for %s', async (_name, random, expected) => {
      expect(await problem({ random })).toContain(expected)
    })
  })

  describe('url', () => {
    it('may have a path, for Immich behind a reverse proxy', async () => {
      expect((await immich({ url: 'https://home.example/immich/' })).url).toBe('https://home.example/immich/')
    })

    it.each([
      ['not a URL', 'immich', 'must be an http:// or https:// URL'],
      ['not http', 'ftp://immich.local', 'must be an http:// or https:// URL'],
      ['with a password in it', 'http://admin:hunter2@immich.local', 'must not contain a username or password'],
    ])('is an error when it is %s, without repeating the password', async (_name, url, expected) => {
      const message = await problem({ url })

      expect(message).toContain('photos.immich.url')
      expect(message).toContain(expected)
      expect(message).not.toContain('hunter2')
    })
  })

  it('still takes the settings from before the modes, as they were', async () => {
    const block = await immich({ album_ids: [ALBUM, 'second-album'] })

    expect(block).toMatchObject({ url: 'http://immich.local:2283', api_key: 'k', album_ids: [ALBUM, 'second-album'], mode: 'albums' })
  })

  it('is an error for an unknown setting', async () => {
    expect(await problem({ albums: [ALBUM] })).toContain('photos.immich.albums: unknown setting')
  })
})
