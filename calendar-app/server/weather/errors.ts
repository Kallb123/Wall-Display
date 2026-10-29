import { SourceError } from '../sources/errors'

/**
 * A failed fetch or parse of the weather from Home Assistant. See SourceError:
 * the access token is a secret and so is the address of the Home Assistant
 * server, so no message ever holds either.
 */
export class WeatherError extends SourceError {
  constructor(kind: 'fetch' | 'parse', message: string) {
    super(kind, message)
    this.name = 'WeatherError'
  }
}
