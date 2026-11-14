import { and, eq } from 'drizzle-orm'
import type { PhotoRendition } from '../../shared/photos'
import type { Db } from '../db/client'
import { photoAssets, photoPlaylists, photoRenditions } from '../db/schema'
import type { PhotoAssetRow, PhotoOrientation, PhotoRenditionRow } from '../db/schema'
import type { Playlist } from './playlist'
import type { PhotoListing } from './types'

// The photo tables: what each provider's pool holds (`photo_assets`), which
// rendered files of them are in the cache (`photo_renditions`, one per shape of
// stage), and where each display is in its playlist (`photo_playlists`). Plain reads and writes, all synchronous, so the cache and
// the service can use them without anything else happening in between.

/** The id of a photo in `photo_assets`. */
export function assetId(provider: string, providerAssetId: string): string {
  return `${provider}:${providerAssetId}`
}

/** The most rows written in one statement. */
const BATCH = 200

export interface SyncResult {
  added: number
  removed: number
  /** Cache files the removed photos' renditions pointed at. The caller deletes those nothing else refers to. */
  files: string[]
}

const orientationOf = (width: number, height: number): PhotoOrientation => height > width ? 'portrait' : 'landscape'

/**
 * Makes the stored pool of `provider` match a fresh listing: new photos are
 * added, changed ones updated, and photos no longer listed removed. A listing that doesn't know a photo's size leaves what is stored; a new photo
 * has size 0 until it is first rendered.
 */
export function syncListing(db: Db, provider: string, listing: readonly PhotoListing[], now: Date): SyncResult {
  return db.transaction((tx) => {
    const stored = new Map(tx.select().from(photoAssets).where(eq(photoAssets.provider, provider)).all().map(row => [row.id, row]))
    const listed = new Set<string>()
    const inserts: (typeof photoAssets.$inferInsert)[] = []

    for (const item of listing) {
      const id = assetId(provider, item.providerAssetId)
      if (listed.has(id)) continue
      listed.add(id)
      const row = stored.get(id)
      const sized = item.width !== undefined && item.height !== undefined && item.width > 0 && item.height > 0
      if (!row) {
        inserts.push({
          id,
          provider,
          providerAssetId: item.providerAssetId,
          width: sized ? item.width! : 0,
          height: sized ? item.height! : 0,
          orientation: sized ? orientationOf(item.width!, item.height!) : 'landscape',
          takenAt: item.takenAt ?? null,
          credit: item.credit ?? null,
          createdAt: now,
        })
        continue
      }
      const changes: Partial<typeof photoAssets.$inferInsert> = {}
      if (sized && (row.width !== item.width || row.height !== item.height)) {
        Object.assign(changes, { width: item.width, height: item.height, orientation: orientationOf(item.width!, item.height!) })
      }
      if (item.takenAt !== undefined && (item.takenAt?.getTime() ?? null) !== (row.takenAt?.getTime() ?? null)) changes.takenAt = item.takenAt
      if (item.credit !== undefined && item.credit !== row.credit) changes.credit = item.credit
      if (Object.keys(changes).length > 0) tx.update(photoAssets).set(changes).where(eq(photoAssets.id, id)).run()
    }
    for (let i = 0; i < inserts.length; i += BATCH) tx.insert(photoAssets).values(inserts.slice(i, i + BATCH)).run()

    const files: string[] = []
    let removed = 0
    for (const row of stored.values()) {
      if (listed.has(row.id)) continue
      // The renditions would go with the photo anyway; deleted here so their files are known.
      for (const rendition of tx.select().from(photoRenditions).where(eq(photoRenditions.assetId, row.id)).all()) files.push(rendition.cacheFile)
      tx.delete(photoRenditions).where(eq(photoRenditions.assetId, row.id)).run()
      tx.delete(photoAssets).where(eq(photoAssets.id, row.id)).run()
      removed++
    }
    return { added: inserts.length, removed, files }
  })
}

/** Every photo in a provider's stored pool. */
export function listPool(db: Db, provider: string): PhotoAssetRow[] {
  return db.select().from(photoAssets).where(eq(photoAssets.provider, provider)).all()
}

export function getAsset(db: Db, id: string): PhotoAssetRow | undefined {
  return db.select().from(photoAssets).where(eq(photoAssets.id, id)).get()
}

/** The file a photo has in the cache for a shape of stage, if any. */
export function getRendition(db: Db, id: string, rendition: PhotoRendition): PhotoRenditionRow | undefined {
  return db.select().from(photoRenditions).where(and(eq(photoRenditions.assetId, id), eq(photoRenditions.rendition, rendition))).get()
}

/** Every rendered file in the cache. */
export function cachedRenditions(db: Db): PhotoRenditionRow[] {
  return db.select().from(photoRenditions).all()
}

export interface RenderedRecord {
  cacheFile: string
  cacheBytes: number
  width: number
  height: number
  orientation: PhotoOrientation
}

/**
 * Notes that a photo is now in the cache in this rendition, and the size and
 * shape its original turned out to have. A rendition stored again keeps when it
 * was last shown.
 */
export function recordCached(db: Db, id: string, rendition: PhotoRendition, record: RenderedRecord, now: Date): void {
  const { cacheFile, cacheBytes, ...shape } = record
  db.transaction((tx) => {
    tx.update(photoAssets).set(shape).where(eq(photoAssets.id, id)).run()
    tx.insert(photoRenditions)
      .values({ assetId: id, rendition, cacheFile, cacheBytes, fetchedAt: now })
      .onConflictDoUpdate({ target: [photoRenditions.assetId, photoRenditions.rendition], set: { cacheFile, cacheBytes, fetchedAt: now } })
      .run()
  })
}

/** Notes that a photo's file in this rendition is gone from the cache. */
export function clearCached(db: Db, id: string, rendition: PhotoRendition): void {
  db.delete(photoRenditions).where(and(eq(photoRenditions.assetId, id), eq(photoRenditions.rendition, rendition))).run()
}

/** Notes that a display has shown the photo, as the photo and as this rendition of it. */
export function markShown(db: Db, id: string, rendition: PhotoRendition, now: Date): void {
  db.update(photoAssets).set({ lastShownAt: now }).where(eq(photoAssets.id, id)).run()
  db.update(photoRenditions).set({ lastShownAt: now }).where(and(eq(photoRenditions.assetId, id), eq(photoRenditions.rendition, rendition))).run()
}

export function loadPlaylist(db: Db, displayId: string, provider: string): Playlist {
  const row = db.select().from(photoPlaylists).where(and(eq(photoPlaylists.displayId, displayId), eq(photoPlaylists.provider, provider))).get()
  if (!row || !Array.isArray(row.order)) return { order: [], position: 0 }
  const order = row.order.filter((id): id is string => typeof id === 'string')
  return { order, position: Math.max(0, Math.min(row.position, order.length)) }
}

export function savePlaylist(db: Db, displayId: string, provider: string, playlist: Playlist, now: Date): void {
  db.insert(photoPlaylists)
    .values({ displayId, provider, order: playlist.order, position: playlist.position, updatedAt: now })
    .onConflictDoUpdate({ target: [photoPlaylists.displayId, photoPlaylists.provider], set: { order: playlist.order, position: playlist.position, updatedAt: now } })
    .run()
}
