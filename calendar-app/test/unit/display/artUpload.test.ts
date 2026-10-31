import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ART_LIMITS } from '../../../server/special-days/art-errors'
import { requestFailure } from '../../../app/utils/remote'
import { ART_SLOT_LABELS, artFileProblem, uploadArt, uploadFailure } from '../../../app/utils/artUpload'
import type { ArtSlot } from '../../../app/utils/artUpload'

const MB = 1024 * 1024

const file = (name: string, type: string, size = 1000) => ({ name, type, size })

describe('ART_SLOT_LABELS', () => {
  it('names the slots', () => {
    expect(ART_SLOT_LABELS).toEqual({ tile: 'Tile art', full: 'Full-screen art', extra: 'Extra layer' })
  })
})

describe('artFileProblem', () => {
  it('accepts a PNG, WebP or SVG for the tile and the extra layer', () => {
    for (const slot of ['tile', 'extra'] as const) {
      expect(artFileProblem(slot, file('a.png', 'image/png'))).toBeNull()
      expect(artFileProblem(slot, file('a.webp', 'image/webp'))).toBeNull()
      expect(artFileProblem(slot, file('a.svg', 'image/svg+xml'))).toBeNull()
    }
  })

  it('refuses a photo format or another kind of file for the tile and the extra layer', () => {
    expect(artFileProblem('tile', file('a.jpg', 'image/jpeg'))).toBe('Tile art must be a PNG, WebP or SVG')
    expect(artFileProblem('tile', file('a.gif', 'image/gif'))).toBe('Tile art must be a PNG, WebP or SVG')
    expect(artFileProblem('tile', file('a.pdf', 'application/pdf'))).toBe('Tile art must be a PNG, WebP or SVG')
    expect(artFileProblem('extra', file('a.jpg', 'image/jpeg'))).toBe('Extra layer must be a PNG, WebP or SVG')
    expect(artFileProblem('extra', file('a.txt', 'text/plain'))).toBe('Extra layer must be a PNG, WebP or SVG')
  })

  it('accepts any image for full-screen art, and refuses anything else', () => {
    expect(artFileProblem('full', file('a.jpg', 'image/jpeg'))).toBeNull()
    expect(artFileProblem('full', file('a.png', 'image/png'))).toBeNull()
    expect(artFileProblem('full', file('a.heic', 'image/heic'))).toBeNull()
    expect(artFileProblem('full', file('a.pdf', 'application/pdf'))).toBe('Full-screen art must be an image')
    expect(artFileProblem('full', file('a.mp4', 'video/mp4'))).toBe('Full-screen art must be an image')
  })

  it('goes by the ending of the name when the browser gave no type', () => {
    expect(artFileProblem('tile', file('a.PNG', ''))).toBeNull()
    expect(artFileProblem('tile', file('tile.v2.svg', ''))).toBeNull()
    expect(artFileProblem('tile', file('a.jpeg', ''))).toBe('Tile art must be a PNG, WebP or SVG')
    expect(artFileProblem('full', file('a.jpeg', ''))).toBeNull()
    expect(artFileProblem('full', file('a.webp', ''))).toBeNull()
    expect(artFileProblem('full', file('a.docx', ''))).toBe('Full-screen art must be an image')
    expect(artFileProblem('tile', file('png', ''))).toBe('Tile art must be a PNG, WebP or SVG')
    expect(artFileProblem('tile', file('noending', ''))).toBe('Tile art must be a PNG, WebP or SVG')
  })

  it('trusts the type over the name when it has one', () => {
    expect(artFileProblem('tile', file('a.png', 'application/pdf'))).toBe('Tile art must be a PNG, WebP or SVG')
    expect(artFileProblem('tile', file('a.pdf', 'image/png'))).toBeNull()
  })

  it('limits the tile to 2 MB and the others to 20 MB', () => {
    expect(artFileProblem('tile', file('a.png', 'image/png', 2 * MB))).toBeNull()
    expect(artFileProblem('tile', file('a.png', 'image/png', 2 * MB + 1))).toBe('Tile art must be 2 MB or smaller (this one is 2.1 MB)')
    expect(artFileProblem('full', file('a.jpg', 'image/jpeg', 20 * MB))).toBeNull()
    expect(artFileProblem('full', file('a.jpg', 'image/jpeg', 20 * MB + 1))).toBe('Full-screen art must be 20 MB or smaller (this one is 20.1 MB)')
    expect(artFileProblem('extra', file('a.png', 'image/png', 20 * MB))).toBeNull()
    expect(artFileProblem('extra', file('a.png', 'image/png', 25 * MB))).toBe('Extra layer must be 20 MB or smaller (this one is 25.0 MB)')
  })

  it('says how big the file is, to a tenth of a megabyte', () => {
    expect(artFileProblem('tile', file('a.png', 'image/png', Math.round(3.4 * MB)))).toBe('Tile art must be 2 MB or smaller (this one is 3.4 MB)')
  })

  it('judges the type before the size', () => {
    expect(artFileProblem('tile', file('a.jpg', 'image/jpeg', 30 * MB))).toBe('Tile art must be a PNG, WebP or SVG')
  })

  it('refuses an empty file', () => {
    expect(artFileProblem('tile', file('a.png', 'image/png', 0))).toBe('Tile art is empty')
  })

  it('has the same limits as the server', () => {
    for (const slot of Object.keys(ART_LIMITS) as ArtSlot[]) {
      const limit = ART_LIMITS[slot]
      expect(artFileProblem(slot, file('a.png', 'image/png', limit))).toBeNull()
      expect(artFileProblem(slot, file('a.png', 'image/png', limit + 1))).toContain('or smaller')
    }
  })
})

describe('uploadFailure', () => {
  const failure = (statusCode: number, message?: string) => ({ statusCode, data: message === undefined ? {} : { message } })

  it('says the server could not be reached when there was no answer', () => {
    expect(uploadFailure('tile', new TypeError('Failed to fetch'))).toBe('Couldn\'t reach the server')
    expect(uploadFailure('full', undefined)).toBe('Couldn\'t reach the server')
  })

  it('gives the server\'s message for a refusal of the file, with a capital letter', () => {
    for (const status of [400, 411, 413, 415]) {
      expect(uploadFailure('tile', failure(status, 'the file is too large'))).toBe('The file is too large')
    }
  })

  it('has a plain message for the slot when the server gave none', () => {
    expect(uploadFailure('tile', failure(413))).toBe('Tile art is too large')
    expect(uploadFailure('full', failure(415))).toBe('Full-screen art is not a file type that can be used')
    expect(uploadFailure('extra', failure(400))).toBe('Extra layer could not be used')
    expect(uploadFailure('tile', failure(411))).toBe('Tile art could not be sent')
  })

  it('says it could not upload for any other failure', () => {
    expect(uploadFailure('tile', failure(500, 'boom'))).toBe('Couldn\'t upload the tile art')
    expect(uploadFailure('full', failure(404))).toBe('Couldn\'t upload the full-screen art')
    expect(uploadFailure('extra', failure(403, 'no'))).toBe('Couldn\'t upload the extra layer')
  })
})

/** The parts of XMLHttpRequest that `uploadArt` uses, for a test to drive. */
class FakeRequest {
  static last: FakeRequest | null = null

  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown = null
  status = 0
  responseText = ''
  upload: { onprogress: ((event: { lengthComputable: boolean, loaded: number, total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null

  constructor() {
    FakeRequest.last = this
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body: unknown) {
    this.body = body
  }

  /** The server answers. */
  respond(status: number, body: string) {
    this.status = status
    this.responseText = body
    this.onload?.()
  }
}

describe('uploadArt', () => {
  beforeEach(() => {
    FakeRequest.last = null
    vi.stubGlobal('XMLHttpRequest', FakeRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const art = new File([new Uint8Array(10)], 'tile.png', { type: 'image/png' })
  const request = (): FakeRequest => FakeRequest.last!

  it('posts the file as multipart in the field file, with the headers', () => {
    void uploadArt('/api/special-days/isla/art/tile', art, { 'x-wallcal-pin': '1234' }, () => {})
    expect(request().method).toBe('POST')
    expect(request().url).toBe('/api/special-days/isla/art/tile')
    expect(request().headers).toMatchObject({ 'x-wallcal-pin': '1234' })
    expect(request().body).toBeInstanceOf(FormData)
    const sent = (request().body as FormData).get('file') as File
    expect(sent.name).toBe('tile.png')
    expect(sent.size).toBe(10)
  })

  it('does not set the content type, so the browser adds the multipart boundary', () => {
    void uploadArt('/up', art, {}, () => {})
    expect(Object.keys(request().headers).map(name => name.toLowerCase())).not.toContain('content-type')
  })

  it('reports how much has been sent, when the browser knows the total', () => {
    const progress: number[] = []
    void uploadArt('/up', art, {}, fraction => progress.push(fraction))
    request().upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 })
    request().upload.onprogress?.({ lengthComputable: false, loaded: 50, total: 0 })
    request().upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 })
    expect(progress).toEqual([0.25, 1])
  })

  it('resolves with the JSON the server answered', async () => {
    const result = uploadArt<{ id: string }>('/up', art, {}, () => {})
    request().respond(200, '{"id":"isla"}')
    await expect(result).resolves.toEqual({ id: 'isla' })
  })

  it('resolves for any 2xx', async () => {
    const result = uploadArt<{ ok: boolean }>('/up', art, {}, () => {})
    request().respond(201, '{"ok":true}')
    await expect(result).resolves.toEqual({ ok: true })
  })

  it('rejects with the status and the server\'s body for a refusal, as $fetch does', async () => {
    const result = uploadArt('/up', art, {}, () => {})
    request().respond(413, '{"message":"The file is too large"}')
    const error = await result.catch((caught: unknown) => caught)
    expect(error).toEqual({ statusCode: 413, data: { message: 'The file is too large' } })
    expect(requestFailure(error)).toEqual({ status: 413, message: 'The file is too large' })
    expect(uploadFailure('tile', error)).toBe('The file is too large')
  })

  it('rejects a 401 so the PIN guard can ask for a PIN', async () => {
    const result = uploadArt('/up', art, {}, () => {})
    request().respond(401, '{"message":"PIN required"}')
    expect(requestFailure(await result.catch((caught: unknown) => caught))).toEqual({ status: 401, message: 'PIN required' })
  })

  it('rejects with a status and no message when the body is not JSON', async () => {
    const result = uploadArt('/up', art, {}, () => {})
    request().respond(502, '<html>Bad gateway</html>')
    const error = await result.catch((caught: unknown) => caught)
    expect(error).toEqual({ statusCode: 502, data: {} })
    expect(uploadFailure('tile', error)).toBe('Couldn\'t upload the tile art')
  })

  it('rejects when a 2xx has no JSON to give', async () => {
    const result = uploadArt('/up', art, {}, () => {})
    request().respond(200, '')
    await expect(result).rejects.toMatchObject({ statusCode: 200 })
  })

  it('rejects with a TypeError when the network fails, as fetch does', async () => {
    const result = uploadArt('/up', art, {}, () => {})
    request().onerror?.()
    await expect(result).rejects.toBeInstanceOf(TypeError)
    expect(uploadFailure('tile', await result.catch((caught: unknown) => caught))).toBe('Couldn\'t reach the server')
  })

  it('rejects with a TypeError when the upload is aborted or times out', async () => {
    const aborted = uploadArt('/up', art, {}, () => {})
    request().onabort?.()
    await expect(aborted).rejects.toBeInstanceOf(TypeError)
    const timedOut = uploadArt('/up', art, {}, () => {})
    request().ontimeout?.()
    await expect(timedOut).rejects.toBeInstanceOf(TypeError)
  })
})
