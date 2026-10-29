// What the remote page and the server agree on for the optional shared PIN
// (`remote.pin` in config, architecture §7.5). Pure: no I/O, and no imports
// from server/, so the page can use it too.

/**
 * The request header that carries the PIN. Every write under `/api/` (any
 * method but GET, HEAD or OPTIONS: the commands, `POST /api/refresh`, the
 * settings pages' saves and uploads) answers 401 when a PIN is set and this
 * header is missing or wrong, and 429 after too many wrong tries. Reads and the
 * WebSocket don't need it.
 */
export const PIN_HEADER = 'x-wallcal-pin'

/** A PIN as the config accepts it: 4 to 12 digits. */
export const PIN_PATTERN = /^\d{4,12}$/

/**
 * What `GET /api/remote` answers: whether writes need a PIN.
 * Never the PIN itself.
 */
export interface RemoteInfo {
  pin_required: boolean
}

/**
 * The `message` of each refusal, so the page can tell them apart without
 * matching on wording it doesn't own.
 */
export const PIN_ERRORS = {
  /** 401: a PIN is set and the request had none. */
  missing: 'PIN required',
  /** 401: the PIN sent was not the one in config. */
  wrong: 'Wrong PIN',
  /** 429: too many wrong PINs from this address; try again later. */
  locked: 'Too many wrong PINs. Try again in a few minutes.',
} as const
