import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db/client'
import { specialDays, specialDayScenes } from '../db/schema'

// The art files on disk (architecture §6.1): named after a hash of their
// bytes, so the same picture is stored once however many days and scenes use
// it. Everything here is synchronous on purpose. The upload routes write the
// file, update the row and clean up in one go, with nothing awaited between,
// so two uploads can't interleave between "is this file still referenced?" and
// "delete it".

/** The folder under the data directory that holds the art. */
export const ART_DIR_NAME = 'special-days'

/** The only names the art folder holds, and the only ones that are served or deleted: no paths get in. */
export const ART_FILE_NAME = /^[0-9a-f]{64}\.(webp|svg)$/

export type ArtExt = 'webp' | 'svg'

/** The name a file with these (already processed) bytes is stored under: their SHA-256 and the extension. */
export function artFileName(data: Buffer, ext: ArtExt): string {
  return `${createHash('sha256').update(data).digest('hex')}.${ext}`
}

/**
 * Stores the bytes in `dir` (made if need be) under their hash name and
 * returns it. Nothing happens if that file is already there: the same bytes
 * are the same file. It is written under a temporary name and renamed, so a
 * crash never leaves half a picture under a real name.
 */
export function writeArtFile(dir: string, data: Buffer, ext: ArtExt): string {
  const name = artFileName(data, ext)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  if (existsSync(file)) return name

  // Dot-prefixed, so it can never be mistaken for an art name.
  const temp = join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    writeFileSync(temp, data)
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
  return name
}

/** Every art file any scene or day refers to. */
export function referencedArt(db: Db): Set<string> {
  const names = new Set<string>()
  const add = (name: string | null) => {
    if (name !== null) names.add(name)
  }
  for (const row of db.select({ tile: specialDayScenes.tileArt, full: specialDayScenes.fullArt }).from(specialDayScenes).all()) {
    add(row.tile)
    add(row.full)
  }
  for (const row of db.select({ tile: specialDays.tileArt, full: specialDays.fullArt, extra: specialDays.extraArt }).from(specialDays).all()) {
    add(row.tile)
    add(row.full)
    add(row.extra)
  }
  return names
}

/**
 * Deletes those of `names` that no scene or day refers to any more, and
 * returns the ones it deleted. Call it after the row has changed. Nulls, names
 * that aren't art names and files already gone are skipped quietly.
 */
export function removeUnreferencedArt(db: Db, dir: string, names: Iterable<string | null | undefined>): string[] {
  const candidates = new Set<string>()
  for (const name of names) {
    if (name && ART_FILE_NAME.test(name)) candidates.add(name)
  }
  if (candidates.size === 0) return []

  const referenced = referencedArt(db)
  const removed: string[] = []
  for (const name of candidates) {
    if (referenced.has(name)) continue
    try {
      unlinkSync(join(dir, name))
      removed.push(name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return removed
}
