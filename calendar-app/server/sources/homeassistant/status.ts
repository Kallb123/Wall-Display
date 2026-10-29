import { safeErrorMessage } from '../errors'
import type { HaCheck } from './ping'

// Remembers the last Home Assistant check for a minute. The settings page asks
// every few seconds, and each of those shouldn't be a request to Home Assistant
// with its token. Pure: the check and the clock are passed in.

export type HaStatus = HaCheck & {
  /** When the check finished. */
  checkedAt: Date
}

export interface HaStatusCache {
  /** The last check if it is fresh enough, otherwise a new one. Never rejects. */
  get: () => Promise<HaStatus>
}

export interface HaStatusCacheOptions {
  check: () => Promise<HaCheck>
  /** For tests. Default: the real time. */
  now?: () => Date
  /** How long a result is reused, failures included, in milliseconds. Default 60 000. */
  ttlMs?: number
}

export function createHaStatusCache({ check, now = () => new Date(), ttlMs = 60_000 }: HaStatusCacheOptions): HaStatusCache {
  let last: HaStatus | undefined
  let inFlight: Promise<HaStatus> | undefined

  async function refresh(): Promise<HaStatus> {
    let result: HaCheck
    try {
      result = await check()
    } catch (error) {
      // The check isn't meant to throw, but whatever does must not reach the page as more than a name.
      result = { ok: false, error: safeErrorMessage(error) }
    }
    last = { ...result, checkedAt: now() }
    return last
  }

  return {
    get() {
      if (last && now().getTime() - last.checkedAt.getTime() < ttlMs) return Promise.resolve(last)
      // Callers that arrive while a check is running share it.
      inFlight ??= refresh().finally(() => {
        inFlight = undefined
      })
      return inFlight
    },
  }
}
