// Person detection: who an event is for, from the names in its title and
// description and from the calendar's keyword rules (architecture §3.3). Pure:
// no I/O, and no imports from server/, so the display and the settings page can
// use it too. The config types satisfy the structural types below.
//
// What this is not: it does not fetch, store or re-resolve anything. The store
// calls it on every write, whichever source the event came from.

import { dayOfWeek, wallClockIn } from './dates'

/**
 * Bump this when the algorithm changes in a way that can change a result, so
 * the next boot re-resolves the stored events (it is part of the calendar's
 * config hash).
 */
export const DETECTION_VERSION = 2

export interface DetectionPerson {
  id: string
  name: string
  aliases: readonly string[]
}

/** A named set of people ("the boys"): its name and aliases are matched like a person's and expand to the members. */
export interface DetectionGroup {
  id: string
  name: string
  aliases: readonly string[]
  /** Person ids, in order. */
  people: readonly string[]
}

export interface DetectionRule {
  /** A regular expression, matched case-insensitively. Left out, any text matches, so the rule goes by the event's time alone. */
  match?: string | undefined
  /** Empty for a rule that only sets an icon. */
  people: readonly string[]
  /** One emoji, drawn before the title of an event the rule matches. */
  icon?: string | undefined
  /**
   * `HH:MM`, with `to`: the rule matches only timed events that start at or
   * after `from` and before `to`, on the wall's clock. `from` after `to` runs
   * past midnight. All-day events never match a rule with a time.
   */
  from?: string | undefined
  to?: string | undefined
  /** The days (`mon` to `sun`) an event must start on. Left out, any day. */
  days?: readonly string[] | undefined
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
  /** When it starts. Only rules with a time or days read it; an event without it never matches them. */
  startAt?: Date | undefined
  allDay?: boolean | undefined
}

export interface ResolvedPeople {
  /** In the order found, without duplicates. Never empty. */
  personIds: string[]
  /** The title for the wall: the title, minus a name prefix and a trailing "for" clause when `strip_names` is on. */
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

/** A "for <names>" clause in a text: "Haircut for Adam and Alex". */
interface ForClause {
  personIds: string[]
  /** Where the word "for" starts. */
  start: number
  /** Where the name list ends. */
  end: number
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
// What may follow the names of a "for" clause: the end of the text, or punctuation. Anything else
// ("Cake for Mum to collect") means the names were just part of a sentence.
const FOR_END = '(?=\\s*(?:$|[.,;:!?)\\]\\-–—|(]))'
// All that may follow a "for" clause for it to count as the end of a title.
const TRAILING = /^[\s.!?]*$/
// What is left dangling at the end of a title once its "for" clause is cut off.
const TRAILING_SEPARATORS = /[\s,;:\-–—|]+$/u
// What starts a list that carries on, so a prefix followed by it is not a whole prefix.
const DANGLING_SEPARATOR = /^\s*(?:[,&+/]|and\b)/i

/**
 * Compiles the people's and groups' names into the matchers detection needs.
 * Done once per resolver: a sync resolves thousands of events.
 */
function compileNames(people: readonly DetectionPerson[], groups: readonly DetectionGroup[]) {
  // A term is one person's name or alias (-> that person) or a group's (-> its members). The first owner of a term wins.
  const idsOfTerm = new Map<string, readonly string[]>()
  for (const person of people) {
    for (const term of [person.name, ...person.aliases]) {
      if (term.trim() !== '' && !idsOfTerm.has(termKey(term))) idsOfTerm.set(termKey(term), [person.id])
    }
  }
  for (const group of groups) {
    for (const term of [group.name, ...group.aliases]) {
      if (term.trim() !== '' && !idsOfTerm.has(termKey(term))) idsOfTerm.set(termKey(term), group.people)
    }
  }
  if (idsOfTerm.size === 0) return null

  // Longest first, so "Grandma Jo" wins over "Grandma", and spaces in a term match any run of whitespace.
  const alternation = [...idsOfTerm.keys()]
    .sort((a, b) => b.length - a.length)
    .map(term => term.split(' ').map(escapeRegExp).join('\\s+'))
    .join('|')
  // A whole word: not inside another word before it, and not in front of letters or a possessive after it.
  // An optional leading "the" ("the boys") is not part of the term, so the term is captured.
  const name = `(?<![\\p{L}\\p{N}])(?:the\\s+)?(${alternation})(?![\\p{L}\\p{N}'’])`
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
  // "for" is a whole word, and needs a name list straight after it. "For: Theo" is the label form, not this one.
  const forClause = new RegExp(`(?<![\\p{L}\\p{N}])for\\s+(${list})${FOR_END}`, 'giu')

  const idsIn = (text: string): string[] =>
    [...text.matchAll(each)].flatMap(match => idsOfTerm.get(termKey(match[1]!)) ?? [])

  const forClausesIn = (text: string): ForClause[] =>
    [...text.matchAll(forClause)].map(match => ({
      personIds: idsIn(match[1]!),
      start: match.index,
      end: match.index + match[0].length,
    }))

  return {
    idsIn,

    /** The people of every "for <names>" clause in a text, in order. */
    forIdsIn: (text: string): string[] => forClausesIn(text).flatMap(clause => clause.personIds),

    /** The "for <names>" clause that runs to the end of a title (bar spaces and `.!?`), if there is one. */
    trailingForClauseOf: (text: string): ForClause | null =>
      forClausesIn(text).findLast(clause => TRAILING.test(text.slice(clause.end))) ?? null,

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

const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** `HH:MM` as minutes since midnight. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours! * 60 + minutes!
}

// The last start read, so the rules of one event read its clock once.
let lastClock: { at: number, timeZone: string, clock: { date: string, minutes: number } } | null = null

function clockOf(startAt: Date, timeZone: string): { date: string, minutes: number } {
  const at = startAt.getTime()
  if (lastClock?.at !== at || lastClock.timeZone !== timeZone) lastClock = { at, timeZone, clock: wallClockIn(startAt, timeZone) }
  return lastClock.clock
}

/** Whether any rule looks at when an event starts, and so needs the time zone. */
export function rulesUseTime(rules: readonly DetectionRule[]): boolean {
  return rules.some(rule => rule.from !== undefined || rule.to !== undefined || rule.days !== undefined)
}

/**
 * A rule made ready to test: its pattern (null when it has none, so any text
 * matches) and a test of the event's start, which is always true for a rule
 * with no time and no days.
 */
interface CompiledRule {
  pattern: RegExp | null
  startsInTime: (event: DetectableEvent) => boolean
}

function compileRule(rule: DetectionRule, timeZone: string | undefined): CompiledRule {
  const pattern = rule.match === undefined ? null : new RegExp(rule.match, 'i')
  const window = rule.from !== undefined && rule.to !== undefined ? { from: minutesOf(rule.from), to: minutesOf(rule.to) } : null
  const days = rule.days ? new Set(rule.days) : null
  if (!window && !days) return { pattern, startsInTime: () => true }
  if (timeZone === undefined) throw new Error('a rule with a time or days needs the time zone to read event times in')

  return {
    pattern,
    startsInTime(event) {
      if (!event.startAt) return false
      if (window && event.allDay) return false
      const { date, minutes } = clockOf(event.startAt, timeZone)
      if (days && !days.has(WEEKDAY_NAMES[dayOfWeek(date)]!)) return false
      if (!window) return true
      return window.from < window.to
        ? minutes >= window.from && minutes < window.to
        : minutes >= window.from || minutes < window.to
    },
  }
}

/** Whether a rule matches an event: its start fits the rule's time, and some text matches its pattern (if it has one). */
function ruleMatches(rule: CompiledRule, event: DetectableEvent, texts: readonly string[]): boolean {
  if (!rule.startsInTime(event)) return false
  return rule.pattern === null || texts.some(text => rule.pattern!.test(text))
}

/**
 * Builds the function that resolves an event's people for one calendar. Group
 * names expand to their members, wherever a person's name would be found and in
 * the rules' people. The regular expressions are compiled once, so build it
 * once per sync (or per re-resolve) and call it for every event.
 *
 * Rule patterns are compiled with the `i` flag only, as the config check does:
 * `u` would reject patterns the config accepts, such as `\-` or `\_`.
 *
 * `timeZone` is the wall's, for rules with a time or days. It is needed only
 * when a rule has one, and the resolver throws without it then.
 */
export function createPeopleResolver(
  calendar: DetectionCalendar,
  people: readonly DetectionPerson[],
  groups: readonly DetectionGroup[] = [],
  timeZone?: string,
): (event: DetectableEvent) => ResolvedPeople {
  const names = calendar.detect_people === false ? null : compileNames(people, groups)
  const anywhere = calendar.detect_people === 'anywhere'
  const inTitle = calendar.detect_in.includes('title')
  const inDescription = calendar.detect_in.includes('description')
  const membersOf = new Map(groups.map(group => [group.id, group.people]))
  // A rule may list group ids as well as person ids.
  const rules = calendar.rules.map(rule => ({
    ...compileRule(rule, timeZone),
    people: rule.people.flatMap(id => membersOf.get(id) ?? [id]),
  }))

  return (event) => {
    const lines = inDescription && event.description ? descriptionLines(event.description) : []
    const texts = inTitle ? [event.title, ...lines] : lines

    // Step 1: names, title first and then each description line. In each text the
    // prefix people come first, then those of "for" clauses.
    const titlePrefix = names && inTitle ? names.prefixOf(event.title) : null
    const titleFor = names && inTitle ? names.trailingForClauseOf(event.title) : null
    const named = names
      ? texts.flatMap(text => anywhere ? names.idsIn(text) : [...names.prefixOf(text)?.personIds ?? [], ...names.forIdsIn(text)])
      : []
    if (named.length > 0) {
      return { personIds: unique(named), displayTitle: displayTitleOf(event.title, calendar, titlePrefix, titleFor), matchedBy: 'name' }
    }

    // Step 2: keyword rules, for each text in turn, and then the rules that go by the time alone.
    const inTime = rules.filter(rule => rule.startsInTime(event))
    const ruled = [
      ...texts.flatMap(text => inTime.flatMap(rule => rule.pattern?.test(text) ? rule.people : [])),
      ...inTime.flatMap(rule => rule.pattern === null ? rule.people : []),
    ]
    if (ruled.length > 0) {
      return { personIds: unique(ruled), displayTitle: event.title, matchedBy: 'rule' }
    }

    // Step 3: the calendar's own person.
    return { personIds: [calendar.person], displayTitle: event.title, matchedBy: 'default' }
  }
}

/**
 * Builds the function that picks an event's icon for one calendar: the icon of
 * the first rule that has one and matches, else the calendar's own, else null.
 * A rule is tested against the same texts as for people (the title and each
 * description line, as `detect_in` says) and the same start time, but whoever
 * the event is for: a name in the title does not stop "swimming" getting its icon.
 * `timeZone` is needed when a rule with an icon has a time or days.
 */
export function createIconResolver(
  calendar: Pick<DetectionCalendar, 'detect_in' | 'rules'> & { icon?: string | undefined },
  timeZone?: string,
): (event: DetectableEvent) => string | null {
  const inTitle = calendar.detect_in.includes('title')
  const inDescription = calendar.detect_in.includes('description')
  const rules = calendar.rules.flatMap(rule => rule.icon ? [{ ...compileRule(rule, timeZone), icon: rule.icon }] : [])
  const fallback = calendar.icon ?? null
  if (rules.length === 0) return () => fallback

  return (event) => {
    const lines = inDescription && event.description ? descriptionLines(event.description) : []
    const texts = inTitle ? [event.title, ...lines] : lines
    return rules.find(rule => ruleMatches(rule, event, texts))?.icon ?? fallback
  }
}

/** `createPeopleResolver` for one event. Use the resolver when there are many. */
export function resolvePeople(
  event: DetectableEvent,
  calendar: DetectionCalendar,
  people: readonly DetectionPerson[],
  groups: readonly DetectionGroup[] = [],
  timeZone?: string,
): ResolvedPeople {
  return createPeopleResolver(calendar, people, groups, timeZone)(event)
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}

/**
 * The title with its name prefix and its trailing "for" clause removed, when the
 * calendar asks for that and what is left is worth showing.
 */
function displayTitleOf(title: string, calendar: DetectionCalendar, prefix: NamePrefix | null, forClause: ForClause | null): string {
  if (!calendar.strip_names) return title
  const start = prefix && !prefix.dangling ? prefix.end : 0
  const end = forClause ? Math.max(forClause.start, start) : title.length
  if (start === 0 && end === title.length) return title
  const kept = title.slice(start, end)
  const rest = (forClause ? kept.replace(TRAILING_SEPARATORS, '') : kept).trim()
  // A names-only title, or one that leaves nothing but punctuation, stays as it was.
  return /[\p{L}\p{N}]/u.test(rest) ? rest : title
}
