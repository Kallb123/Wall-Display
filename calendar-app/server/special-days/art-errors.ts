// The parts of the art pipeline that the routes need without the image
// libraries: the slots, their size limits and the error the pipeline throws.
// `art.ts` imports jsdom, which is slow to load, so nothing that is loaded at
// boot may import it. This file has no imports for that reason.

/** Where an upload goes: a tile (days and scenes), full-screen art (both) or the extra layer (days only). */
export type ArtSlot = 'tile' | 'full' | 'extra'

const MB = 1024 * 1024

/** The most bytes an upload for each slot may have. */
export const ART_LIMITS: Record<ArtSlot, number> = { tile: 2 * MB, full: 20 * MB, extra: 20 * MB }

/** What can't be stored: too large (413), the wrong kind of file (415) or a file that can't be used (400). */
export class ArtError extends Error {
  readonly statusCode: 400 | 413 | 415

  constructor(statusCode: 400 | 413 | 415, message: string) {
    super(message)
    this.name = 'ArtError'
    this.statusCode = statusCode
  }
}
