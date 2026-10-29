import { createHash, timingSafeEqual } from 'node:crypto'

// The check behind the remote's optional shared PIN (architecture §7.5). Pure:
// no Nuxt imports, and the clock is passed in, so it can be tested without
// waiting. A PIN is only four to twelve digits, so it can be guessed; the
// lockout is what makes that slow, and the comparison takes the same time
// however much of a guess is right.

export type PinResult = 'ok' | 'missing' | 'wrong' | 'locked'

export interface PinGuardOptions {
  /** Wrong PINs one client may send in a window before it is locked out. */
  maxFailures?: number
  /** How long a client's failures are held, counted from its first, in milliseconds. */
  windowMs?: number
  now?: () => number
}

export interface PinGuard {
  /**
   * Checks the PIN a request sent. With no PIN configured (`expected` is
   * undefined) everything is `ok`. A request with no PIN is `missing`, and
   * isn't counted: the page sends none until it learns one is needed. A wrong
   * PIN is counted against `client`; once it has had `maxFailures` of them it is
   * `locked`, even with the right PIN, until the window after its first has passed.
   */
  check: (expected: string | undefined, given: string | undefined, client: string) => PinResult
  /** How many clients have failures on record, as of the last check. For tests. */
  size: () => number
}

interface Failures {
  count: number
  /** When the window ends: `windowMs` after the first counted failure. */
  until: number
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** A guard with its own failure counts. The server keeps one for the whole process. */
export function createPinGuard({ maxFailures = 10, windowMs = 5 * 60_000, now = () => Date.now() }: PinGuardOptions = {}): PinGuard {
  const failures = new Map<string, Failures>()

  return {
    check(expected, given, client) {
      if (expected === undefined) return 'ok'

      const time = now()
      // Dropped on every check, so the map can't grow without bound.
      for (const [key, entry] of failures) {
        if (entry.until <= time) failures.delete(key)
      }

      if (given === undefined || given === '') return 'missing'

      const entry = failures.get(client)
      if (entry && entry.count >= maxFailures) return 'locked'

      // The digests are the same length whatever the PINs are, so neither the
      // comparison nor timingSafeEqual's length check leaks the PIN's length.
      if (timingSafeEqual(digest(expected), digest(given))) {
        failures.delete(client)
        return 'ok'
      }

      if (entry) entry.count += 1
      else failures.set(client, { count: 1, until: time + windowMs })
      return 'wrong'
    },
    size: () => failures.size,
  }
}
