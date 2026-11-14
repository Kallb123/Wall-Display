import { photoPoolInputSchema } from '../../shared/photoPools'
import type { PhotoPoolInput } from '../../shared/photoPools'

/**
 * Checks the body of a create or an edit of a pool. A bad one throws an error
 * whose message names the field first, like `sources.0.query must …`, which
 * `readValidatedBody` answers as a 400.
 */
export function parsePhotoPoolBody(body: unknown): PhotoPoolInput {
  const parsed = photoPoolInputSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    // A key the schema doesn't know has no path of its own, so name it from the issue.
    if (issue.code === 'unrecognized_keys') throw new Error(`${[...issue.path, issue.keys[0]].join('.')} is not a field of a pool`)
    if (issue.code === 'invalid_union') throw new Error(`${issue.path.join('.')} is not a source of a known kind`)
    throw new Error(`${issue.path.join('.') || 'pool'} ${issue.message}`)
  }
  return parsed.data
}
