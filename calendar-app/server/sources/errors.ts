/**
 * A failed fetch or parse of a calendar source. The message is safe to store,
 * show on the settings page and log: an ICS URL and a Home Assistant token are
 * secrets, so no message ever holds a URL, a host or a piece of either.
 */
export class SourceError extends Error {
  constructor(readonly kind: 'fetch' | 'parse', message: string) {
    super(message)
    this.name = 'SourceError'
  }
}

/** The message to store for any error: ours as written, anything else by name only. */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof SourceError) return error.message
  return `unexpected error (${error instanceof Error ? error.name : 'unknown'})`
}
