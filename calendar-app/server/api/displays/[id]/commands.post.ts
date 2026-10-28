import { commandSchema } from '../../../../shared/display'
import type { DisplayState } from '../../../../shared/display'

// Applies one command to a display, such as `{ "type": "set_view", "view": "agenda" }`,
// and answers with the new state. A bad command is a 400 with a short reason.
// The remote's PIN check arrives in PR 1.8; until then anyone on the network can call this.
export default defineEventHandler(async (event): Promise<DisplayState> => {
  const id = getRouterParam(event, 'id') ?? ''
  const control = useDisplayControl()
  if (!control.hasDisplay(id)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown display "${id}"` })

  const command = await readValidatedBody(event, (body) => {
    const parsed = commandSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!
      throw new Error(`${issue.path.join('.') || 'command'} ${issue.message}`)
    }
    return parsed.data
  })

  return control.applyCommand(id, command)
})
