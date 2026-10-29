import { displayStateSchema } from '../../shared/display'
import type { Command, DisplayState } from '../../shared/display'
import { requestFailure } from '~/utils/remote'

/** What the page says when a request gets no answer, or one it didn't expect. */
export const UNREACHABLE = 'Couldn\'t reach the wall'
const REFUSED = 'The wall didn\'t accept that'

/**
 * Everything the remote page asks of the server: commands, and the shared PIN
 * they may need (architecture §7.5), which `usePinRequest` looks after. If the
 * server wants a PIN and the phone has none (or has a wrong one), `pinNeeded`
 * opens the sheet, and the command that was refused is sent again once a PIN
 * has been accepted. `onState` gets the state each command answers with, so the
 * page needn't wait for the socket.
 */
export function useRemoteCommands(displayId: MaybeRefOrGetter<string | null>, onState: (state: DisplayState) => void) {
  const pin = usePinRequest(UNREACHABLE)

  /** A short, dismissible message about the last command, or null. */
  const error = ref<string | null>(null)

  /** Counts commands sent. Only the latest one's answer is shown: two quick taps can be answered out of order. */
  let sendCount = 0

  /** Sends one command. Returns whether the server took it. */
  async function send(command: Command): Promise<boolean> {
    const id = toValue(displayId)
    if (!id) return false
    const count = ++sendCount
    try {
      const sent = await pin.guard(headers => $fetch<unknown>(`/api/displays/${encodeURIComponent(id)}/commands`, {
        method: 'POST',
        body: command,
        headers,
      }), () => send(command))
      error.value = null
      // Refused for want of a PIN: the sheet is open, and the command goes again once it is accepted.
      if (!sent) return false
      const parsed = displayStateSchema.safeParse(sent.value)
      // An older answer would undo a newer one, and the socket only speaks again on the next change.
      if (parsed.success && count === sendCount) onState(parsed.data)
      return true
    } catch (caught) {
      error.value = requestFailure(caught).status === null ? UNREACHABLE : REFUSED
      return false
    }
  }

  function dismissError() {
    error.value = null
  }

  return {
    error,
    pinNeeded: pin.pinNeeded,
    pinMessage: pin.pinMessage,
    checkingPin: pin.checkingPin,
    load: pin.load,
    send,
    submitPin: pin.submitPin,
    cancelPin: pin.cancelPin,
    dismissError,
  }
}
