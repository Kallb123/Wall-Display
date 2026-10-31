import { commandSchema } from '../../../../shared/display'
import type { DisplayState } from '../../../../shared/display'
import { getScene } from '../../../special-days/scenes'
import { getSpecialDay } from '../../../special-days/store'

// Applies one command to a display, such as `{ "type": "set_view", "view": "agenda" }`,
// and answers with the new state. A bad command is a 400 with a short reason.
// With `remote.pin` set the request needs it in the `x-wallcal-pin` header (401 without it, 429 after
// too many wrong tries). The PIN middleware checks that before this runs, so an unauthenticated caller can't learn which displays exist.
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

  if (command.type === 'preview_special_day') {
    if (command.id !== undefined && !getSpecialDay(useDb(), command.id)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${command.id}"` })
    if (command.scene !== undefined && !getScene(useDb(), command.scene)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown scene "${command.scene}"` })
  }

  return control.applyCommand(id, command)
})
