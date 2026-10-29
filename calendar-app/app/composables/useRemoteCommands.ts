import { displayStateSchema } from '../../shared/display'
import type { Command, DisplayState } from '../../shared/display'
import { PIN_ERRORS, PIN_HEADER, PIN_PATTERN } from '../../shared/remote'
import type { RemoteInfo } from '../../shared/remote'
import { browserStorage } from '~/utils/displayCache'
import { clearPin, loadPin, savePin } from '~/utils/remote'

/** What the page says when a request gets no answer, or one it didn't expect. */
export const UNREACHABLE = 'Couldn\'t reach the wall'
const REFUSED = 'The wall didn\'t accept that'

/** The HTTP status and the server's `message` of a failed `$fetch`, or null status if it never got an answer. */
function failure(error: unknown): { status: number | null, message: string | null } {
  if (typeof error !== 'object' || error === null) return { status: null, message: null }
  const { statusCode, data } = error as { statusCode?: unknown, data?: { message?: unknown } | null }
  return {
    status: typeof statusCode === 'number' ? statusCode : null,
    message: typeof data?.message === 'string' ? data.message : null,
  }
}

/**
 * Everything the remote page asks of the server: commands, and the shared PIN
 * they may need (architecture §7.5). The PIN lives in `localStorage` and goes
 * on every command as a header. If the server wants one and the phone has none
 * (or has a wrong one), `pinNeeded` opens the sheet, and the command that was
 * refused is sent again once a PIN has been accepted. `onState` gets the state
 * each command answers with, so the page needn't wait for the socket.
 */
export function useRemoteCommands(displayId: MaybeRefOrGetter<string | null>, onState: (state: DisplayState) => void) {
  const storage = browserStorage()

  /** A short, dismissible message about the last command, or null. */
  const error = ref<string | null>(null)
  /** The PIN sheet is open. */
  const pinNeeded = ref(false)
  /** What the sheet says about the last PIN tried, or null. */
  const pinMessage = ref<string | null>(null)
  const checkingPin = ref(false)

  /** Commands the server refused for want of a PIN, in order, to send again once it has one. */
  let refused: Command[] = []

  const pinHeaders = (pin: string | null): Record<string, string> => pin ? { [PIN_HEADER]: pin } : {}

  /** Asks the server whether a PIN is needed, and asks for one if so. If the server can't say, the first command will find out. */
  async function load() {
    try {
      const info = await $fetch<RemoteInfo>('/api/remote')
      if (info.pin_required && !loadPin(storage)) pinNeeded.value = true
    } catch {
      // Offline, or a server that doesn't know: nothing to ask yet.
    }
  }

  /** Sends one command. Returns whether the server took it. */
  async function send(command: Command): Promise<boolean> {
    const id = toValue(displayId)
    if (!id) return false
    const pin = loadPin(storage)
    try {
      const next = await $fetch<unknown>(`/api/displays/${encodeURIComponent(id)}/commands`, {
        method: 'POST',
        body: command,
        headers: pinHeaders(pin),
      })
      const parsed = displayStateSchema.safeParse(next)
      if (parsed.success) onState(parsed.data)
      error.value = null
      return true
    } catch (caught) {
      const { status, message } = failure(caught)
      if (status === 401 || status === 429) {
        // A PIN that was sent and refused is no use again.
        if (status === 401 && pin) clearPin(storage)
        refused.push(command)
        pinMessage.value = status === 429 ? PIN_ERRORS.locked : message === PIN_ERRORS.wrong ? PIN_ERRORS.wrong : null
        pinNeeded.value = true
        error.value = null
      } else {
        error.value = status === null ? UNREACHABLE : REFUSED
      }
      return false
    }
  }

  /** Checks a PIN with the server and, if it is right, keeps it and sends again what was refused. */
  async function submitPin(pin: string) {
    if (!PIN_PATTERN.test(pin)) {
      pinMessage.value = 'Enter 4 to 12 digits'
      return
    }
    checkingPin.value = true
    try {
      await $fetch('/api/remote/pin', { method: 'POST', headers: pinHeaders(pin) })
    } catch (caught) {
      const { status } = failure(caught)
      pinMessage.value = status === 401 ? PIN_ERRORS.wrong : status === 429 ? PIN_ERRORS.locked : UNREACHABLE
      return
    } finally {
      checkingPin.value = false
    }
    savePin(storage, pin)
    pinNeeded.value = false
    pinMessage.value = null
    const again = refused
    refused = []
    for (const command of again) await send(command)
  }

  /** Closes the sheet without a PIN. What was refused is dropped: nobody asked for it twice. */
  function cancelPin() {
    pinNeeded.value = false
    pinMessage.value = null
    refused = []
  }

  function dismissError() {
    error.value = null
  }

  return { error, pinNeeded, pinMessage, checkingPin, load, send, submitPin, cancelPin, dismissError }
}
