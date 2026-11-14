import { describe, expect, it } from 'vitest'
import { PHOTO_HISTORY_KEEP } from '../../../shared/photoHistory'
import { closeAllOpenAtBoot, closeOpen, listHistory, recordShown } from '../../../server/photos/history'
import type { ShownRecord } from '../../../server/photos/history'
import { getAsset, syncListing } from '../../../server/photos/store'
import { migratedMemoryDb } from '../db/helpers'

const T0 = new Date('2026-10-28T12:00:00Z')
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

/** A database with photos `p0`... in the `local` feed, and a way to record one as shown. */
function setup() {
  const { db } = migratedMemoryDb()
  syncListing(db, 'local', Array.from({ length: 5 }, (_, i) => ({ providerAssetId: `p${i}`, width: 1600, height: 900, takenAt: new Date('2024-01-02T03:04:05Z'), credit: `Credit ${i}`, details: { location: `Place ${i}` } })), T0)
  const show = (n: number, seconds: number, changes: Partial<ShownRecord> = {}, keep?: number) =>
    recordShown(db, { displayId: 'hallway', rendition: 'landscape', asset: getAsset(db, `local:p${n}`)!, feed: 'local', source: 'local', cacheFile: `f${n}.webp`, now: at(seconds), ...changes }, keep)
  return { db, show }
}

describe('recordShown', () => {
  it('snapshots the photo as it was shown, still on show', () => {
    const { db, show } = setup()

    const id = show(0, 0)

    expect(listHistory(db, 'hallway', 10)).toEqual([{
      id,
      displayId: 'hallway',
      rendition: 'landscape',
      assetId: 'local:p0',
      feed: 'local',
      source: 'local',
      shownAt: at(0),
      endedAt: null,
      width: 1600,
      height: 900,
      orientation: 'landscape',
      takenAt: new Date('2024-01-02T03:04:05Z'),
      credit: 'Credit 0',
      details: { location: 'Place 0' },
      cacheFile: 'f0.webp',
    }])
  })

  it('ends the display\'s previous photo of the same rendition when the next is shown, newest first', () => {
    const { db, show } = setup()

    show(0, 0)
    show(1, 60)
    show(2, 120)

    const rows = listHistory(db, 'hallway', 10)
    expect(rows.map(row => [row.assetId, row.shownAt.getTime() - T0.getTime(), row.endedAt && row.endedAt.getTime() - T0.getTime()])).toEqual([
      ['local:p2', 120_000, null],
      ['local:p1', 60_000, 120_000],
      ['local:p0', 0, 60_000],
    ])
    expect(listHistory(db, 'hallway', 2).map(row => row.assetId)).toEqual(['local:p2', 'local:p1'])
  })

  it('keeps each rendition and each display separate', () => {
    const { db, show } = setup()

    show(0, 0)
    show(1, 10, { rendition: 'portrait' })
    show(2, 20, { displayId: 'kitchen' })
    show(3, 30)

    const hallway = listHistory(db, 'hallway', 10)
    expect(hallway.map(row => [row.assetId, row.rendition, row.endedAt !== null])).toEqual([
      ['local:p3', 'landscape', false],
      ['local:p1', 'portrait', false],
      ['local:p0', 'landscape', true],
    ])
    expect(listHistory(db, 'kitchen', 10).map(row => [row.assetId, row.endedAt])).toEqual([['local:p2', null]])
  })

  it('records the same photo again as a new entry', () => {
    const { db, show } = setup()

    show(0, 0)
    show(0, 30)

    expect(listHistory(db, 'hallway', 10).map(row => row.endedAt !== null)).toEqual([false, true])
  })

  it('keeps the entry after its photo has left the pool', () => {
    const { db, show } = setup()
    show(0, 0)

    syncListing(db, 'local', [], at(5))

    expect(listHistory(db, 'hallway', 10)).toHaveLength(1)
  })

  it('deletes the oldest entries of a display beyond the number kept, and no other display\'s', () => {
    const { db, show } = setup()
    show(4, 0, { displayId: 'kitchen' })

    for (let i = 0; i < 6; i++) show(i % 5, i * 10, {}, 3)

    expect(listHistory(db, 'hallway', 10).map(row => row.shownAt.getTime() - T0.getTime())).toEqual([50_000, 40_000, 30_000])
    expect(listHistory(db, 'kitchen', 10)).toHaveLength(1)
  })

  it('keeps PHOTO_HISTORY_KEEP entries by default', () => {
    const { db, show } = setup()
    for (let i = 0; i < PHOTO_HISTORY_KEEP + 5; i++) show(0, i)
    expect(listHistory(db, 'hallway', PHOTO_HISTORY_KEEP + 50)).toHaveLength(PHOTO_HISTORY_KEEP)
  })
})

describe('closeOpen', () => {
  it('ends what is on show for the display, in every rendition, and leaves what has ended and other displays alone', () => {
    const { db, show } = setup()
    show(0, 0)
    show(1, 10)
    show(2, 20, { rendition: 'portrait' })
    show(3, 30, { displayId: 'kitchen' })

    closeOpen(db, 'hallway', at(100))

    const ended = (displayId: string) => listHistory(db, displayId, 10).map(row => row.endedAt && row.endedAt.getTime() - T0.getTime())
    expect(ended('hallway')).toEqual([100_000, 100_000, 10_000])
    expect(ended('kitchen')).toEqual([null])
  })
})

describe('closeAllOpenAtBoot', () => {
  it('ends every photo on show, no later than one interval after it went up', () => {
    const { db, show } = setup()
    show(0, 0)
    show(1, 1000, { displayId: 'kitchen' })
    show(2, 1000, { displayId: 'hall', rendition: 'portrait' })

    closeAllOpenAtBoot(db, at(1010), 60)

    expect(listHistory(db, 'hallway', 10)[0]!.endedAt).toEqual(at(60))
    // Shown 10 s before the boot: ended at the boot, not 50 s into the future.
    expect(listHistory(db, 'kitchen', 10)[0]!.endedAt).toEqual(at(1010))
    expect(listHistory(db, 'hall', 10)[0]!.endedAt).toEqual(at(1010))
  })

  it('ends them at the boot when no interval is given, and leaves ended ones as they were', () => {
    const { db, show } = setup()
    show(0, 0)
    show(1, 10)

    closeAllOpenAtBoot(db, at(500))

    expect(listHistory(db, 'hallway', 10).map(row => row.endedAt)).toEqual([at(500), at(10)])
  })
})
