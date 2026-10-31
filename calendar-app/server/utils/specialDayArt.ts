import { join } from 'node:path'
import type { H3Event } from 'h3'
import { resolveDataDir } from '../db/paths'
import { useDb } from './db'
import { ART_DIR_NAME, removeUnreferencedArt, writeArtFile } from '../special-days/files'
import { ART_LIMITS, ArtError } from '../special-days/art-errors'
import type { ArtSlot } from '../special-days/art-errors'

// The h3 side of the art uploads (architecture §6.5). The image work is in
// server/special-days/art.ts, which pulls in jsdom and sharp, so only the
// route handlers import that, and they do it lazily. Nothing here may.

/** Room for the multipart framing and the part headers around the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024

/** The folder the art files are kept in, under the data directory. Server code only. */
export function useSpecialDayArtDir(): string {
  return join(resolveDataDir({ env: process.env, dev: import.meta.dev, rootDir: process.cwd() }), ART_DIR_NAME)
}

/** Whether `slot` is one of the three art slots. */
export function isArtSlot(slot: string): slot is ArtSlot {
  return Object.hasOwn(ART_LIMITS, slot)
}

/**
 * The bytes of the `file` part of a multipart upload for `slot`. The size is
 * checked against the request's `Content-Length` before the body is read, so a
 * huge upload is turned away without being buffered: 411 with no length, 413
 * when it says it is too big. A missing `file` part is a 400, and a file over
 * the slot's limit a 413.
 */
export async function readArtUpload(event: H3Event, slot: ArtSlot): Promise<Buffer> {
  const limit = ART_LIMITS[slot]
  const length = getRequestHeader(event, 'content-length')
  if (length === undefined) throw createError({ statusCode: 411, statusMessage: 'Length Required', message: 'Content-Length is required' })
  if (!/^\d+$/.test(length) || Number(length) > limit + MULTIPART_OVERHEAD) {
    throw createError({ statusCode: 413, statusMessage: 'Payload Too Large', message: `The upload is too large, the most is ${limit / (1024 * 1024)} MB` })
  }

  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.filename !== undefined)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'file is required' })
  if (file.data.length > limit) {
    throw createError({ statusCode: 413, statusMessage: 'Payload Too Large', message: `The file is too large, the most is ${limit / (1024 * 1024)} MB` })
  }
  return file.data
}

const STATUS_MESSAGES = { 400: 'Bad Request', 413: 'Payload Too Large', 415: 'Unsupported Media Type' } as const

/**
 * Runs an art step and answers an `ArtError` it throws as the HTTP error it
 * stands for (400, 413 or 415, with its message). Anything else passes through.
 */
export async function answeringArtErrors<T>(run: () => Promise<T> | T): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!(error instanceof ArtError)) throw error
    throw createError({ statusCode: error.statusCode, statusMessage: STATUS_MESSAGES[error.statusCode], message: error.message })
  }
}

/** What setting a slot gives back: the changed row, and the file the slot held before. */
export interface ArtChange<T> {
  row: T
  previous: string | null
}

/**
 * Takes the upload for `slot`, processes it, stores it and points the row at it
 * with `apply`, which is given the file's name and answers null if the row has
 * gone. Returns the changed row, or null if it had gone (the file is then
 * removed again). The image work is awaited first. Everything after it is
 * synchronous, so nothing can interleave between writing the file, updating
 * the row and removing the old file if nothing refers to it.
 */
export async function storeUploadedArt<T>(event: H3Event, slot: ArtSlot, apply: (name: string) => ArtChange<T> | null): Promise<T | null> {
  const upload = await readArtUpload(event, slot)
  // Loaded here, not at the top, so jsdom and sharp are only read once art is uploaded.
  const { processArt } = await import('../special-days/art')
  const art = await answeringArtErrors(() => processArt(slot, upload))

  const db = useDb()
  const dir = useSpecialDayArtDir()
  const name = writeArtFile(dir, art.data, art.ext)
  try {
    const change = apply(name)
    removeUnreferencedArt(db, dir, [change ? change.previous : name])
    return change ? change.row : null
  } catch (error) {
    removeUnreferencedArt(db, dir, [name])
    throw error
  }
}

/**
 * Clears a slot with `apply` and removes the file it held if nothing else
 * refers to it. Returns the changed row, or null if the row has gone.
 */
export function clearArt<T>(apply: () => ArtChange<T> | null): T | null {
  const change = apply()
  if (!change) return null
  removeUnreferencedArt(useDb(), useSpecialDayArtDir(), [change.previous])
  return change.row
}
