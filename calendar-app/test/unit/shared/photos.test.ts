import { describe, expect, it } from 'vitest'
import { boxQuery, coversBox, photoInfoSchema, photoResponseSchema, photoUrl } from '../../../shared/photos'

const photo = {
  id: 'local:holiday/a.jpg',
  url: photoUrl(`${'ab'.repeat(32)}.webp`),
  width: 1600,
  height: 900,
  orientation: 'landscape',
  taken_at: '2024-07-14T10:30:05.000Z',
  provider: 'local',
}

describe('photoUrl', () => {
  it('is where the server serves a rendered photo from', () => {
    expect(photoUrl('abc.webp')).toBe('/photos/abc.webp')
  })
})

describe('photoInfoSchema', () => {
  it('takes what the server sends', () => {
    expect(photoInfoSchema.parse(photo)).toEqual(photo)
    expect(photoInfoSchema.parse({ ...photo, taken_at: null }).taken_at).toBeNull()
  })

  it.each([
    ['an unknown provider', { provider: 'flickr' }],
    ['an unknown orientation', { orientation: 'square' }],
    ['no size', { width: 0 }],
    ['a fractional size', { height: 90.5 }],
    ['a missing url', { url: undefined }],
    ['an extra field', { path: '/etc/passwd' }],
  ])('rejects %s', (_name, change) => {
    expect(photoInfoSchema.safeParse({ ...photo, ...change }).success).toBe(false)
  })
})

describe('photoResponseSchema', () => {
  it('is a photo or null', () => {
    expect(photoResponseSchema.parse({ photo })).toEqual({ photo })
    expect(photoResponseSchema.parse({ photo: null })).toEqual({ photo: null })
    expect(photoResponseSchema.safeParse({}).success).toBe(false)
  })
})

describe('coversBox', () => {
  const box169 = { width: 1920, height: 1080 }
  const box43 = { width: 1600, height: 1200 }
  const box916 = { width: 1080, height: 1920 }

  it.each([
    ['a photo of the box\'s shape', 1600, 900, box169, true],
    ['a 4:3 phone photo in a 16:9 box', 4032, 3024, box169, true],
    ['a 3:2 photo in a 16:9 box', 6000, 4000, box169, true],
    ['a 2:1 photo in a 16:9 box', 2000, 1000, box169, true],
    ['a 16:9 photo in a 4:3 box (symmetric)', 1600, 900, box43, true],
    ['a 3:4 phone photo in a 9:16 box', 3024, 4032, box916, true],
    ['a 9:16 photo in a 3:4 box', 900, 1600, { width: 900, height: 1200 }, true],
    ['a 3:4 photo in a landscape pane that is 3:4 (a portrait box)', 3024, 4032, { width: 1000, height: 1333 }, true],
    ['a portrait photo in a landscape box', 3024, 4032, box169, false],
    ['a landscape photo in a portrait box', 4032, 3024, box916, false],
    ['a square photo in a 16:9 box', 1000, 1000, box169, false],
    ['a 3:1 panorama in a 16:9 box', 3000, 1000, box169, false],
    ['a 2:3 photo in a 16:9 box', 2000, 3000, box169, false],
  ])('%s', (_name, width, height, box, expected) => {
    expect(coversBox({ width, height }, box)).toBe(expected)
  })

  it('is the shape of the box that counts, not the stage: a 4:3 photo covers a 4:3 pane of any size', () => {
    expect(coversBox({ width: 4032, height: 3024 }, { width: 800, height: 600 })).toBe(true)
    expect(coversBox({ width: 4032, height: 3024 }, { width: 600, height: 800 })).toBe(false)
  })

  it('just covers 4:3 against 16:9 in both directions, which is exactly 4/3', () => {
    expect(coversBox({ width: 4, height: 3 }, { width: 16, height: 9 })).toBe(true)
    expect(coversBox({ width: 16, height: 9 }, { width: 4, height: 3 })).toBe(true)
    // Just over 1.35 is too far.
    expect(coversBox({ width: 1360, height: 1000 }, { width: 1000, height: 1000 })).toBe(false)
    expect(coversBox({ width: 1350, height: 1000 }, { width: 1000, height: 1000 })).toBe(true)
  })

  it('never covers when a size is not known', () => {
    expect(coversBox({ width: 0, height: 0 }, box169)).toBe(false)
    expect(coversBox({ width: 1600, height: 900 }, { width: 0, height: 1080 })).toBe(false)
  })
})

describe('boxQuery', () => {
  it('is undefined with neither, and null with one or a bad one', () => {
    expect(boxQuery(undefined, undefined)).toBeUndefined()
    expect(boxQuery('1920', undefined)).toBeNull()
    expect(boxQuery(undefined, '1080')).toBeNull()
    for (const bad of ['0', '-5', '1.5', 'abc', '', '123456', '1e3']) expect(boxQuery(bad, '1080'), bad).toBeNull()
  })

  it('reads whole numbers, the first if repeated', () => {
    expect(boxQuery('1920', '1080')).toEqual({ width: 1920, height: 1080 })
    expect(boxQuery(['800', '1'], ['600'])).toEqual({ width: 800, height: 600 })
  })
})
