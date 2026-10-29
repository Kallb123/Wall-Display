import type { HomeAssistantConfig } from '../../config/schema'
import { discard, networkErrorMessage } from '../http'

// Asks Home Assistant whether it is there and accepts the token, for the
// settings page (architecture §7.6). Like the calendar fetch, the messages it
// returns are safe to show: never the URL or the token.

export interface PingHaOptions {
  /** For tests. Default: the global `fetch`. */
  fetch?: typeof fetch
  /** Default 5000. The page waits on this, so it is shorter than a calendar fetch's. */
  timeoutMs?: number
}

/** What a check found. `error` is a short, safe sentence. */
export type HaCheck = { ok: true } | { ok: false, error: string }

const DEFAULT_TIMEOUT_MS = 5000

/**
 * `GET <url>/api/`, which answers `{"message": "API running."}` to a valid
 * token. Never rejects: whatever went wrong comes back as `{ ok: false }`.
 */
export async function checkHomeAssistant(homeassistant: Pick<HomeAssistantConfig, 'url' | 'token'>, options: PingHaOptions = {}): Promise<HaCheck> {
  const fetchFn = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let url: URL
  try {
    url = new URL(homeassistant.url)
  } catch {
    // Not the parser's message, which quotes the address.
    return { ok: false, error: 'the Home Assistant URL is not valid' }
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/`
  url.search = ''
  url.hash = ''

  let response: Response
  try {
    response = await fetchFn(url.href, {
      headers: { Authorization: `Bearer ${homeassistant.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return { ok: false, error: networkErrorMessage(error, timeoutMs) }
  }

  // Only the status matters, so the body is never read.
  await discard(response)
  if (response.ok) return { ok: true }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: `Home Assistant refused the access token (HTTP ${response.status})` }
  }
  return { ok: false, error: `HTTP ${response.status} ${response.statusText}`.trim() }
}
