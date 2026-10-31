// Reads when a photo was taken from the raw EXIF block sharp hands back. It
// walks only as far as the date, so no EXIF library is needed. Anything odd
// (a short or damaged block, no date) gives null: this is a nicety, never a
// reason to skip a photo.

const EXIF_HEADER = 'Exif\0\0'
const TAG_EXIF_IFD = 0x8769
const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_DATE_TIME_DIGITIZED = 0x9004
const TAG_DATE_TIME = 0x0132
const TYPE_ASCII = 2

/** `2024:07:14 10:30:00`, the only form EXIF writes. */
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/

/** The date in `exif`, or null. EXIF dates carry no time zone, so the clock time is read as UTC: only the date is ever shown. */
export function exifTakenAt(exif: Buffer | undefined): Date | null {
  if (!exif) return null
  try {
    const tiff = exif.subarray(0, EXIF_HEADER.length).toString('latin1') === EXIF_HEADER ? exif.subarray(EXIF_HEADER.length) : exif
    const order = tiff.subarray(0, 2).toString('latin1')
    if (order !== 'II' && order !== 'MM') return null
    const little = order === 'II'
    const u16 = (at: number) => little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at)
    const u32 = (at: number) => little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at)

    /** The entries of the IFD at `offset`: tag to the offset of its value (or its type, for a number). */
    const entries = (offset: number) => {
      const found = new Map<number, { type: number, count: number, valueAt: number }>()
      const count = u16(offset)
      for (let i = 0; i < count && i < 512; i++) {
        const at = offset + 2 + i * 12
        const type = u16(at + 2)
        const length = u32(at + 4)
        // A value of up to four bytes sits in the entry itself; a longer one is elsewhere.
        found.set(u16(at), { type, count: length, valueAt: length <= 4 ? at + 8 : u32(at + 8) })
      }
      return found
    }
    const text = (entry: { type: number, count: number, valueAt: number } | undefined): Date | null => {
      if (!entry || entry.type !== TYPE_ASCII || entry.count < 19) return null
      const match = EXIF_DATE.exec(tiff.subarray(entry.valueAt, entry.valueAt + entry.count).toString('latin1'))
      if (!match) return null
      const [, year, month, day, hour, minute, second] = match.map(Number) as [number, number, number, number, number, number, number]
      if (year === 0 || month < 1 || month > 12 || day < 1 || day > 31) return null
      const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
      return Number.isNaN(date.getTime()) ? null : date
    }

    const main = entries(u32(4))
    const exifIfd = main.get(TAG_EXIF_IFD)
    const inner = exifIfd ? entries(u32(exifIfd.valueAt)) : new Map<number, { type: number, count: number, valueAt: number }>()
    return text(inner.get(TAG_DATE_TIME_ORIGINAL)) ?? text(inner.get(TAG_DATE_TIME_DIGITIZED)) ?? text(main.get(TAG_DATE_TIME))
  } catch {
    return null
  }
}
