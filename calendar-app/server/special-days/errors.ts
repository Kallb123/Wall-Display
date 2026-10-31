/** A special day or scene the API refuses, with the status it answers and, where it helps, the days it is about. */
export interface DayRef {
  id: string
  name: string
}

/**
 * Thrown by the checks and the scene store for a request that is well formed
 * but not allowed: an unknown scene (400), a greeting some day can't fill
 * (400) or a scene still in use (409). `server/utils/specialDayErrors.ts` turns
 * it into the HTTP error. Kept free of h3, so the stores can be tested alone.
 */
export class SpecialDayError extends Error {
  readonly statusCode: 400 | 409
  readonly days: DayRef[]

  constructor(statusCode: 400 | 409, message: string, days: DayRef[] = []) {
    super(message)
    this.name = 'SpecialDayError'
    this.statusCode = statusCode
    this.days = days
  }
}

/** "A", "A and B", "A, B and C". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
