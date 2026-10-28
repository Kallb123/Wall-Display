import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../../server/config/load'
import { load, loadError, minimalConfig, tempDir } from './helpers'

type Raw = ReturnType<typeof minimalConfig>

/** Loads a config changed by `change` and returns the error message. */
async function messageFor(change: (config: Raw) => void): Promise<string> {
  const config = minimalConfig()
  change(config)
  return (await loadError({ config })).message
}

describe('validation errors name the field', () => {
  it('bad colour', async () => {
    const message = await messageFor((c) => { c.people[0].colour = 'orange' })

    expect(message).toContain('people[0].colour')
    expect(message).toContain('#C67139')
  })

  it('duplicate person id', async () => {
    const message = await messageFor((c) => { c.people[1].id = 'mum' })

    expect(message).toContain('people[1].id: duplicate id "mum"')
  })

  it('a name or alias shared by two people, ignoring case', async () => {
    const message = await messageFor((c) => { c.people[1].aliases = ['MUM'] })

    expect(message).toContain('people[1].aliases[0]')
    expect(message).toContain('already a name or alias of person "mum"')
  })

  it('an alias that repeats another person\'s name', async () => {
    const message = await messageFor((c) => { c.people[0].aliases = ['theo'] })

    expect(message).toContain('people[1].name')
  })

  it('calendar person not found', async () => {
    const message = await messageFor((c) => { c.calendars[0].person = 'nobody' })

    expect(message).toContain('calendars[0].person: unknown person "nobody"')
  })

  it('rule person not found', async () => {
    const message = await messageFor((c) => { c.calendars[0].rules = [{ match: 'a', people: ['theo'] }, { match: 'b', people: ['theo', 'ghost'] }] })

    expect(message).toContain('calendars[0].rules[1].people[1]: unknown person "ghost"')
  })

  it('invalid rule regex', async () => {
    const message = await messageFor((c) => { c.calendars[0].rules = [{ match: 'fine', people: ['theo'] }, { match: 'swim(', people: ['theo'] }] })

    expect(message).toContain('calendars[0].rules[1].match: invalid regular expression')
    expect(message).not.toContain('rules[0]')
  })

  it('unknown key, as a typo', async () => {
    const message = await messageFor((c) => { c.people[0].colur = '#C67139' })

    expect(message).toContain('people[0].colur: unknown setting')
  })

  it('unknown top-level key', async () => {
    const message = await messageFor((c) => { c.display = [] })

    expect(message).toContain('display: unknown setting')
  })

  it('homeassistant source without a homeassistant block', async () => {
    const message = await messageFor((c) => {
      c.calendars.push({ id: 'bins', person: 'mum', source: { type: 'homeassistant', entity_id: 'calendar.bins' } })
    })

    expect(message).toContain('calendars[1].source')
    expect(message).toContain('"homeassistant" block')
  })

  it('accepts a homeassistant source with the block', async () => {
    const config = minimalConfig()
    config.calendars.push({ id: 'bins', person: 'mum', source: { type: 'homeassistant', entity_id: 'calendar.bins' } })
    config.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
    const { config: loaded } = await load({ config })

    expect(loaded.calendars[1]!.source).toMatchObject({ poll_seconds: 300 })
  })

  it('bad homeassistant entity id', async () => {
    const message = await messageFor((c) => {
      c.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
      c.calendars.push({ id: 'bins', person: 'mum', source: { type: 'homeassistant', entity_id: 'sensor.bins' } })
    })

    expect(message).toContain('calendars[1].source.entity_id')
  })

  it('bad timezone', async () => {
    const message = await messageFor((c) => { c.timezone = 'Mars/Olympus' })

    expect(message).toContain('timezone: must be an IANA time zone')
  })

  it('no displays', async () => {
    const message = await messageFor((c) => { c.displays = [] })

    expect(message).toContain('displays: at least one display is required')
  })

  it('missing displays', async () => {
    const message = await messageFor((c) => { delete c.displays })

    expect(message).toContain('displays: is required')
  })

  it('invalid PIN', async () => {
    const message = await messageFor((c) => { c.remote = { pin: '12' } })

    expect(message).toContain('remote.pin: must be 4 to 12 digits')
  })

  it('a PIN written as a YAML number', async () => {
    const message = await messageFor((c) => { c.remote = { pin: 1234 } })

    expect(message).toContain('remote.pin')
  })

  it('bad source type', async () => {
    const message = await messageFor((c) => { c.calendars[0].source = { type: 'caldav', url: 'https://x' } })

    expect(message).toContain('calendars[0].source.type')
  })

  it.each([
    ['poll_seconds below the minimum', (c: Raw) => { c.calendars[0].source.poll_seconds = 10 }, 'calendars[0].source.poll_seconds'],
    ['an ics URL that is not http(s) or file', (c: Raw) => { c.calendars[0].source.url = 'ftp://example.com/a.ics' }, 'calendars[0].source.url'],
    ['detect_people of the wrong kind', (c: Raw) => { c.calendars[0].detect_people = 'sometimes' }, 'calendars[0].detect_people'],
    ['an empty detect_in', (c: Raw) => { c.calendars[0].detect_in = [] }, 'calendars[0].detect_in'],
    ['a person id that is not a slug', (c: Raw) => { c.people[0].id = 'Mum Two' }, 'people[0].id'],
    ['a two-character initial', (c: Raw) => { c.people[0].initial = 'MM' }, 'people[0].initial'],
    ['month_return_minutes too big', (c: Raw) => { c.displays[0].month_return_minutes = 5000 }, 'displays[0].month_return_minutes'],
    ['an unknown theme', (c: Raw) => { c.displays[0].theme = 'sepia' }, 'displays[0].theme'],
    ['an unknown button action', (c: Raw) => { c.button = { single: 'explode' } }, 'button.single'],
    ['quiet hours that are not times', (c: Raw) => { c.policies = { auto_presence: { quiet_hours: { from: '9pm', to: '06:00' } } } }, 'policies.auto_presence.quiet_hours.from'],
    ['a negative night_below_lux', (c: Raw) => { c.policies = { auto_brightness: { night_below_lux: -1 } } }, 'policies.auto_brightness.night_below_lux'],
    ['photos interval below 5', (c: Raw) => { c.photos = { interval_seconds: 1 } }, 'photos.interval_seconds'],
    ['an immich URL that is not http(s)', (c: Raw) => { c.photos = { immich: { url: 'immich', api_key: 'k' } } }, 'photos.immich.url'],
  ])('%s', async (_name, change, path) => {
    expect(await messageFor(change)).toContain(path)
  })
})

describe('error reporting', () => {
  it('reports every problem at once, one per line', async () => {
    const error = await loadError({
      config: (() => {
        const c = minimalConfig()
        c.people[0].colour = 'red'
        c.people[1].id = 'mum'
        c.calendars[0].person = 'nobody'
        c.timezone = 'Nowhere/Land'
        c.displays = []
        return c
      })(),
    })

    expect(error).toBeInstanceOf(ConfigError)
    expect(error.problems).toHaveLength(5)
    const lines = error.message.split('\n')
    expect(lines).toHaveLength(6) // a header, then one line per problem
    for (const path of ['people[0].colour', 'people[1].id', 'calendars[0].person', 'timezone', 'displays']) {
      expect(error.problems.some(problem => problem.startsWith(`${path}:`))).toBe(true)
    }
  })

  it('names the config file in the message', async () => {
    const { message } = await loadError({ config: { people: [] } })

    expect(message).toMatch(/config\.yaml/)
  })

  it('reports YAML syntax errors with a line number', async () => {
    const error = await loadError({ config: 'people: [unclosed\ndisplays:\n  - id: a\n' })

    expect(error.message).toMatch(/config\.yaml:\d+:\d+/)
  })

  it('rejects a file that is not a mapping', async () => {
    const error = await loadError({ config: '- just\n- a list\n' })

    expect(error.message).toContain('config:')
  })

  it('rejects an empty file', async () => {
    const error = await loadError({ config: '' })

    expect(error.problems).toHaveLength(1)
  })

  it('names the missing config file and the env vars that set it', async () => {
    const configFile = join(await tempDir(), 'nope.yaml')
    let message = ''
    try {
      loadConfig({ configFile, env: {} })
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain(configFile)
    expect(message).toContain('WALLCAL_CONFIG_FILE')
    expect(message).toContain('WALLCAL_CONFIG_DIR')
  })
})
