import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../../server/config/load'
import { expandIcs } from '../../../server/sources/ics/expand'
import { syncWindow } from '../../../server/sources/time'
import { createPeopleResolver, DETECTION_VERSION, htmlToText, resolvePeople } from '../../../shared/people'
import type { DetectableEvent, DetectionCalendar } from '../../../shared/people'

// The family from config.dev.yaml: Mum/Sarah/Mummy, Dad/Tom/Daddy, Isla, Theo,
// Poppy/Pops, and Household/Family/All (id "home"), with its keyword rules.

const APP_DIR = join(import.meta.dirname, '../../..')
const dev = loadConfig({ configFile: join(APP_DIR, 'config.dev.yaml'), env: {} })
const PEOPLE = dev.people
const FAMILY = dev.calendars.find(calendar => calendar.id === 'family')!

/** Names only: no rules and nothing stripped, so each test names what it is about. */
function calendar(overrides: Partial<DetectionCalendar> = {}): DetectionCalendar {
  return { person: 'home', detect_people: true, detect_in: ['title', 'description'], strip_names: false, rules: [], ...overrides }
}

/** The family's own keyword rules on top. */
const withRules = (overrides: Partial<DetectionCalendar> = {}) => calendar({ rules: FAMILY.rules, ...overrides })

function resolve(title: string, description: string | null = null, overrides: Partial<DetectionCalendar> = {}) {
  return resolvePeople({ title, description }, calendar(overrides), PEOPLE)
}

const idsOf = (title: string, description: string | null = null, overrides: Partial<DetectionCalendar> = {}) =>
  resolve(title, description, overrides).personIds

describe('htmlToText', () => {
  it.each([
    ['<br>', 'a\nb'],
    ['<br/>', 'a\nb'],
    ['<BR />', 'a\nb'],
    ['<br class="x">', 'a\nb'],
  ])('turns %s into a line break', (tag, expected) => {
    expect(htmlToText(`a${tag}b`)).toBe(expected)
  })

  it('turns paragraphs, divs and list items into line breaks and removes other tags', () => {
    expect(htmlToText('<p class="x">One</p><div>Two</div><ul><li>Three</li></ul><b>Four</b> <a href="https://x.example/?a=1">link</a><!-- note -->'))
      .toBe('\nOne\n\nTwo\n\nThree\nFour link')
  })

  it('normalises line endings', () => {
    expect(htmlToText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('leaves a bare < alone, because it is not a tag', () => {
    expect(htmlToText('a < b and I <3 it')).toBe('a < b and I <3 it')
    expect(htmlToText('x <y')).toBe('x <y')
  })

  it('decodes entities after removing tags, so an escaped tag stays text', () => {
    expect(htmlToText('&lt;b&gt;Room 4&lt;/b&gt;')).toBe('<b>Room 4</b>')
    expect(htmlToText('Fish &amp; chips &quot;to go&quot; &apos;n&#39; more&nbsp;please')).toBe('Fish & chips "to go" \'n\' more please')
    expect(htmlToText('&amp;lt;')).toBe('&lt;')
  })

  it('decodes numeric entities, and leaves invalid ones as they are', () => {
    expect(htmlToText('&#84;heo &#x54;heo &#x1F600;')).toBe('Theo Theo \u{1F600}')
    expect(htmlToText('&#0; &#xD800; &#1114112; &#99999999999;')).toBe('&#0; &#xD800; &#1114112; &#99999999999;')
  })
})

describe('name prefixes in the title and in a description line', () => {
  // [text, people, the title when its prefix is stripped]
  const forms: [string, string[], string][] = [
    ['Theo: Swimming', ['theo'], 'Swimming'],
    ['Theo - Swimming', ['theo'], 'Swimming'],
    ['Theo – Swimming', ['theo'], 'Swimming'],
    ['Theo — Swimming', ['theo'], 'Swimming'],
    ['Theo | Swimming', ['theo'], 'Swimming'],
    ['Theo-Swimming', ['theo'], 'Swimming'],
    ['[Theo] Swimming', ['theo'], 'Swimming'],
    ['(Theo) Swimming', ['theo'], 'Swimming'],
    ['Theo Swimming', ['theo'], 'Swimming'],
    ['Isla & Theo: Dentist', ['isla', 'theo'], 'Dentist'],
    ['Isla, Theo: Dentist', ['isla', 'theo'], 'Dentist'],
    ['Isla and Theo: Dentist', ['isla', 'theo'], 'Dentist'],
    ['Isla + Theo: Dentist', ['isla', 'theo'], 'Dentist'],
    ['Isla/Theo: Dentist', ['isla', 'theo'], 'Dentist'],
    ['Mum, Dad & Isla: Dentist', ['mum', 'dad', 'isla'], 'Dentist'],
    ['[Isla & Theo] Dentist', ['isla', 'theo'], 'Dentist'],
    ['(Isla, Theo) Dentist', ['isla', 'theo'], 'Dentist'],
    ['Who: Theo, Isla', ['theo', 'isla'], 'Who: Theo, Isla'],
    ['For: Mum', ['mum'], 'For: Mum'],
    ['Who: Theo - Swimming', ['theo'], 'Swimming'],
    ['Isla & Theo', ['isla', 'theo'], 'Isla & Theo'],
    ['Theo', ['theo'], 'Theo'],
    ['  Theo:   Swimming', ['theo'], 'Swimming'],
  ]

  it.each(forms)('finds the people in a title: %s', (title, people) => {
    const resolved = resolve(title)

    expect(resolved.personIds).toEqual(people)
    expect(resolved.matchedBy).toBe('name')
  })

  it.each(forms)('finds the people in a description line: %s', (line, people) => {
    expect(idsOf('Appointment', line)).toEqual(people)
    expect(idsOf('Appointment', `Bring a coat\n${line}\nSee you there`)).toEqual(people)
  })

  it.each(forms)('strips the prefix from the title shown: %s', (title, _people, shown) => {
    expect(resolve(title, null, { strip_names: true }).displayTitle).toBe(shown)
  })

  it('keeps the title as the source had it when strip_names is off', () => {
    expect(resolve('Theo: Swimming').displayTitle).toBe('Theo: Swimming')
  })
})

describe('people split across the title and the description', () => {
  it('merges them, title first', () => {
    expect(idsOf('Isla: Class assembly', 'Who: Mum, Dad')).toEqual(['isla', 'mum', 'dad'])
  })

  it('drops a person named twice and keeps the first place', () => {
    expect(idsOf('Theo: Swimming', 'Who: Isla, Theo')).toEqual(['theo', 'isla'])
    expect(idsOf('Swimming', 'Who: Isla\nTheo\nIsla & Mum')).toEqual(['isla', 'theo', 'mum'])
  })
})

describe('descriptions', () => {
  it.each([
    ['HTML with line breaks', 'Who: Mum<br>Bring the reading folder<br><b>Room 4</b> &amp; the hall'],
    ['HTML paragraphs', '<p>Who: Mum</p><p>Bring the reading folder</p>'],
    ['HTML divs', '<div>Who: Mum</div><div>Bring the reading folder</div>'],
    ['a line break after the names', '<p>Bring the reading folder</p><br><p>Mum</p>'],
    ['a name written with an entity', 'Who: &#77;um<br>Bring the reading folder'],
    ['a non-breaking space after the label', 'Who:&nbsp;Mum<br>Bring the reading folder'],
    ['plain text with \\n', 'Bring the reading folder\nWho: Mum'],
    ['plain text with \\r\\n', 'Bring the reading folder\r\nWho: Mum\r\n'],
    ['blank lines and spaces around', '\n\n   Who: Mum   \n\nBring the reading folder'],
  ])('finds the name in %s', (_name, description) => {
    expect(idsOf('Parents\' evening', description)).toEqual(['mum'])
  })

  it('does not read a name out of a tag or an escaped tag', () => {
    expect(idsOf('Party', '<a href="https://x.example/Theo">link</a>', { detect_people: 'anywhere' })).toEqual(['home'])
    expect(idsOf('Party', '&lt;Theo&gt; is not a tag', { detect_people: 'anywhere' })).toEqual(['theo'])
  })

  it('matches a name only at the start of a line by default, and anywhere when asked', () => {
    const sentence = 'Remember to pick up Theo from school'

    expect(idsOf('Pick-up', sentence)).toEqual(['home'])
    expect(resolve('Pick-up', sentence).matchedBy).toBe('default')
    expect(idsOf('Pick-up', sentence, { detect_people: 'anywhere' })).toEqual(['theo'])
  })

  it('finds every name in anywhere mode, in order of appearance, title first', () => {
    expect(idsOf('Lunch with Dad', 'Isla and Mum are coming\nTheo might be late', { detect_people: 'anywhere' })).toEqual(['dad', 'isla', 'mum', 'theo'])
  })
})

describe('names', () => {
  it.each([
    ['Sarah: Dentist', ['mum']],
    ['Mummy: Dentist', ['mum']],
    ['Pops: Rhyme time', ['poppy']],
    ['Family: Half term', ['home']],
    ['Household: Half term', ['home']],
    ['Sarah & Tom: Dinner out', ['mum', 'dad']],
  ])('knows aliases: %s', (title, people) => {
    expect(idsOf(title)).toEqual(people)
  })

  it.each([
    'THEO: swimming',
    'theo: swimming',
    'tHeO - swimming',
  ])('ignores case: %s', (title) => {
    expect(idsOf(title)).toEqual(['theo'])
  })

  it('ignores case in the label and the description', () => {
    expect(idsOf('Swimming', 'who: theo')).toEqual(['theo'])
    expect(idsOf('Swimming', 'WHO: THEO, ISLA')).toEqual(['theo', 'isla'])
    expect(idsOf('Swimming', 'for : Mum')).toEqual(['mum'])
  })

  it('takes the list after a Who: label and ignores what follows it', () => {
    expect(idsOf('Swimming', 'Who: Theo, Isla and a friend from school')).toEqual(['theo', 'isla'])
    expect(idsOf('Swimming', 'Who: Theo.')).toEqual(['theo'])
    expect(idsOf('Swimming', 'Who: everyone')).toEqual(['home'])
  })

  it.each([
    ['Theodore\'s party'],
    ['Theodore: party'],
    ['Collect Mum\'s present'],
    ['Mum’s present'],
    ['Isla’s birthday'],
    ['Isla\'s birthday'],
    ['Allotment'],
    ['Alloy wheels'],
    ['Dadaism talk'],
    ['Smum'],
    ['Mums\' meeting'],
    ['Theo’s'],
  ])('does not find a name inside another word: %s', (title) => {
    expect(idsOf(title)).toEqual(['home'])
    expect(idsOf('Appointment', title)).toEqual(['home'])
    expect(idsOf(title, null, { detect_people: 'anywhere' })).toEqual(['home'])
  })

  it('does not take a name from the middle of a title by default', () => {
    expect(idsOf('Dentist for Theo')).toEqual(['home'])
    expect(idsOf('Dentist for Theo', null, { detect_people: 'anywhere' })).toEqual(['theo'])
  })

  it('needs a delimiter, a space or the end of the line after the names', () => {
    expect(idsOf('Theo.')).toEqual(['home'])
    expect(idsOf('Theo!')).toEqual(['home'])
    expect(idsOf('Theo?')).toEqual(['home'])
  })

  it('needs the closing bracket of a bracketed list', () => {
    expect(idsOf('[Theo Swimming')).toEqual(['home'])
    expect(idsOf('Theo] Swimming')).toEqual(['home'])
    expect(idsOf('[Theo) Swimming')).toEqual(['home'])
  })

  it('takes a separator as part of the list only when another name follows it', () => {
    expect(idsOf('Theo and friends swimming')).toEqual(['theo'])
    expect(idsOf('Theo & friends: swimming')).toEqual(['theo'])
    expect(idsOf('Theo, then swimming')).toEqual(['theo'])
    expect(idsOf('Isla and Theo and friends')).toEqual(['isla', 'theo'])
  })

  it('matches the longest name first, including names of several words', () => {
    const people = [
      { id: 'jo', name: 'Grandma Jo', aliases: ['G. Jo'] },
      { id: 'gran', name: 'Grandma', aliases: [] },
      { id: 'cplus', name: 'C++', aliases: [] },
    ]
    const resolve = createPeopleResolver(calendar(), people)

    expect(resolve({ title: 'Grandma Jo: Tea', description: null }).personIds).toEqual(['jo'])
    expect(resolve({ title: 'Grandma  Jo Tea', description: null }).personIds).toEqual(['jo'])
    expect(resolve({ title: 'Grandma: Tea', description: null }).personIds).toEqual(['gran'])
    expect(resolve({ title: 'G. Jo & Grandma: Tea', description: null }).personIds).toEqual(['jo', 'gran'])
    expect(resolve({ title: 'C++ Club', description: null }).personIds).toEqual(['cplus'])
    expect(resolve({ title: 'Grandmas: Tea', description: null }).personIds).toEqual(['home'])
  })

  it('knows names with accents and in other scripts as whole words', () => {
    const people = [{ id: 'zoe', name: 'Zoë', aliases: [] }, { id: 'li', name: '李', aliases: [] }]
    const resolve = createPeopleResolver(calendar(), people)

    expect(resolve({ title: 'ZOË: Piano', description: null }).personIds).toEqual(['zoe'])
    expect(resolve({ title: 'Zoëlle: Piano', description: null }).personIds).toEqual(['home'])
    expect(resolve({ title: '李 钢琴', description: null }).personIds).toEqual(['li'])
  })
})

describe('keyword rules', () => {
  it('beats nothing, but names beat it', () => {
    expect(idsOf('Swimming', 'Who: Isla', { rules: FAMILY.rules })).toEqual(['isla'])
    expect(idsOf('Swimming', null, { rules: FAMILY.rules })).toEqual(['theo'])
    expect(resolve('Swimming', 'Who: Isla', { rules: FAMILY.rules }).matchedBy).toBe('name')
  })

  it('is tested against the title', () => {
    const resolved = resolve('Ballet', null, { rules: FAMILY.rules })

    expect(resolved).toEqual({ personIds: ['isla'], displayTitle: 'Ballet', matchedBy: 'rule' })
  })

  it('is tested against each description line', () => {
    expect(idsOf('Lesson', 'Bring a towel\nAt the pool for swimming', { rules: FAMILY.rules })).toEqual(['theo'])
    expect(idsOf('Lesson', '<p>Rhyme time</p><p>at the library</p>', { rules: FAMILY.rules })).toEqual(['poppy'])
  })

  it('adds the people of every rule that matches, in the order they are found', () => {
    expect(idsOf('Swimming and ballet', null, { rules: FAMILY.rules })).toEqual(['isla', 'theo'])
    expect(idsOf('Ballet', 'Then swimming\nNursery', { rules: FAMILY.rules })).toEqual(['isla', 'theo', 'poppy'])
    expect(idsOf('Swimming', null, { rules: [{ match: 'swim', people: ['mum', 'theo'] }, { match: 'ming', people: ['theo', 'dad'] }] }))
      .toEqual(['mum', 'theo', 'dad'])
  })

  it('ignores case, and takes a regular expression', () => {
    expect(idsOf('BALLET', null, { rules: FAMILY.rules })).toEqual(['isla'])
    expect(idsOf('5-a-side', null, { rules: [{ match: '\\d-a-side', people: ['dad'] }] })).toEqual(['dad'])
    expect(idsOf('Dad’s 5-a-side', null, { rules: [{ match: '5\\-a\\-side', people: ['dad'] }] })).toEqual(['dad'])
  })

  it('still applies when names are switched off, and then names are ignored', () => {
    expect(idsOf('Theo: Ballet', null, { rules: FAMILY.rules, detect_people: false })).toEqual(['isla'])
    expect(idsOf('Theo: Swimming', 'Who: Mum', { detect_people: false })).toEqual(['home'])
    expect(idsOf('Theo: Swimming', null, { detect_people: false })).toEqual(['home'])
  })

  it('does not strip the title when names are switched off', () => {
    expect(resolve('Theo: Ballet', null, { rules: FAMILY.rules, detect_people: false, strip_names: true }).displayTitle).toBe('Theo: Ballet')
  })

  it('does not change the title when a rule decides', () => {
    expect(resolve('Ballet', null, { rules: FAMILY.rules, strip_names: true }).displayTitle).toBe('Ballet')
  })
})

describe('detect_in', () => {
  it('ignores the description when only the title is checked', () => {
    const only = { detect_in: ['title'] as const, rules: [{ match: 'towel', people: ['dad'] }] }

    expect(idsOf('Swimming', 'Who: Theo\nBring a towel', only)).toEqual(['home'])
    expect(idsOf('Theo: Swimming', 'Who: Isla', only)).toEqual(['theo'])
  })

  it('ignores the title when only the description is checked', () => {
    const only = { detect_in: ['description'] as const, rules: [{ match: 'swimming', people: ['dad'] }], strip_names: true }

    expect(idsOf('Theo: Swimming', null, only)).toEqual(['home'])
    expect(idsOf('Theo: Swimming', 'Who: Isla', only)).toEqual(['isla'])
    expect(resolve('Theo: Swimming', 'Who: Isla', only).displayTitle).toBe('Theo: Swimming')
  })
})

describe('the default person', () => {
  it('is the calendar\'s when nothing matches', () => {
    expect(resolve('Parents\' evening', 'Bring the reading folder', { person: 'dad' })).toEqual({
      personIds: ['dad'],
      displayTitle: 'Parents\' evening',
      matchedBy: 'default',
    })
  })

  it('is used for an event with no description', () => {
    expect(idsOf('Bin day', null, { person: 'home' })).toEqual(['home'])
    expect(idsOf('Bin day', '', { person: 'home' })).toEqual(['home'])
  })
})

describe('strip_names', () => {
  const strip = { strip_names: true }

  it('shows the title without the prefix, and the people carry the meaning', () => {
    expect(resolve('Theo: Swimming', null, strip)).toEqual({ personIds: ['theo'], displayTitle: 'Swimming', matchedBy: 'name' })
    expect(resolve('[Isla & Theo] Dentist', 'Who: Isla, Theo', strip)).toEqual({ personIds: ['isla', 'theo'], displayTitle: 'Dentist', matchedBy: 'name' })
  })

  it('keeps a title that is only names, or leaves only punctuation', () => {
    expect(resolve('Isla & Theo', null, strip).displayTitle).toBe('Isla & Theo')
    expect(resolve('Theo: ', null, strip).displayTitle).toBe('Theo: ')
    expect(resolve('Theo: !!', null, strip).displayTitle).toBe('Theo: !!')
    expect(resolve('(Theo) -', null, strip).displayTitle).toBe('(Theo) -')
  })

  it('keeps a title whose name list carries on past the names', () => {
    const resolved = resolve('Theo and friends swimming', null, strip)

    expect(resolved.personIds).toEqual(['theo'])
    expect(resolved.displayTitle).toBe('Theo and friends swimming')
    expect(resolve('Theo & friends: swimming', null, strip).displayTitle).toBe('Theo & friends: swimming')
  })

  it('does not strip a name found only in the description, or only mid-title', () => {
    expect(resolve('Swimming', 'Who: Theo', strip).displayTitle).toBe('Swimming')
    expect(resolve('Dentist for Theo', null, { ...strip, detect_people: 'anywhere' })).toMatchObject({ personIds: ['theo'], displayTitle: 'Dentist for Theo' })
  })

  it('in anywhere mode strips a prefix at the start of the title and nothing else', () => {
    const anywhere = { ...strip, detect_people: 'anywhere' as const }

    expect(resolve('Theo: Swimming with Isla', null, anywhere)).toEqual({ personIds: ['theo', 'isla'], displayTitle: 'Swimming with Isla', matchedBy: 'name' })
  })

  it('does not strip when the title is not checked', () => {
    expect(resolve('Theo: Swimming', 'Who: Theo', { ...strip, detect_in: ['description'] }).displayTitle).toBe('Theo: Swimming')
  })

  it('removes only the prefix, not a later mention', () => {
    expect(resolve('Theo: Swimming with Theo', null, strip).displayTitle).toBe('Swimming with Theo')
  })
})

describe('createPeopleResolver and resolvePeople', () => {
  it('give the same answer, and the resolver can be called many times', () => {
    const event: DetectableEvent = { title: 'Theo: Swimming', description: 'Who: Isla' }
    const resolver = createPeopleResolver(withRules({ strip_names: true }), PEOPLE)

    const first = resolver(event)
    expect(resolver({ title: 'Ballet', description: null }).personIds).toEqual(['isla'])
    expect(resolver(event)).toEqual(first)
    expect(resolvePeople(event, withRules({ strip_names: true }), PEOPLE)).toEqual(first)
    expect(first).toEqual({ personIds: ['theo', 'isla'], displayTitle: 'Swimming', matchedBy: 'name' })
  })

  it('returns a fresh list each time', () => {
    const resolver = createPeopleResolver(calendar(), PEOPLE)

    resolver({ title: 'Bin day', description: null }).personIds.push('mum')

    expect(resolver({ title: 'Bin day', description: null }).personIds).toEqual(['home'])
  })

  it('has a detection version to bump', () => {
    expect(DETECTION_VERSION).toBeGreaterThanOrEqual(1)
  })
})

describe('the family fixture with the dev config', () => {
  const resolver = createPeopleResolver(FAMILY, PEOPLE)
  const window = syncWindow(new Date('2026-10-28T12:00:00Z'), 'Europe/London', 12, 12)
  const { events } = expandIcs(readFileSync(join(APP_DIR, 'test/fixtures/ics/family.ics'), 'utf8'), window, { timeZone: 'Europe/London' })
  const resolved = (title: string) => {
    const event = events.find(candidate => candidate.title === title)
    expect(event, `an event titled "${title}"`).toBeDefined()
    return resolver(event!)
  }

  it.each([
    ['Theo: Swimming', ['theo'], 'Swimming'],
    ['Ballet', ['isla'], 'Ballet'],
    ['Football', ['theo'], 'Football'],
    ['Brownies', ['isla'], 'Brownies'],
    ['Playgroup', ['poppy'], 'Playgroup'],
    ['Poppy: Nursery', ['poppy'], 'Nursery'],
    ['Dad: Cycling club', ['dad'], 'Cycling club'],
    ['Mum: Pilates', ['mum'], 'Pilates'],
    ['Book club', ['mum'], 'Book club'],
    ['Half term', ['home'], 'Half term'],
    ['[Isla & Theo] Dentist', ['isla', 'theo'], 'Dentist'],
    ['Parents\' evening', ['mum'], 'Parents\' evening'],
    ['Isla: Class assembly', ['isla', 'mum', 'dad'], 'Class assembly'],
    ['Sunday lunch at Grandma\'s', ['home'], 'Sunday lunch at Grandma\'s'],
    ['Isla\'s birthday', ['isla'], 'Isla\'s birthday'],
    ['Trick or treating', ['theo', 'poppy'], 'Trick or treating'],
    ['Isla: Halloween party at Maya\'s', ['isla'], 'Halloween party at Maya\'s'],
    ['Mum: Hair appointment', ['mum'], 'Hair appointment'],
    ['Pumpkin carving', ['home'], 'Pumpkin carving'],
    ['Rent due', ['home'], 'Rent due'],
  ])('%s', (title, people, shown) => {
    expect(resolved(title)).toMatchObject({ personIds: people, displayTitle: shown })
  })
})
