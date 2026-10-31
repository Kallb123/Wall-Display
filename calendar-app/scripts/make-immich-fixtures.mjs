// Writes the Immich answers in test/fixtures/immich/, which the Immich provider
// tests and the end-to-end test's fake server replay. They are committed, so this
// only needs running if they are to change: `node scripts/make-immich-fixtures.mjs`.
// The shapes follow what Immich 1.13x answers to the calls the provider makes
// (`POST /api/search/metadata`, `POST /api/search/random`, `GET /api/memories`),
// trimmed to the keys that matter and with made-up ids, paths and dates. The
// thumbnail is a small gradient JPEG, standing in for `thumbnail?size=preview`.
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'immich')
mkdirSync(out, { recursive: true })

/** A stable id that looks like the v4 UUIDs Immich uses. */
const id = (name) => {
  const hex = createHash('sha1').update(`immich-fixture:${name}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const OWNER = id('owner')

/** One asset as Immich describes it, with `withExif: true`. */
function asset(name, { type = 'IMAGE', width = 4032, height = 3024, orientation = '1', taken = '2023-08-12T14:03:22.000Z', make = 'Apple', model = 'iPhone 14', ...flags } = {}) {
  const ext = type === 'IMAGE' ? 'JPG' : 'MOV'
  const base = {
    id: id(name),
    deviceAssetId: `IMG_${name}`,
    ownerId: OWNER,
    deviceId: 'phone-1',
    libraryId: null,
    type,
    originalPath: `/usr/src/app/upload/upload/${OWNER}/${id(name).slice(0, 2)}/${id(name).slice(2, 4)}/${id(name)}.${ext.toLowerCase()}`,
    originalFileName: `${name}.${ext}`,
    originalMimeType: type === 'IMAGE' ? 'image/jpeg' : 'video/quicktime',
    thumbhash: 'YBgGDQK3eIh/dnh4h4eIdnd3d4B4B4cH',
    fileCreatedAt: taken,
    fileModifiedAt: taken,
    localDateTime: taken,
    updatedAt: '2025-01-05T09:41:10.123Z',
    isFavorite: false,
    isArchived: false,
    isTrashed: false,
    visibility: 'timeline',
    duration: type === 'IMAGE' ? '0:00:00.00000' : '0:00:07.12000',
    hasMetadata: true,
    isOffline: false,
    checksum: createHash('sha1').update(name).digest('base64'),
    ...flags,
  }
  if (type === 'IMAGE') {
    base.exifInfo = {
      make,
      model,
      exifImageWidth: width,
      exifImageHeight: height,
      fileSizeInByte: 2_400_000,
      orientation,
      dateTimeOriginal: taken,
      timeZone: 'UTC+1',
      latitude: 51.5,
      longitude: -0.12,
      city: 'London',
      country: 'United Kingdom',
    }
  }
  return base
}

const page = (items, nextPage) => ({
  albums: { total: 0, count: 0, items: [], facets: [] },
  assets: { total: items.length, count: items.length, items, facets: [], nextPage },
})

const write = (name, value) => writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`)

// Album A holds 5 photos and a video over two pages.
const beach = asset('beach', { taken: '2023-08-12T14:03:22.000Z' })
const picnic = asset('picnic', { taken: '2023-08-12T16:40:05.000Z' })
const castle = asset('castle', { width: 6000, height: 4000, taken: '2022-05-29T10:15:00.000Z' })
const clip = asset('clip', { type: 'VIDEO', taken: '2023-08-13T09:00:00.000Z' })
const kite = asset('kite', { width: 4000, height: 3000, taken: '2021-04-02T12:00:00.000Z' })
// Saved on its side: stored 4032x3024 with an EXIF orientation of 6, so upright it is 3024x4032.
const selfie = asset('selfie', { orientation: '6', taken: '2024-02-14T18:22:41.000Z' })
const lighthouse = asset('lighthouse', { width: 5472, height: 3648, taken: '2020-09-05T07:30:00.000Z' })
write('search-metadata-album-a-page-1.json', page([beach, picnic, clip, castle], '2'))
write('search-metadata-album-a-page-2.json', page([kite, selfie], null))

// Album B shares a photo with A, and holds one in the bin, two archived ones (the old and
// the new way Immich says it), a video, and one rotated the other way (orientation 8).
write('search-metadata-album-b.json', page([
  asset('picnic', { taken: '2023-08-12T16:40:05.000Z' }),
  lighthouse,
  asset('deleted', { isTrashed: true, taken: '2019-01-01T10:00:00.000Z' }),
  asset('hidden-old', { isArchived: true, taken: '2019-02-01T10:00:00.000Z' }),
  asset('hidden-new', { visibility: 'archive', taken: '2019-03-01T10:00:00.000Z' }),
  asset('movie', { type: 'VIDEO', taken: '2019-04-01T10:00:00.000Z' }),
  asset('sideways', { orientation: '8', width: 4000, height: 3000, taken: '2018-06-01T10:00:00.000Z' }),
], null))

// A random pick is a plain list. Two photos have no EXIF size or no date.
const noExif = asset('no-exif', { taken: '2024-06-01T10:00:00.000Z' })
delete noExif.exifInfo
const noDate = asset('no-date', { taken: '2017-03-03T03:03:03.000Z' })
delete noDate.exifInfo.dateTimeOriginal
write('search-random.json', [
  asset('garden', { taken: '2024-07-04T11:11:11.000Z' }),
  asset('harbour', { width: 5000, height: 2800, taken: '2024-07-05T08:00:00.000Z' }),
  asset('snow', { orientation: '6', width: 3000, height: 2000, taken: '2024-12-26T13:30:00.000Z' }),
  noExif,
  noDate,
  asset('old-bike', { taken: '2016-05-05T05:05:05.000Z' }),
])

// Memories: "on this day" in 2021 and 2023, each with its photos (and the 2021 one has a video).
const memory = (name, year, assets) => ({
  id: id(`memory-${name}`),
  type: 'on_this_day',
  data: { year },
  isSaved: false,
  memoryAt: `${year}-10-31T00:00:00.000Z`,
  showAt: '2026-10-31T00:00:00.000Z',
  hideAt: '2026-10-31T23:59:59.999Z',
  createdAt: '2026-10-30T23:00:00.000Z',
  updatedAt: '2026-10-30T23:00:00.000Z',
  ownerId: OWNER,
  assets,
})
const pumpkins = asset('pumpkins', { taken: '2021-10-31T17:45:00.000Z' })
write('memories.json', [
  memory('2021', 2021, [pumpkins, asset('costumes', { width: 3000, height: 4000, taken: '2021-10-31T18:10:00.000Z' }), asset('trick-or-treat', { type: 'VIDEO', taken: '2021-10-31T18:30:00.000Z' })]),
  memory('2023', 2023, [pumpkins, asset('bonfire', { taken: '2023-10-31T19:20:00.000Z' })]),
])
write('memories-empty.json', [])

// What a preview looks like: a small gradient with a sun and a hill, no text.
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5fb0d8"/><stop offset="1" stop-color="#f2c14e"/></linearGradient></defs>
  <rect width="480" height="270" fill="url(#g)"/>
  <circle cx="360" cy="80" r="40" fill="#fff6d6" opacity="0.9"/>
  <path d="M0 270 L0 190 Q120 120 240 190 T480 180 L480 270 Z" fill="#2f6b4f"/>
</svg>`)
await sharp(svg).jpeg({ quality: 70, mozjpeg: true }).toFile(join(out, 'thumbnail.jpg'))
