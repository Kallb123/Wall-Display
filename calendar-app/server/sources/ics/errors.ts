import { SourceError } from '../errors'

/**
 * A failed fetch or parse of an ICS feed. See SourceError: an ICS URL is a
 * secret (Google's "secret address" carries a token), so no message ever holds
 * the URL or a piece of it.
 */
export class IcsSourceError extends SourceError {
  constructor(kind: 'fetch' | 'parse', message: string) {
    super(kind, message)
    this.name = 'IcsSourceError'
  }
}
