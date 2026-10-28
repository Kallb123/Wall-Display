import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { IcsSourceError } from './errors'

// Fetches an ICS feed, conditionally. Error messages never include the URL
// (see IcsSourceError), and the errors that carry it are never kept as a cause.

export interface Validators {
  etag: string | null
  lastModified: string | null
}

export type FetchIcsResult =
  | { status: 'not-modified' }
  | { status: 'ok', body: string, etag: string | null, lastModified: string | null }

export interface FetchIcsOptions {
  /** For tests. Default: the global `fetch`. */
  fetch?: typeof fetch
  /** Default 30 000. */
  timeoutMs?: number
  /** The largest feed accepted, in bytes. Default 20 MiB. */
  maxBytes?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024

export async function fetchIcs(url: string, validators: Validators, options: FetchIcsOptions = {}): Promise<FetchIcsResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const protocol = protocolOf(url)
  if (protocol === 'file:') return await readIcsFile(url, validators, maxBytes)
  if (protocol === 'http:' || protocol === 'https:') return await fetchIcsOverHttp(url, validators, options.fetch ?? fetch, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBytes)
  throw new IcsSourceError('fetch', 'the calendar URL must be http(s) or file')
}

function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol
  } catch {
    return null
  }
}

async function fetchIcsOverHttp(url: string, validators: Validators, fetchFn: typeof fetch, timeoutMs: number, maxBytes: number): Promise<FetchIcsResult> {
  const headers: Record<string, string> = { Accept: 'text/calendar, */*;q=0.5' }
  if (validators.etag) headers['If-None-Match'] = validators.etag
  if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified

  const signal = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetchFn(url, { headers, signal })
  } catch (error) {
    throw networkError(error, timeoutMs)
  }

  if (response.status === 304) {
    await discard(response)
    return { status: 'not-modified' }
  }
  if (!response.ok) {
    await discard(response)
    throw new IcsSourceError('fetch', `HTTP ${response.status} ${response.statusText}`.trim())
  }

  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response)
    throw tooLarge(maxBytes)
  }

  let body: string
  try {
    body = await readBody(response, maxBytes)
  } catch (error) {
    if (error instanceof IcsSourceError) throw error
    throw networkError(error, timeoutMs)
  }
  assertCalendar(body)
  return { status: 'ok', body, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') }
}

/** Reads the body as UTF-8, stopping as soon as it passes the limit. */
async function readBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).length > maxBytes) throw tooLarge(maxBytes)
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let received = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) throw tooLarge(maxBytes)
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

function tooLarge(maxBytes: number): IcsSourceError {
  return new IcsSourceError('fetch', `the calendar is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`)
}

// Whatever went wrong, say it without the original message: undici's messages
// can name the host, and Node's can carry the whole URL.
function networkError(error: unknown, timeoutMs: number): IcsSourceError {
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new IcsSourceError('fetch', `timed out after ${+(timeoutMs / 1000).toFixed(2)} s`)
  }
  const code = errorCode(error)
  return new IcsSourceError('fetch', code ? `could not connect (${code})` : 'could not connect')
}

function errorCode(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

async function readIcsFile(url: string, validators: Validators, maxBytes: number): Promise<FetchIcsResult> {
  let path: string
  try {
    path = fileURLToPath(url)
  } catch {
    throw new IcsSourceError('fetch', 'the calendar file URL is not valid')
  }

  try {
    const info = await stat(path)
    const lastModified = new Date(Math.floor(info.mtimeMs / 1000) * 1000).toUTCString()
    if (validators.lastModified === lastModified) return { status: 'not-modified' }
    if (info.size > maxBytes) throw tooLarge(maxBytes)

    const body = new TextDecoder('utf-8').decode(await readFile(path))
    assertCalendar(body)
    return { status: 'ok', body, etag: null, lastModified }
  } catch (error) {
    if (error instanceof IcsSourceError) throw error
    const code = errorCode(error)
    throw new IcsSourceError('fetch', code ? `could not read the calendar file (${code})` : 'could not read the calendar file')
  }
}

// A 200 that is really a login page or an error page would otherwise parse as
// an empty calendar and wipe the stored events.
function assertCalendar(body: string): void {
  if (!/^\uFEFF?\s*BEGIN:VCALENDAR/i.test(body)) {
    throw new IcsSourceError('fetch', 'the response is not an iCalendar file')
  }
}
