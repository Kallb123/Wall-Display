import { z } from 'zod'
import { MAX_SPECIAL_DAY_NAME, specialDayInputSchema, specialDaySceneInputSchema } from '../../shared/special-days'
import type { SpecialDayInput, SpecialDaySceneInput } from '../../shared/special-days'

// Checks the bodies of the special day and scene routes. A bad one throws an
// error whose message names the field first, like `day must …`, which
// `readValidatedBody` answers as a 400.

function firstProblem(error: z.ZodError, what: string, article = 'a'): Error {
  const issue = error.issues[0]!
  // A key the schema doesn't know has no path of its own, so name it from the issue.
  if (issue.code === 'unrecognized_keys') return new Error(`${issue.keys[0]} is not a field of ${article} ${what}`)
  return new Error(`${issue.path.join('.') || what} ${issue.message}`)
}

/** The body of a create or an edit of a special day. */
export function parseSpecialDayBody(body: unknown): SpecialDayInput {
  const parsed = specialDayInputSchema.safeParse(body)
  if (!parsed.success) throw firstProblem(parsed.error, 'special day')
  return parsed.data
}

/** The body of a create or an edit of a scene. */
export function parseSpecialDaySceneBody(body: unknown): SpecialDaySceneInput {
  const parsed = specialDaySceneInputSchema.safeParse(body)
  if (!parsed.success) throw firstProblem(parsed.error, 'scene')
  return parsed.data
}

const saveAsSceneSchema = z.strictObject({
  name: z.string().trim().min(1, 'must not be empty').max(MAX_SPECIAL_DAY_NAME, `must be at most ${MAX_SPECIAL_DAY_NAME} characters`).optional(),
})

/** The optional body of save-as-scene: `{ "name": "…" }`, or nothing, to name the scene after the day. */
export function parseSaveAsSceneBody(body: unknown): { name?: string } {
  const parsed = saveAsSceneSchema.safeParse(body ?? {})
  if (!parsed.success) throw firstProblem(parsed.error, 'save-as-scene body', 'the')
  return parsed.data
}
