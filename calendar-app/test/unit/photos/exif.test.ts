import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { exifTakenAt } from '../../../server/photos/exif'

/** A minimal TIFF block holding one ASCII DateTimeOriginal in the Exif IFD, in either byte order. */
function handMade(little: boolean, date: string, withHeader = true): Buffer {
  const u16 = (n: number) => { const b = Buffer.alloc(2); if (little) b.writeUInt16LE(n); else b.writeUInt16BE(n); return b }
  const u32 = (n: number) => { const b = Buffer.alloc(4); if (little) b.writeUInt32LE(n); else b.writeUInt32BE(n); return b }
  const text = Buffer.from(`${date}\0`, 'latin1')
  // Header (8) + IFD0 with one entry (2 + 12 + 4 = 18) puts the Exif IFD at 26; it has one entry (18), so the text is at 44.
  const tiff = Buffer.concat([
    Buffer.from(little ? 'II' : 'MM'), u16(42), u32(8),
    u16(1), u16(0x8769), u16(4), u32(1), u32(26), u32(0),
    u16(1), u16(0x9003), u16(2), u32(text.length), u32(44), u32(0),
    text,
  ])
  return withHeader ? Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]) : tiff
}

describe('exifTakenAt', () => {
  it('reads DateTimeOriginal from a block written by sharp', async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .jpeg()
      .withExif({ IFD2: { DateTimeOriginal: '2024:07:14 10:30:05' } })
      .toBuffer()

    const { exif } = await sharp(jpeg).metadata()

    expect(exifTakenAt(exif)).toEqual(new Date('2024-07-14T10:30:05Z'))
  })

  it('reads either byte order, with or without the Exif header', () => {
    for (const little of [true, false]) {
      expect(exifTakenAt(handMade(little, '2019:12:31 23:59:58'))).toEqual(new Date('2019-12-31T23:59:58Z'))
      expect(exifTakenAt(handMade(little, '2019:12:31 23:59:58', false))).toEqual(new Date('2019-12-31T23:59:58Z'))
    }
  })

  it('is null when there is no date, or anything is wrong with the block', () => {
    expect(exifTakenAt(undefined)).toBeNull()
    expect(exifTakenAt(Buffer.alloc(0))).toBeNull()
    expect(exifTakenAt(Buffer.from('Exif\0\0nonsense'))).toBeNull()
    expect(exifTakenAt(handMade(true, '0000:00:00 00:00:00'))).toBeNull()
    expect(exifTakenAt(handMade(true, 'yesterday, about teatime'))).toBeNull()
    // Cut short in the middle of the date.
    expect(exifTakenAt(handMade(true, '2019:12:31 23:59:58').subarray(0, 50))).toBeNull()
  })
})
