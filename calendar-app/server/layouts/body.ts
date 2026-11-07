import { customLayoutInputSchema } from '../../shared/layouts'
import type { CustomLayoutInput } from '../../shared/layouts'

/**
 * Checks the body of a create or an edit of a layout. A bad one throws an error
 * whose message names the field first, like `landscape.rows.0.size must …`,
 * which `readValidatedBody` answers as a 400.
 */
export function parseLayoutBody(body: unknown): CustomLayoutInput {
  const parsed = customLayoutInputSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    // A key the schema doesn't know has no path of its own, so name it from the issue.
    if (issue.code === 'unrecognized_keys') throw new Error(`${issue.keys[0]} is not a field of a layout`)
    throw new Error(`${issue.path.join('.') || 'layout'} ${issue.message}`)
  }
  return parsed.data
}
