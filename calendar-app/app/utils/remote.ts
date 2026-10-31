import { MONTH_RANGE, PHOTO_SOURCES, addMonths } from '../../shared/display'
import type { MonthKey, PhotoSource } from '../../shared/display'

// What the remote page works out from what it knows: the months the picker
// offers, which `set_month` command a pick means, what the connection pill
// says, and the PIN it keeps in `localStorage`. Storage can be missing or
// blocked, so every access is guarded and a failure is the same as nothing
// kept. Pure: no Nuxt or Vue imports, and the storage is passed in.

export interface MonthOption {
  value: MonthKey
  /** `October 2026`. */
  label: string
}

// UTC and a fixed locale, so a label is the same whatever the phone's time zone and language.
const labelFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })

/** `2026-10` as `October 2026`. */
export function monthLabel(key: MonthKey): string {
  return labelFormat.format(new Date(`${key}-01T00:00:00Z`))
}

/** The months the picker offers: `MONTH_RANGE` either side of `current`, earliest first. */
export function monthOptions(current: MonthKey): MonthOption[] {
  return Array.from({ length: MONTH_RANGE * 2 + 1 }, (_, i) => {
    const value = addMonths(current, i - MONTH_RANGE)
    return { value, label: monthLabel(value) }
  })
}

/** What to send to show `target`: picking the current month unpins it, which `current` says. */
export function monthCommandFor(target: MonthKey, current: MonthKey): MonthKey | 'current' {
  return target === current ? 'current' : target
}

/** The photo sources in the order the remote offers them, with the words on each segment. The folder is `local` on the wire. */
export const PHOTO_SOURCE_CHOICES: { source: PhotoSource, label: string }[] = [
  { source: 'immich', label: 'Immich' },
  { source: 'google', label: 'Google' },
  { source: 'local', label: 'Folder' },
]

/**
 * The source a display really uses, which is what the segmented control should
 * show selected. The server uses `chosen` if it is set up and otherwise the
 * first that is (Immich, Google, then the folder), so a display left on the
 * default `immich` with only a folder set up is showing the folder. Null when
 * nothing is set up.
 */
export function effectivePhotoSource(chosen: PhotoSource, available: readonly PhotoSource[]): PhotoSource | null {
  if (available.includes(chosen)) return chosen
  return PHOTO_SOURCES.find(source => available.includes(source)) ?? null
}

/** How long "Skipped" stays on the Next photo button. */
export const SKIPPED_MS = 2000

/** How long the socket may be down before the pill gives up saying "Reconnecting". */
export const OFFLINE_AFTER_MS = 10_000

export type ConnectionState = 'connected' | 'reconnecting' | 'offline'

/**
 * The connection pill. Connected while the socket is open: that is proof
 * enough, whatever `navigator.onLine` guesses. Otherwise Reconnecting (the
 * first connection counts) until the socket has been down for `OFFLINE_AFTER_MS`,
 * then Offline. A phone that knows it has no network is Offline at once, as
 * there is nothing to wait for.
 */
export function connectionState(input: { open: boolean, online: boolean, notOpenMs: number }): ConnectionState {
  if (input.open) return 'connected'
  if (!input.online) return 'offline'
  return input.notOpenMs < OFFLINE_AFTER_MS ? 'reconnecting' : 'offline'
}

const PIN_KEY = 'wallcal.remote.pin'

/** The PIN this phone kept, or null. Storage can be missing or blocked, so a failure is the same as no PIN. */
export function loadPin(storage: Storage | null | undefined): string | null {
  try {
    return storage?.getItem(PIN_KEY) || null
  } catch {
    return null
  }
}

/** Keeps the PIN the server accepted, so the phone doesn't ask again. */
export function savePin(storage: Storage | null | undefined, pin: string): void {
  try {
    storage?.setItem(PIN_KEY, pin)
  } catch {
    // Nothing to do: the PIN is asked for again next time.
  }
}

/** Forgets the PIN, once the server has refused it. */
export function clearPin(storage: Storage | null | undefined): void {
  try {
    storage?.removeItem(PIN_KEY)
  } catch {
    // Nothing to do: a PIN that can't be removed is refused again, and asked for again.
  }
}

/** The HTTP status and the server's `message` of a failed `$fetch`, or a null status if it never got an answer. */
export function requestFailure(error: unknown): { status: number | null, message: string | null } {
  if (typeof error !== 'object' || error === null) return { status: null, message: null }
  const { statusCode, data } = error as { statusCode?: unknown, data?: { message?: unknown } | null }
  return {
    status: typeof statusCode === 'number' ? statusCode : null,
    message: typeof data?.message === 'string' ? data.message : null,
  }
}
