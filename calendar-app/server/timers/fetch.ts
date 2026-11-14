import type { HomeAssistantConfig } from '../config/schema'
import { fetchHaStateBody } from '../sources/haState'
import type { FetchHaStateOptions } from '../sources/haState'
import { TimersError } from './errors'

// Reads one timers entity's state from Home Assistant's REST API and hands it
// on as it came, for parse.ts to make sense of: the same entity state object
// the WebSocket sends, so both ways in end up in one place. The request is in
// sources/haState.ts. Error messages never include the URL or the token (see
// TimersError).

export type FetchHaTimerStateOptions = FetchHaStateOptions

/** The state object of one entity (`{ entity_id, state, attributes, ... }`), unread. Throws a TimersError if the answer is not JSON or not an object. */
export async function fetchHaTimerState(homeassistant: Pick<HomeAssistantConfig, 'url' | 'token'>, entityId: string, options: FetchHaTimerStateOptions = {}): Promise<unknown> {
  const body = await fetchHaStateBody(homeassistant, entityId, options, (kind, message) => new TimersError(kind, message), 'timers')
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    throw new TimersError('parse', 'the response is not JSON')
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new TimersError('parse', 'the response is not an entity state')
  return json
}
