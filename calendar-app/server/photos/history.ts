import { and, desc, eq, isNull, lte } from 'drizzle-orm'
import type { PhotoSource } from '../../shared/display'
import { PHOTO_HISTORY_KEEP } from '../../shared/photoHistory'
import type { StageRendition } from '../../shared/photos'
import type { Db } from '../db/client'
import { photoHistory } from '../db/schema'
import type { PhotoAssetRow, PhotoHistoryRow } from '../db/schema'

// The photo history's table (architecture §5.1): which photos each display was
// handed, and for how long each was on show. Plain synchronous reads and writes
// like store.ts. A row is a snapshot of the photo as it was when shown and has no
// link to `photo_assets`, so it outlives the photo's place in the pool.

export interface ShownRecord {
  displayId: string
  /** The shape of stage the display asked for, not the file's own rendition (`cover`). */
  rendition: StageRendition
  /** The photo as stored when it was handed out. */
  asset: PhotoAssetRow
  /** The feed the display asked for: the playlist's key. */
  feed: string
  source: PhotoSource
  /** The rendered file that was served. */
  cacheFile: string | null
  now: Date
}

/**
 * Notes that a display is now showing a photo: the one it showed before in the
 * same rendition (a wall and a phone of another shape each have their own) is
 * ended, the new one is recorded, and entries beyond `keep` for the display are
 * deleted, oldest first. Returns the new entry's id.
 */
export function recordShown(db: Db, record: ShownRecord, keep = PHOTO_HISTORY_KEEP): number {
  const { displayId, rendition, asset, now } = record
  return db.transaction((tx) => {
    tx.update(photoHistory).set({ endedAt: now })
      .where(and(eq(photoHistory.displayId, displayId), eq(photoHistory.rendition, rendition), isNull(photoHistory.endedAt)))
      .run()
    const { id } = tx.insert(photoHistory).values({
      displayId,
      rendition,
      assetId: asset.id,
      feed: record.feed,
      source: record.source,
      shownAt: now,
      endedAt: null,
      width: asset.width,
      height: asset.height,
      orientation: asset.orientation,
      takenAt: asset.takenAt,
      credit: asset.credit,
      details: asset.details,
      cacheFile: record.cacheFile,
    }).returning({ id: photoHistory.id }).get()

    // Entries are numbered in the order they were made, so "the newest `keep`" is the ones with the largest ids.
    const oldest = tx.select({ id: photoHistory.id }).from(photoHistory)
      .where(eq(photoHistory.displayId, displayId))
      .orderBy(desc(photoHistory.id)).limit(1).offset(keep).get()
    if (oldest) tx.delete(photoHistory).where(and(eq(photoHistory.displayId, displayId), lte(photoHistory.id, oldest.id))).run()
    return id
  })
}

/** Ends every photo of a display that is still on show, at `now`: its screen went off, or it moved to a view without photos. */
export function closeOpen(db: Db, displayId: string, now: Date): void {
  db.update(photoHistory).set({ endedAt: now })
    .where(and(eq(photoHistory.displayId, displayId), isNull(photoHistory.endedAt)))
    .run()
}

/**
 * Ends every photo still on show when the server starts: whatever was running
 * stopped with it, and the server can't know when. A photo is ended at `now` or,
 * when the interval between photos is known, no later than one interval after it
 * was shown, so a long stop isn't counted as time on display.
 */
export function closeAllOpenAtBoot(db: Db, now: Date, intervalSeconds?: number): void {
  db.transaction((tx) => {
    for (const row of tx.select().from(photoHistory).where(isNull(photoHistory.endedAt)).all()) {
      const latest = intervalSeconds === undefined ? now.getTime() : row.shownAt.getTime() + Math.round(intervalSeconds * 1000)
      tx.update(photoHistory).set({ endedAt: new Date(Math.min(now.getTime(), latest)) }).where(eq(photoHistory.id, row.id)).run()
    }
  })
}

/** The newest `limit` entries of a display, newest first. */
export function listHistory(db: Db, displayId: string, limit: number): PhotoHistoryRow[] {
  return db.select().from(photoHistory).where(eq(photoHistory.displayId, displayId)).orderBy(desc(photoHistory.id)).limit(limit).all()
}
