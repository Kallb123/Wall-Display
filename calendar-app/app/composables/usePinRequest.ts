import { PIN_ERRORS, PIN_HEADER, PIN_PATTERN } from '../../shared/remote'
import type { RemoteInfo } from '../../shared/remote'
import { browserStorage } from '~/utils/displayCache'
import { clearPin, loadPin, requestFailure, savePin } from '~/utils/remote'

/**
 * The shared PIN (architecture §7.5): the remote's commands and the settings
 * pages' writes are guarded by the same one, kept in `localStorage` under the
 * same key, so a PIN typed on either page works on the other. It goes on a
 * request as a header. If the server wants one and the browser has none (or a
 * wrong one), `pinNeeded` opens the page's PIN dialog, and whatever was
 * refused is tried again once a PIN has been accepted. The dialog itself is
 * the page's: the remote has a bottom sheet, the settings pages a centred card.
 *
 * `unreachable` is what the dialog says when the PIN check gets no answer.
 */
export function usePinRequest(unreachable: string) {
  const storage = browserStorage()

  /** The PIN dialog is open. */
  const pinNeeded = ref(false)
  /** What the dialog says about the last PIN tried, or null. */
  const pinMessage = ref<string | null>(null)
  const checkingPin = ref(false)

  /** What the server refused for want of a PIN, in order, to run again once it has one. */
  let refused: (() => Promise<unknown>)[] = []

  const pinHeaders = (pin: string | null): Record<string, string> => pin ? { [PIN_HEADER]: pin } : {}

  /** Asks the server whether a PIN is needed, and asks for one if so. If the server can't say, the first request will find out. */
  async function load() {
    try {
      const info = await $fetch<RemoteInfo>('/api/remote')
      if (info.pin_required && !loadPin(storage)) pinNeeded.value = true
    } catch {
      // Offline, or a server that doesn't know: nothing to ask yet.
    }
  }

  /**
   * Runs `request` with the PIN this browser has (if any). It answers
   * `{ value }` when the request went through, or null when the server asked
   * for a PIN: the dialog is then open, and `again` runs once one is accepted.
   * Any other failure is thrown for the caller to word, as it would be without a PIN.
   */
  async function guard<T>(request: (headers: Record<string, string>) => Promise<T>, again: () => Promise<unknown>): Promise<{ value: T } | null> {
    const pin = loadPin(storage)
    try {
      return { value: await request(pinHeaders(pin)) }
    } catch (caught) {
      const { status, message } = requestFailure(caught)
      if (status !== 401 && status !== 429) throw caught
      // A PIN that was sent and refused is no use again.
      if (status === 401 && pin) clearPin(storage)
      refused.push(again)
      pinMessage.value = status === 429 ? PIN_ERRORS.locked : message === PIN_ERRORS.wrong ? PIN_ERRORS.wrong : null
      pinNeeded.value = true
      return null
    }
  }

  /** Checks a PIN with the server and, if it is right, keeps it and runs again what was refused. */
  async function submitPin(pin: string) {
    if (!PIN_PATTERN.test(pin)) {
      pinMessage.value = 'Enter 4 to 12 digits'
      return
    }
    checkingPin.value = true
    try {
      await $fetch('/api/remote/pin', { method: 'POST', headers: pinHeaders(pin) })
    } catch (caught) {
      const { status } = requestFailure(caught)
      pinMessage.value = status === 401 ? PIN_ERRORS.wrong : status === 429 ? PIN_ERRORS.locked : unreachable
      return
    } finally {
      checkingPin.value = false
    }
    savePin(storage, pin)
    pinNeeded.value = false
    pinMessage.value = null
    const again = refused
    refused = []
    for (const run of again) await run()
  }

  /** Closes the dialog without a PIN. What was refused is dropped: nobody asked for it twice. */
  function cancelPin() {
    pinNeeded.value = false
    pinMessage.value = null
    refused = []
  }

  return { pinNeeded, pinMessage, checkingPin, load, guard, submitPin, cancelPin }
}
