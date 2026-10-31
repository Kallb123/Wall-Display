import { and, eq, isNotNull } from 'drizzle-orm'
import type { PhotoSource } from '../../shared/display'
import type { Db } from '../db/client'
import { photoAssets, photoPlaylists } from '../db/schema'
import type { PhotoAssetRow, PhotoOrientation } from '../db/schema'
import type { Playlist } from './playlist'
import type { PhotoListing } from './types'

// The photo tables: what each provider's pool holds and which photos are in the
// cache (`photo_assets`), and where each display is in its playlist
// (`photo_playlists`). Plain reads and writes, all synchronous, so the cache and
// the service can use them without anything else happening in between.

/** The id of a photo in `photo_assets`. */
export function assetId(provider: PhotoSource, providerAssetId: string): string {
  return `${provider}:${providerAssetId}`
}

/** The most rows written in one statement. */
const BATCH = 200

export interface SyncResult {
  added: number
  removed: number
  /** Cache files the removed photos pointed at. The caller deletes those nothing else refers to. */
  files: string[]
}

const orientationOf = (width: number, height: number): PhotoOrientation => height > width ? 'portrait' : 'landscape'

/**
 * Makes the stored pool of `provider` match a fresh listing: new photos are
 * added, changed ones updated, and photos no longer listed removed. A listing that doesn't know a photo's size leaves what is stored; a new photo
 * has size 0 until it is first rendered.
 */
export function syncListing(db: Db, provider: PhotoSource, listing: readonly PhotoListing[], now: Date): SyncResult {
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
          createdAt: now,
        })
        continue
      }
      const changes: Partial<typeof photoAssets.$inferInsert> = {}
      if (sized && (row.width !== item.width || row.height !== item.height)) {
        Object.assign(changes, { width: item.width, height: item.height, orientation: orientationOf(item.width!, item.height!) })
      }
      if (item.takenAt !== undefined && (item.takenAt?.getTime() ?? null) !== (row.takenAt?.getTime() ?? null)) changes.takenAt = item.takenAt
      if (Object.keys(changes).length > 0) tx.update(photoAssets).set(changes).where(eq(photoAssets.id, id)).run()
    }
    for (let i = 0; i < inserts.length; i += BATCH) tx.insert(photoAssets).values(inserts.slice(i, i + BATCH)).run()

    const files: string[] = []
    let removed = 0
    for (const row of stored.values()) {
      if (listed.has(row.id)) continue
      tx.delete(photoAssets).where(eq(photoAssets.id, row.id)).run()
      removed++
      if (row.cacheFile) files.push(row.cacheFile)
    }
    return { added: inserts.length, removed, files }
  })
}

/** Every photo in a provider's stored pool. */
export function listPool(db: Db, provider: PhotoSource): PhotoAssetRow[] {
  return db.select().from(photoAssets).where(eq(photoAssets.provider, provider)).all()
}

export function getAsset(db: Db, id: string): PhotoAssetRow | undefined {
  return db.select().from(photoAssets).where(eq(photoAssets.id, id)).get()
}

/** The photos that have a file in the cache. */
export function cachedAssets(db: Db): PhotoAssetRow[] {
  return db.select().from(photoAssets).where(isNotNull(photoAssets.cacheFile)).all()
}

export interface RenderedRecord {
  cacheFile: string
  cacheBytes: number
  width: number
  height: number
  orientation: PhotoOrientation
}

/** Notes that a photo is now in the cache, with the size and shape its image turned out to have. */
export function recordCached(db: Db, id: string, record: RenderedRecord, now: Date): void {
  db.update(photoAssets).set({ ...record, fetchedAt: now }).where(eq(photoAssets.id, id)).run()
}

/** Notes that a photo's file is gone from the cache. */
export function clearCached(db: Db, id: string): void {
  db.update(photoAssets).set({ cacheFile: null, cacheBytes: null }).where(eq(photoAssets.id, id)).run()
}

export function markShown(db: Db, id: string, now: Date): void {
  db.update(photoAssets).set({ lastShownAt: now }).where(eq(photoAssets.id, id)).run()
}

export function loadPlaylist(db: Db, displayId: string, provider: PhotoSource): Playlist {
  const row = db.select().from(photoPlaylists).where(and(eq(photoPlaylists.displayId, displayId), eq(photoPlaylists.provider, provider))).get()
  if (!row || !Array.isArray(row.order)) return { order: [], position: 0 }
  const order = row.order.filter((id): id is string => typeof id === 'string')
  return { order, position: Math.max(0, Math.min(row.position, order.length)) }
}

export function savePlaylist(db: Db, displayId: string, provider: PhotoSource, playlist: Playlist, now: Date): void {
  db.insert(photoPlaylists)
    .values({ displayId, provider, order: playlist.order, position: playlist.position, updatedAt: now })
    .onConflictDoUpdate({ target: [photoPlaylists.displayId, photoPlaylists.provider], set: { order: playlist.order, position: playlist.position, updatedAt: now } })
    .run()
}
