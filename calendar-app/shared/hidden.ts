// Hiding an event from the wall: a line that is just "hide" in its description.
// Pure: no I/O, and no imports from server/, so any side can use it. It is
// checked on read, not at sync time, so adding or removing the line takes
// effect on the next sync with no migration. Only the description counts, never
// the title, whatever the calendar's `detect_in` says.

import { htmlToText } from './people'

/** The word that, alone on a line of a description, hides the event. */
export const HIDE_WORD = 'hide'

/**
 * Whether the description has a line that, trimmed, is `hide` in any case. The
 * description is read as plain text first, so `<p>hide</p>` and `Who: Theo<br>hide`
 * count, and "hide this", "don't hide" and "hidden" do not. No description is
 * not hidden.
 */
export function isHiddenEvent(description: string | null): boolean {
  if (!description) return false
  return htmlToText(description).split('\n').some(line => line.trim().toLowerCase() === HIDE_WORD)
}
