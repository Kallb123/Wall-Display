import { starAdjustBodySchema, starSettingsBodySchema } from '../../shared/stars'
import type { StarAdjustBody, StarSettingsBody } from '../../shared/stars'

// Checks the bodies of the star chart's two writes. A bad one throws an error
// whose message names the field first, like `delta must not be 0`, which
// `readValidatedBody` answers as a 400.

function check<T>(schema: { safeParse: (body: unknown) => { success: true, data: T } | { success: false, error: { issues: { code: string, path: PropertyKey[], message: string, keys?: string[] }[] } } }, body: unknown, what: string): T {
  const parsed = schema.safeParse(body)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]!
  // A key the schema doesn't know has no path of its own, so name it from the issue.
  if (issue.code === 'unrecognized_keys') throw new Error(`${issue.keys![0]} is not a field of ${what}`)
  throw new Error(`${issue.path.map(String).join('.') || what} ${issue.message}`)
}

export function parseStarAdjustBody(body: unknown): StarAdjustBody {
  return check(starAdjustBodySchema, body, 'a star adjustment')
}

export function parseStarSettingsBody(body: unknown): StarSettingsBody {
  return check(starSettingsBodySchema, body, 'star chart settings')
}
