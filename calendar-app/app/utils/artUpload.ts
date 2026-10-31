import { requestFailure } from './remote'
import { SERVER_UNREACHABLE } from './settings'
import { upperFirst } from './specialDayEditor'

// Uploading art for special days (architecture §6.4): the check the editor
// makes on a file before sending it, so a wrong type or a huge file is refused
// at once and not after minutes of uploading, the upload itself with progress,
// and the words for an upload that failed. The server checks the file again and
// has the last word; this only saves the wait. Pure: no Nuxt or Vue imports.

/** Where an upload goes: a tile (days and scenes), full-screen art (both) or the extra layer (days only). */
export type ArtSlot = 'tile' | 'full' | 'extra'

/** How each slot is named in messages. */
export const ART_SLOT_LABELS: Record<ArtSlot, string> = {
  tile: 'Tile art',
  full: 'Full-screen art',
  extra: 'Extra layer',
}

const MB = 1024 * 1024

// The same as ART_LIMITS in server/special-days/art-errors.ts, which the app can't import. A test holds them together.
const LIMITS: Record<ArtSlot, number> = { tile: 2 * MB, full: 20 * MB, extra: 20 * MB }

/** What the tile and the extra layer take: files that keep their transparency and stay sharp at any size. */
const GRAPHIC_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/webp', 'image/svg+xml'])

/** The type for a file name's ending, for a file the browser gave no type. Empty if it isn't an image the server reads. */
const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  jp2: 'image/jp2',
}

/** The file's type, from the browser or else from its name; empty if neither says. */
function typeOf(file: Pick<File, 'name' | 'type'>): string {
  if (file.type !== '') return file.type.toLowerCase()
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  return file.name.includes('.') ? (EXTENSION_TYPES[extension] ?? '') : ''
}

/** `3.4`, rounded up so a file that is over the limit never reads as exactly the limit. */
const megabytes = (bytes: number): string => (Math.ceil(bytes / MB * 10) / 10).toFixed(1)

/**
 * Why the file can't be uploaded to the slot, or null if it can: `Tile art must
 * be a PNG, WebP or SVG`, `Tile art must be 2 MB or smaller (this one is 3.4 MB)`.
 * The tile takes a PNG, WebP or SVG up to 2 MB, and the extra layer the same
 * up to 20 MB. Full-screen art takes any image up to 20 MB (the server reads
 * the others, and says if it can't). A file the browser gave no type is judged
 * by its ending.
 */
export function artFileProblem(slot: ArtSlot, file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  const label = ART_SLOT_LABELS[slot]
  const type = typeOf(file)
  if (slot === 'full' ? !type.startsWith('image/') : !GRAPHIC_TYPES.has(type)) {
    return slot === 'full' ? `${label} must be an image` : `${label} must be a PNG, WebP or SVG`
  }
  if (file.size === 0) return `${label} is empty`
  if (file.size > LIMITS[slot]) return `${label} must be ${LIMITS[slot] / MB} MB or smaller (this one is ${megabytes(file.size)} MB)`
  return null
}

/** What an upload says when the server gives no reason of its own, by status. */
function uploadDefault(slot: ArtSlot, status: number): string | null {
  const label = ART_SLOT_LABELS[slot]
  if (status === 413) return `${label} is too large`
  if (status === 415) return `${label} is not a file type that can be used`
  if (status === 400) return `${label} could not be used`
  if (status === 411) return `${label} could not be sent`
  return null
}

/**
 * Words an upload that failed. No answer is "Couldn't reach the server". A
 * refusal of the file (too large, the wrong type, unusable, no length) is the
 * server's own message with a capital letter, or a plain one for the slot if it
 * gave none. Anything else is a general failure for the slot.
 */
export function uploadFailure(slot: ArtSlot, error: unknown): string {
  const { status, message } = requestFailure(error)
  if (status === null) return SERVER_UNREACHABLE
  const fallback = uploadDefault(slot, status)
  if (fallback === null) return `Couldn't upload the ${ART_SLOT_LABELS[slot].toLowerCase()}`
  return message ? upperFirst(message) : fallback
}

/** The answer of a failed upload, shaped like a `$fetch` error so `requestFailure` and the PIN guard can read it. */
export interface UploadError {
  statusCode: number
  data: { message?: string }
}

/** The body of a response as an object, or an empty one if it isn't JSON. */
function jsonBody(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/**
 * Uploads `file` as multipart (the field `file`) with `XMLHttpRequest`, as
 * `fetch` can't report how much has gone. It resolves with the JSON the server
 * answered for a 2xx. Any other status rejects with an `UploadError`
 * (`{ statusCode, data }`, `data` being the server's body) and no answer at all
 * with a `TypeError`, the same as `$fetch`. `onProgress` gets how much of the
 * upload has been sent, from 0 to 1, whenever the browser knows the total.
 */
export function uploadArt<T>(url: string, file: File, headers: Record<string, string>, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', url)
    request.setRequestHeader('accept', 'application/json')
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value)

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
    }
    request.onload = () => {
      const body = jsonBody(request.responseText)
      if (request.status >= 200 && request.status < 300 && body !== undefined) {
        resolve(body as T)
        return
      }
      const data = typeof body === 'object' && body !== null ? body as UploadError['data'] : {}
      reject({ statusCode: request.status, data } satisfies UploadError)
    }
    const failed = () => reject(new TypeError('Failed to fetch'))
    request.onerror = failed
    request.onabort = failed
    request.ontimeout = failed

    const form = new FormData()
    form.append('file', file)
    request.send(form)
  })
}
