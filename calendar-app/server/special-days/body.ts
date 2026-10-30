import { specialDayInputSchema } from '../../shared/special-days'
import type { SpecialDayInput } from '../../shared/special-days'

/**
 * Checks the body of a create or an edit. A bad one throws an error whose
 * message names the field first, like `day must …`, which `readValidatedBody`
 * answers as a 400.
 */
export function parseSpecialDayBody(body: unknown): SpecialDayInput {
  const parsed = specialDayInputSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    // A key the schema doesn't know has no path of its own, so name it from the issue.
    if (issue.code === 'unrecognized_keys') throw new Error(`${issue.keys[0]} is not a field of a special day`)
    throw new Error(`${issue.path.join('.') || 'special day'} ${issue.message}`)
  }
  return parsed.data
}
