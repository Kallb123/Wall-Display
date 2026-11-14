import type { HomeAssistantConfig } from '../config/schema'
import { discard, networkErrorMessage, readBody } from './http'
import type { SourceError } from './errors'

// One request to Home Assistant's REST API for one entity's state, shared by
// the alarm and the timers. It returns the body of the answer as text and
// leaves reading it to the caller. Error messages never include the URL or the
// token (see SourceError), and the errors that carry them are never kept as a
// cause. What the caller's errors are called is injected, so each feature keeps
// its own error class.

export interface FetchHaStateOptions {
  /** For tests. Default: the global `fetch`. */
  fetch?: typeof fetch
  /** Default 30 000. */
  timeoutMs?: number
  /** The largest response accepted, in bytes. Default 256 KiB: one entity's state is small. */
  maxBytes?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 256 * 1024

/**
 * The body of `GET /api/states/<entity_id>`. `fail` makes the error to throw (a
 * feature's own subclass of SourceError) and `what` names the response in the
 * message about one that is too large, such as "the alarm response".
 */
export async function fetchHaStateBody(
  homeassistant: Pick<HomeAssistantConfig, 'url' | 'token'>,
  entityId: string,
  options: FetchHaStateOptions,
  fail: (kind: 'fetch' | 'parse', message: string) => SourceError,
  what: string,
): Promise<string> {
  const fetchFn = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const url = endpoint(homeassistant.url, `/api/states/${encodeURIComponent(entityId)}`, fail)
  const init: RequestInit = {
    headers: { 'Authorization': `Bearer ${homeassistant.token}`, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  }

  let response: Response
  try {
    response = await fetchFn(url, init)
  } catch (error) {
    throw fail('fetch', networkErrorMessage(error, timeoutMs))
  }

  if (!response.ok) {
    await discard(response)
    if (response.status === 401 || response.status === 403) {
      throw fail('fetch', `Home Assistant refused the access token (HTTP ${response.status})`)
    }
    if (response.status === 404) throw fail('fetch', `Home Assistant has no entity "${entityId}" (HTTP 404)`)
    throw fail('fetch', `HTTP ${response.status} ${response.statusText}`.trim())
  }

  let large: SourceError | undefined
  const tooLarge = () => (large = fail('fetch', `the ${what} response is larger than ${Math.max(1, Math.round(maxBytes / 1024))} KB`))
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response)
    throw tooLarge()
  }

  try {
    return await readBody(response, maxBytes, tooLarge)
  } catch (error) {
    // The too-large error passes through as it is; anything else is a network failure.
    if (error === large) throw error
    throw fail('fetch', networkErrorMessage(error, timeoutMs))
  }
}

/** `<url><path>`, whether or not the base has a trailing slash or a path of its own. */
function endpoint(base: string, path: string, fail: (kind: 'fetch' | 'parse', message: string) => SourceError): string {
  let url: URL
  try {
    url = new URL(base)
  } catch {
    // Not `cause`, and not the parser's message: both quote the address.
    throw fail('fetch', 'the Home Assistant URL is not valid')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
  url.search = ''
  url.hash = ''
  return url.href
}
