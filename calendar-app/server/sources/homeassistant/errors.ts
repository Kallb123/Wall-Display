import { SourceError } from '../errors'

/**
 * A failed fetch or parse of a Home Assistant calendar. See SourceError: the
 * access token is a secret and so is the address of the Home Assistant server,
 * so no message ever holds either.
 */
export class HomeAssistantSourceError extends SourceError {
  constructor(kind: 'fetch' | 'parse', message: string) {
    super(kind, message)
    this.name = 'HomeAssistantSourceError'
  }
}
