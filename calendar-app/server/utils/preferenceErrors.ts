import { PreferencesRefusedError, UnknownDisplayError } from '../settings/store'

/**
 * Runs a preferences save and answers the errors the store throws as the HTTP
 * error they stand for: a refusal is a 400 with the message per key as
 * `data.fields`, an unknown display is a 404. Anything else passes through.
 */
export function answeringPreferenceErrors<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof PreferencesRefusedError) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: error.message, data: { fields: error.fields } })
    }
    if (error instanceof UnknownDisplayError) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found', message: error.message })
    }
    throw error
  }
}
