import { SpecialDayError } from '../special-days/errors'

/**
 * Runs a special day or scene write and answers a `SpecialDayError` it throws
 * as the HTTP error it stands for: the message, and the days it names as
 * `data.days`. Anything else passes through.
 */
export function answeringSpecialDayErrors<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (!(error instanceof SpecialDayError)) throw error
    throw createError({
      statusCode: error.statusCode,
      statusMessage: error.statusCode === 409 ? 'Conflict' : 'Bad Request',
      message: error.message,
      data: error.days.length > 0 ? { days: error.days } : undefined,
    })
  }
}
