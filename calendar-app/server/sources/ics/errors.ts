/**
 * A failed fetch or parse of an ICS feed. The message is safe to store, show
 * on the settings page and log: an ICS URL is a secret (Google's "secret
 * address" carries a token), so no message ever holds the URL or a piece of it.
 */
export class IcsSourceError extends Error {
  constructor(readonly kind: 'fetch' | 'parse', message: string) {
    super(message)
    this.name = 'IcsSourceError'
  }
}

/** The message to store for any error: ours as written, anything else by name only. */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof IcsSourceError) return error.message
  return `unexpected error (${error instanceof Error ? error.name : 'unknown'})`
}
