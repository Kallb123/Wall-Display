// What the wall shows for an event's location. Feeds put anything in the
// field: a full postal address, a room, or just the link of a video call.

/** Schemes that mean a link without a `//` after them, such as `tel:` and `mailto:`. */
const LINK_SCHEMES = /^(?:tel|mailto|sms|geo|callto|facetime|skype|webcal|zoommtg|zoomus|msteams|sip):\S/i

/** A host with at least one dot whose last label is two or more letters (`meet.google.com`, `zoom.us/j/123`), then a path, a port, a query or the end. */
const BARE_HOST = /^[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:[/:?]|$)/i

/** Whether the text is only a web address or a call link: it has no whitespace, and starts with a scheme or looks like a domain. */
function isLink(text: string): boolean {
  if (/\s/.test(text)) return false
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || LINK_SCHEMES.test(text) || BARE_HOST.test(text)
}

/**
 * The location as the wall shows it, or null for nothing worth showing: no
 * location, a blank one, or one that is only a link. A longer location is
 * cut down to its first part, the text before the first comma or line break
 * ("Leisure Centre, 12 High Street, Town" is "Leisure Centre"), with runs of
 * white space made one space. A feed may hold a line break or a comma as the
 * two characters `\n` or `\,`, so those count too.
 */
export function eventLocation(location: string | null | undefined): string | null {
  const text = location?.trim()
  if (!text || isLink(text)) return null
  const first = text
    .split(/\\[nN]|\r\n|[\r\n]|\\?,/)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .find(part => part !== '')
  if (!first || isLink(first)) return null
  return first
}
