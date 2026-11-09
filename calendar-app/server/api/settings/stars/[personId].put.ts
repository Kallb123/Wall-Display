import type { StarSettingsEntry } from '../../../../shared/stars'
import { parseStarSettingsBody } from '../../../stars/body'
import { saveStarSettings, starSettingsEntries } from '../../../stars/store'

// Replaces a person's whole star chart settings (on or off, period, goal) and
// answers with the entry as `GET /api/settings/stars` lists it. 404 for a
// person who is not in the config, and a bad body is a 400 that names the field.
export default defineEventHandler(async (event): Promise<StarSettingsEntry> => {
  const personId = getRouterParam(event, 'personId') ?? ''
  const people = useConfig().people
  if (!people.some(person => person.id === personId)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown person "${personId}"` })
  }

  const body = await readValidatedBody(event, parseStarSettingsBody)
  const db = useDb()
  saveStarSettings(db, personId, body, new Date())
  useStars().changed()
  return starSettingsEntries(db, people).find(entry => entry.id === personId)!
})
