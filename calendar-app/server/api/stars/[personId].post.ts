import { todayIn } from '../../../shared/dates'
import { starHistory } from '../../../shared/stars'
import type { StarChart } from '../../../shared/stars'
import { parseStarAdjustBody } from '../../stars/body'
import { adjustStars, getStarSettings } from '../../stars/store'

// Adds stars to a person's day, or with a negative `delta` takes some away, and
// answers with the whole new chart. The day is today in the config's time zone
// unless the body names one, and it must be one the chart holds: not after
// today, and not before the first of the last two weeks (400). 404 for a person
// who is not in the config, 409 for one whose chart is switched off. The count
// stops at 0 and at the most a day can hold. With `remote.pin` set the PIN
// middleware has already checked the `x-wallcal-pin` header.
export default defineEventHandler(async (event): Promise<StarChart> => {
  const personId = getRouterParam(event, 'personId') ?? ''
  const config = useConfig()
  if (!config.people.some(person => person.id === personId)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown person "${personId}"` })
  }

  const body = await readValidatedBody(event, parseStarAdjustBody)
  const now = new Date()
  const today = todayIn(now, config.timezone)
  const date = body.date ?? today
  const { first } = starHistory(today)
  if (date > today) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `date ${date} is in the future (today is ${today})` })
  }
  if (date < first) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `date ${date} is too long ago: stars can be changed from ${first} to ${today}` })
  }

  const db = useDb()
  if (!getStarSettings(db, personId).enabled) {
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: `"${personId}" does not have a star chart switched on` })
  }
  adjustStars(db, personId, date, body.delta, now)
  const stars = useStars()
  stars.changed()
  return stars.get()
})
