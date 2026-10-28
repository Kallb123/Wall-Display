import type { EventsResponse } from '../../shared/types/events'
import { listEvents, parseEventRange } from '../sources/query'

// The events that overlap a range, with their people. `from` and `to` are each
// a date (midnight at the start of that day in the display time zone) or an
// ISO 8601 time with Z or an offset. Bad input is a 400 with a short reason.
export default defineEventHandler(async (event): Promise<EventsResponse> => {
  const config = useConfig()
  const { from, to } = await getValidatedQuery(event, query => parseEventRange(query, config.timezone))

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    events: listEvents(useDb(), { from, to, calendars: config.calendars, people: config.people }),
  }
})
