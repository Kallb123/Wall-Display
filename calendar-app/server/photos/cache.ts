import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db/client'
import type { RenderedPhoto } from './render'
import { cachedAssets, clearCached, getAsset, recordCached } from './store'

// The rendered photos on disk (architecture §5.1): named after a hash of their
// bytes, so the same picture is stored once however many assets render to it.
// The cache has a size cap; over it, the photos shown least recently go first,
// and never one a display is showing now. Synchronous on purpose, like the
// special day art files: writing a file, noting it in the database and
// evicting happen in one go, with nothing awaited between, so two photos can't
// interleave between "is this file still used?" and "delete it".

/** The folder under the data directory that holds the photos. */
export const PHOTO_DIR_NAME = 'photos'

/** The only names the photo folder holds, and the only ones that are served or deleted: no paths get in. */
export const PHOTO_FILE_NAME = /^[0-9a-f]{64}\.webp$/

/** The name a file with these bytes is stored under: their SHA-256 and `.webp`. */
export function photoFileName(data: Buffer): string {
  return `${createHash('sha256').update(data).digest('hex')}.webp`
}

export interface PhotoCacheOptions {
  db: Db
  dir: string
  /** The size cap in bytes. */
  maxBytes: number
  /** The cache files that must stay: those on a display now, and those about to be. Asked afresh at every eviction. */
  protect: () => ReadonlySet<string>
  /** For tests. Default: the real time. */
  now?: () => Date
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface PhotoCache {
  /** Whether the file is on disk. */
  has: (file: string) => boolean
  /** Stores a rendered photo for the asset, notes it in the database, and evicts if that put the cache over its cap. Returns the file name. */
  store: (assetId: string, rendered: RenderedPhoto) => string
  /** Evicts, least recently shown first, until the cache is under its cap. Returns the assets evicted. */
  evict: () => string[]
  /** Deletes those of `files` that no asset refers to and that are not protected. */
  release: (files: Iterable<string>) => void
  /** Deletes files nothing refers to, and leftover temporary files. For start-up. */
  sweep: () => void
  /** The bytes the cached files take (a file shared by several assets counts once). */
  bytes: () => number
}

export function createPhotoCache(options: PhotoCacheOptions): PhotoCache {
  const { db, dir, maxBytes, protect, now = () => new Date(), log = console } = options

  /** Each file in use, with its size and how many assets refer to it. */
  function usage() {
    const files = new Map<string, { bytes: number, refs: number }>()
    for (const row of cachedAssets(db)) {
      const entry = files.get(row.cacheFile!) ?? { bytes: row.cacheBytes ?? 0, refs: 0 }
      entry.refs++
      files.set(row.cacheFile!, entry)
    }
    return files
  }

  function remove(file: string): void {
    if (!PHOTO_FILE_NAME.test(file)) return
    try {
      unlinkSync(join(dir, file))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  const cache: PhotoCache = {
    has: file => PHOTO_FILE_NAME.test(file) && existsSync(join(dir, file)),

    store(assetId, rendered) {
      const file = photoFileName(rendered.data)
      mkdirSync(dir, { recursive: true })
      // Written under a temporary name and renamed, so a crash never leaves half a photo under a real name.
      // Always written, even if the file is there: eviction may have taken it between the check and now.
      const temp = join(dir, `.${file}.${randomBytes(6).toString('hex')}.tmp`)
      try {
        writeFileSync(temp, rendered.data)
        renameSync(temp, join(dir, file))
      } catch (error) {
        rmSync(temp, { force: true })
        throw error
      }
      const before = getAsset(db, assetId)?.cacheFile
      recordCached(db, assetId, {
        cacheFile: file,
        cacheBytes: rendered.data.length,
        width: rendered.width,
        height: rendered.height,
        orientation: rendered.orientation,
      }, now())
      // Rendered again to something different: the old file may be nobody's now.
      if (before && before !== file) cache.release([before])
      cache.evict()
      return file
    },

    evict() {
      const files = usage()
      let total = 0
      for (const { bytes } of files.values()) total += bytes
      if (total <= maxBytes) return []

      const keep = protect()
      // Least recently shown first. A photo never shown counts from when it was fetched.
      const rows = cachedAssets(db).sort((a, b) => {
        const when = (row: typeof a) => (row.lastShownAt ?? row.fetchedAt ?? row.createdAt).getTime()
        return when(a) - when(b) || a.id.localeCompare(b.id)
      })
      const evicted: string[] = []
      for (const row of rows) {
        if (total <= maxBytes) break
        const file = row.cacheFile!
        if (keep.has(file)) continue
        clearCached(db, row.id)
        evicted.push(row.id)
        const entry = files.get(file)!
        // A file shared with another asset stays until the last of them goes.
        if (--entry.refs === 0) {
          remove(file)
          total -= entry.bytes
        }
      }
      if (total > maxBytes) {
        log.warn(`[photos] the cache is over its ${Math.round(maxBytes / (1024 * 1024))} MB cap, but what is left is on a display; it will be trimmed when they move on`)
      }
      return evicted
    },

    release(names) {
      const used = new Set(usage().keys())
      const keep = protect()
      for (const file of names) {
        if (!used.has(file) && !keep.has(file)) remove(file)
      }
    },

    sweep() {
      if (!existsSync(dir)) return
      const used = new Set(usage().keys())
      const keep = protect()
      for (const name of readdirSync(dir)) {
        const orphan = PHOTO_FILE_NAME.test(name) ? !used.has(name) && !keep.has(name) : name.startsWith('.') && name.endsWith('.tmp')
        if (!orphan) continue
        try {
          unlinkSync(join(dir, name))
        } catch (error) {
          log.warn(`[photos] could not delete ${name}: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}`)
        }
      }
    },

    bytes() {
      let total = 0
      for (const { bytes } of usage().values()) total += bytes
      return total
    },
  }
  return cache
}
