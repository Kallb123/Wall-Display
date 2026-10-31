import { describe, expect, it } from 'vitest'
import { photoInfoSchema, photoResponseSchema, photoUrl } from '../../../shared/photos'

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
