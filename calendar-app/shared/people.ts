// Person detection: who an event is for, from the names in its title and
// description and from the calendar's keyword rules (architecture §3.3). Pure:
// no I/O, and no imports from server/, so the display and the settings page can
// use it too. The config types satisfy the structural types below.
//
// What this is not: it does not fetch, store or re-resolve anything. The store
// calls it on every write, whichever source the event came from.

/**
 * Bump this when the algorithm changes in a way that can change a result, so
 * the next boot re-resolves the stored events (it is part of the calendar's
 * config hash).
 */
export const DETECTION_VERSION = 1

export interface DetectionPerson {
  id: string
  name: string
  aliases: readonly string[]
}

export interface DetectionRule {
  /** A regular expression, matched case-insensitively. */
  match: string
  people: readonly string[]
}

export interface DetectionCalendar {
  /** The default person's id. */
  person: string
  detect_people: boolean | 'anywhere'
  detect_in: readonly ('title' | 'description')[]
  strip_names: boolean
  rules: readonly DetectionRule[]
}

export interface DetectableEvent {
  title: string
  description: string | null
}

export interface ResolvedPeople {
  /** In the order found, without duplicates. Never empty. */
  personIds: string[]
  /** The title for the wall: the title, minus a name prefix when `strip_names` is on. */
  displayTitle: string
  /** Which step decided. For the settings page's "fell through to the default" list; not stored. */
  matchedBy: 'name' | 'rule' | 'default'
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }

function codePointToString(codePoint: number): string | null {
  // Not zero, not past Unicode, and not a lone surrogate half.
  if (!Number.isInteger(codePoint) || codePoint < 1 || codePoint > 0x10FFFF) return null
  if (codePoint >= 0xD800 && codePoint <= 0xDFFF) return null
  return String.fromCodePoint(codePoint)
}

/**
 * A description as plain text. Google often stores them as HTML: `<br>`, `<p>`,
 * `<div>` and `<li>` become line breaks, other tags are removed and entities are
 * decoded. Only things that look like tags go (a `<` followed by a letter, `/` or
 * `!`), so "a < b" and "I <3 it" survive. Entities are decoded last, so `&lt;b&gt;`
 * stays the text "<b>".
 */
export function htmlToText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/<br\b[^<>]*>/gi, '\n')
    .replace(/<\/?(?:p|div|li)\b[^<>]*>/gi, '\n')
    .replace(/<[a-z/!][^<>]*>/gi, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined) return ENTITIES[name.toLowerCase()] ?? whole
      return codePointToString(decimal !== undefined ? Number(decimal) : parseInt(hex!, 16)) ?? whole
    })
}

/** The non-blank lines of a description, trimmed, as plain text. */
function descriptionLines(description: string): string[] {
  return htmlToText(description).split('\n').map(line => line.trim()).filter(line => line !== '')
}

/** A name list at the start of a line, and what to do with the line around it. */
interface NamePrefix {
  personIds: string[]
  /** Where the text after the prefix (and its delimiter) starts. */
  end: number
  /** A separator follows the list ("Theo and friends"): still Theo's, but not safe to strip. */
  dangling: boolean
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const termKey = (term: string) => term.trim().replace(/\s+/g, ' ').toLowerCase()

// A delimiter after the name list, with optional spaces: "Theo: ...", "Theo - ...".
const DELIMITER = /^\s*[:\-–—|]\s*/
// What starts a list that carries on, so a prefix followed by it is not a whole prefix.
const DANGLING_SEPARATOR = /^\s*(?:[,&+/]|and\b)/i

/**
 * Compiles the people's names into the matchers detection needs. Done once per
 * resolver: a sync resolves thousands of events.
 */
function compileNames(people: readonly DetectionPerson[]) {
  const personOf = new Map<string, string>()
  for (const person of people) {
    for (const term of [person.name, ...person.aliases]) {
      if (term.trim() !== '' && !personOf.has(termKey(term))) personOf.set(termKey(term), person.id)
    }
  }
  if (personOf.size === 0) return null

  // Longest first, so "Grandma Jo" wins over "Grandma", and spaces in a term match any run of whitespace.
  const alternation = [...personOf.keys()]
    .sort((a, b) => b.length - a.length)
    .map(term => term.split(' ').map(escapeRegExp).join('\\s+'))
    .join('|')
  // A whole word: not inside another word before it, and not in front of letters or a possessive after it.
  const name = `(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}'’])`
  const separator = '(?:\\s*[,&+/]\\s*|\\s+and\\s+)'
  const list = `${name}(?:${separator}${name})*`
  const label = '(?:(who|for)\\s*:\\s*)?'
  // The bracketed forms need their closing bracket; the bare form is checked for a delimiter afterwards.
  const forms = [
    { closed: true, pattern: new RegExp(`^\\s*\\[\\s*${label}(${list})\\s*\\]`, 'iu') },
    { closed: true, pattern: new RegExp(`^\\s*\\(\\s*${label}(${list})\\s*\\)`, 'iu') },
    { closed: false, pattern: new RegExp(`^\\s*${label}(${list})`, 'iu') },
  ]
  const each = new RegExp(name, 'giu')

  const idsIn = (text: string): string[] =>
    [...text.matchAll(each)].flatMap(match => personOf.get(termKey(match[0])) ?? [])

  return {
    idsIn,

    /** The people named at the start of a line (`Theo: ...`, `[Isla & Theo] ...`, `Who: Mum`), if it starts with a name list. */
    prefixOf(text: string): NamePrefix | null {
      for (const { closed, pattern } of forms) {
        const match = pattern.exec(text)
        if (!match) continue
        const personIds = idsIn(match[2]!)
        const rest = text.slice(match[0].length)
        const done = (consumed: number, dangling = false): NamePrefix => ({ personIds, end: match[0].length + consumed, dangling })

        // A closing bracket is delimiter enough.
        if (closed) return done(0)
        const delimiter = DELIMITER.exec(rest)
        if (delimiter) return done(delimiter[0].length)
        // A names-only line.
        if (rest.trim() === '') return done(rest.length)
        if (DANGLING_SEPARATOR.test(rest)) return done(0, true)
        // After "Who:" or "For:" the rest of the line is ignored.
        if (match[1] !== undefined) return done(/^\s*/.exec(rest)![0].length)
        // "Theo Swimming": whitespace, then more text.
        const space = /^\s+(?=\S)/.exec(rest)
        if (space) return done(space[0].length)
        return null
      }
      return null
    },
  }
}

/**
 * Builds the function that resolves an event's people for one calendar. The
 * regular expressions are compiled once, so build it once per sync (or per
 * re-resolve) and call it for every event.
 *
 * Rule patterns are compiled with the `i` flag only, as the config check does:
 * `u` would reject patterns the config accepts, such as `\-` or `\_`.
 */
export function createPeopleResolver(
  calendar: DetectionCalendar,
  people: readonly DetectionPerson[],
): (event: DetectableEvent) => ResolvedPeople {
  const names = calendar.detect_people === false ? null : compileNames(people)
  const anywhere = calendar.detect_people === 'anywhere'
  const inTitle = calendar.detect_in.includes('title')
  const inDescription = calendar.detect_in.includes('description')
  const rules = calendar.rules.map(rule => ({ pattern: new RegExp(rule.match, 'i'), people: rule.people }))

  return (event) => {
    const lines = inDescription && event.description ? descriptionLines(event.description) : []
    const texts = inTitle ? [event.title, ...lines] : lines

    // Step 1: names, title first and then each description line.
    const titlePrefix = names && inTitle ? names.prefixOf(event.title) : null
    const named = names
      ? texts.flatMap(text => anywhere ? names.idsIn(text) : names.prefixOf(text)?.personIds ?? [])
      : []
    if (named.length > 0) {
      return { personIds: unique(named), displayTitle: displayTitleOf(event.title, calendar, titlePrefix), matchedBy: 'name' }
    }

    // Step 2: keyword rules, for each text in turn.
    const ruled = texts.flatMap(text => rules.flatMap(rule => rule.pattern.test(text) ? rule.people : []))
    if (ruled.length > 0) {
      return { personIds: unique(ruled), displayTitle: event.title, matchedBy: 'rule' }
    }

    // Step 3: the calendar's own person.
    return { personIds: [calendar.person], displayTitle: event.title, matchedBy: 'default' }
  }
}

/** `createPeopleResolver` for one event. Use the resolver when there are many. */
export function resolvePeople(
  event: DetectableEvent,
  calendar: DetectionCalendar,
  people: readonly DetectionPerson[],
): ResolvedPeople {
  return createPeopleResolver(calendar, people)(event)
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}

/** The title with its name prefix removed, when the calendar asks for that and what is left is worth showing. */
function displayTitleOf(title: string, calendar: DetectionCalendar, prefix: NamePrefix | null): string {
  if (!calendar.strip_names || !prefix || prefix.dangling) return title
  const rest = title.slice(prefix.end).trim()
  // A names-only title, or one that leaves nothing but punctuation, stays as it was.
  return /[\p{L}\p{N}]/u.test(rest) ? rest : title
}
