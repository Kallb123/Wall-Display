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

  it('duplicate group id', async () => {
    const message = await messageFor((c) => {
      c.groups = [{ id: 'kids', name: 'Kids', people: ['theo'] }, { id: 'kids', name: 'Children', people: ['theo'] }]
    })

    expect(message).toContain('groups[1].id: duplicate id "kids"')
  })

  it('a group id that is a person id', async () => {
    const message = await messageFor((c) => { c.groups = [{ id: 'theo', name: 'Boys', people: ['theo'] }] })

    expect(message).toContain('groups[0].id: "theo" is already the id of a person')
  })

  it('a group member that is not a person', async () => {
    const message = await messageFor((c) => { c.groups = [{ id: 'kids', name: 'Kids', people: ['theo', 'ghost'] }] })

    expect(message).toContain('groups[0].people[1]: unknown person "ghost"')
  })

  it('a group with no people', async () => {
    const message = await messageFor((c) => { c.groups = [{ id: 'kids', name: 'Kids', people: [] }] })

    expect(message).toContain('groups[0].people: must list at least one person id')
  })

  it('a group name or alias that is a person\'s name or alias, ignoring case', async () => {
    const byName = await messageFor((c) => { c.groups = [{ id: 'kids', name: 'THEO', people: ['theo'] }] })
    const byAlias = await messageFor((c) => {
      c.people[0].aliases = ['Mummy']
      c.groups = [{ id: 'kids', name: 'Kids', aliases: ['mummy'], people: ['theo'] }]
    })

    expect(byName).toContain('groups[0].name: "THEO" is already a name or alias of person "theo"')
    expect(byAlias).toContain('groups[0].aliases[0]: "mummy" is already a name or alias of person "mum"')
  })

  it('an alias shared by two groups', async () => {
    const message = await messageFor((c) => {
      c.groups = [{ id: 'kids', name: 'Kids', aliases: ['Little ones'], people: ['theo'] }, { id: 'tots', name: 'Tots', aliases: ['little ONES'], people: ['theo'] }]
    })

    expect(message).toContain('groups[1].aliases[0]')
    expect(message).toContain('already a name or alias of group "kids"')
  })

  it('a rule may list a group id', async () => {
    const raw = minimalConfig()
    raw.groups = [{ id: 'kids', name: 'Kids', people: ['theo'] }]
    raw.calendars[0].rules = [{ match: 'party', people: ['kids', 'mum'] }]
    const { config } = await load({ config: raw })

    expect(config.calendars[0]!.rules[0]!.people).toEqual(['kids', 'mum'])
  })

  it('a rule with an id that is neither a person nor a group', async () => {
    const message = await messageFor((c) => {
      c.groups = [{ id: 'kids', name: 'Kids', people: ['theo'] }]
      c.calendars[0].rules = [{ match: 'party', people: ['kids', 'ghost'] }]
    })

    expect(message).toContain('calendars[0].rules[0].people[1]: unknown person "ghost" (must be the id of an entry in people or groups)')
  })

  it('a calendar\'s default person cannot be a group', async () => {
    const message = await messageFor((c) => {
      c.groups = [{ id: 'kids', name: 'Kids', people: ['theo'] }]
      c.calendars[0].person = 'kids'
    })

    expect(message).toContain('calendars[0].person: unknown person "kids"')
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

  it.each(['🍽️', '🏊', '👨‍👩‍👧', '🇬🇧'])('accepts the calendar icon %s', async (icon) => {
    const config = minimalConfig()
    config.calendars[0].icon = icon
    const { config: loaded } = await load({ config })

    expect(loaded.calendars[0]!.icon).toBe(icon)
  })

  it('leaves the calendar icon undefined when there is none', async () => {
    const { config: loaded } = await load({ config: minimalConfig() })

    expect(loaded.calendars[0]!.icon).toBeUndefined()
  })

  it.each(['a', 'ab', '🍽️🍽️', '', '1', '#'])('rejects the calendar icon "%s"', async (icon) => {
    const message = await messageFor((c) => { c.calendars[0].icon = icon })

    expect(message).toContain('calendars[0].icon: must be a single emoji')
  })

  it('accepts a rule with an icon, with or without people', async () => {
    const raw = minimalConfig()
    raw.calendars[0].rules = [{ match: 'swimming', icon: '🏊' }, { match: 'ballet', people: ['mum'], icon: '🩰' }]
    const { config } = await load({ config: raw })

    expect(config.calendars[0]!.rules).toEqual([
      { match: 'swimming', people: [], icon: '🏊' },
      { match: 'ballet', people: ['mum'], icon: '🩰' },
    ])
  })

  it('rejects a rule with neither people nor an icon', async () => {
    const message = await messageFor((c) => { c.calendars[0].rules = [{ match: 'swimming' }] })

    expect(message).toContain('calendars[0].rules[0]: must set people, an icon, or both')
  })

  it('rejects a rule icon that is not a single emoji', async () => {
    const message = await messageFor((c) => { c.calendars[0].rules = [{ match: 'swimming', icon: 'swim' }] })

    expect(message).toContain('calendars[0].rules[0].icon: must be a single emoji')
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

  it('weather without a homeassistant block', async () => {
    const message = await messageFor((c) => { c.weather = { entity_id: 'weather.home' } })

    expect(message).toContain('weather: reads a Home Assistant weather entity')
    expect(message).toContain('"homeassistant" block')
  })

  it('accepts weather with the homeassistant block', async () => {
    const config = minimalConfig()
    config.weather = { entity_id: 'weather.home' }
    config.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
    const { config: loaded } = await load({ config })

    expect(loaded.weather).toEqual({ entity_id: 'weather.home', poll_seconds: 600 })
  })

  it.each(['sensor.home', 'weather.', 'weather', 'weather.home assistant', 'calendar.bins'])('bad weather entity id %j', async (entityId) => {
    const message = await messageFor((c) => {
      c.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
      c.weather = { entity_id: entityId }
    })

    expect(message).toContain('weather.entity_id: must be a weather entity id like "weather.home"')
  })

  it('weather polled more often than every minute', async () => {
    const message = await messageFor((c) => {
      c.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
      c.weather = { entity_id: 'weather.home', poll_seconds: 30 }
    })

    expect(message).toContain('weather.poll_seconds')
  })

  it('weather with an unknown key', async () => {
    const message = await messageFor((c) => {
      c.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
      c.weather = { entity_id: 'weather.home', units: 'metric' }
    })

    expect(message).toContain('weather.units: unknown setting')
  })

  it('alarm without a homeassistant block', async () => {
    const message = await messageFor((c) => { c.alarm = { entity_id: 'sensor.phone_next_alarm' } })

    expect(message).toContain('alarm: reads a Home Assistant alarm entity')
    expect(message).toContain('"homeassistant" block')
  })

  it.each(['sensor.phone_next_alarm', 'input_datetime.alarm'])('accepts alarm entity id %j with the homeassistant block', async (entityId) => {
    const config = minimalConfig()
    config.alarm = { entity_id: entityId }
    config.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
    const { config: loaded } = await load({ config })

    expect(loaded.alarm).toEqual({ entity_id: entityId, poll_seconds: 300 })
  })

  it.each(['weather.home', 'sensor.', 'sensor', 'sensor.next alarm', 'input_datetime.', 'binary_sensor.alarm'])('bad alarm entity id %j', async (entityId) => {
    const message = await messageFor((c) => {
      c.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
      c.alarm = { entity_id: entityId }
    })

    expect(message).toContain('alarm.entity_id: must be a sensor or input_datetime entity id')
  })

  it('alarm polled more often than every 30 seconds', async () => {
    const message = await messageFor((c) => {
      c.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
      c.alarm = { entity_id: 'sensor.phone_next_alarm', poll_seconds: 29 }
    })

    expect(message).toContain('alarm.poll_seconds')
  })

  it('alarm with an unknown key', async () => {
    const message = await messageFor((c) => {
      c.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
      c.alarm = { entity_id: 'sensor.phone_next_alarm', units: 'metric' }
    })

    expect(message).toContain('alarm.units: unknown setting')
  })

  it('week_hours with from not before to', async () => {
    const message = await messageFor((c) => { c.displays[0].week_hours = { from: 12, to: 12 } })

    expect(message).toContain('displays[0].week_hours')
    expect(message).toContain('week_hours.from must be before week_hours.to')
  })

  it('week_hours out of range', async () => {
    expect(await messageFor((c) => { c.displays[0].week_hours = { from: -1, to: 21 } })).toContain('displays[0].week_hours.from: must be from 0 to 23')
    expect(await messageFor((c) => { c.displays[0].week_hours = { from: 7, to: 25 } })).toContain('displays[0].week_hours.to: must be from 1 to 24')
    expect(await messageFor((c) => { c.displays[0].week_hours = { from: 7, to: 0 } })).toContain('displays[0].week_hours.to: must be from 1 to 24')
  })

  it('week_hours that are not whole hours', async () => {
    const message = await messageFor((c) => { c.displays[0].week_hours = { from: 7.5, to: 21 } })

    expect(message).toContain('displays[0].week_hours.from: must be a whole number')
  })

  it('week_hours with an unknown key', async () => {
    const message = await messageFor((c) => { c.displays[0].week_hours = { from: 7, to: 21, start: 8 } })

    expect(message).toContain('displays[0].week_hours.start: unknown setting')
  })

  it('day_parts with afternoon not before evening', async () => {
    const message = await messageFor((c) => { c.displays[0].day_parts = { afternoon: 17, evening: 17 } })

    expect(message).toContain('displays[0].day_parts')
    expect(message).toContain('day_parts.afternoon must be before day_parts.evening')
  })

  it('day_parts out of range', async () => {
    expect(await messageFor((c) => { c.displays[0].day_parts = { afternoon: 0, evening: 17 } })).toContain('displays[0].day_parts.afternoon: must be from 1 to 22')
    expect(await messageFor((c) => { c.displays[0].day_parts = { afternoon: 12, evening: 24 } })).toContain('displays[0].day_parts.evening: must be from 2 to 23')
    expect(await messageFor((c) => { c.displays[0].day_parts = { afternoon: 12, evening: 1 } })).toContain('displays[0].day_parts.evening: must be from 2 to 23')
  })

  it('day_parts that are not whole hours', async () => {
    const message = await messageFor((c) => { c.displays[0].day_parts = { afternoon: 12.5, evening: 17 } })

    expect(message).toContain('displays[0].day_parts.afternoon: must be a whole number')
  })

  it('day_parts with an unknown key', async () => {
    const message = await messageFor((c) => { c.displays[0].day_parts = { afternoon: 12, evening: 17, night: 22 } })

    expect(message).toContain('displays[0].day_parts.night: unknown setting')
  })

  it('weather_on_dates with a value that is not true or false', async () => {
    const message = await messageFor((c) => { c.displays[0].weather_on_dates = { month: 'yes' } })

    expect(message).toContain('displays[0].weather_on_dates.month: must be true or false')
  })

  it('show_locations that is not true or false', async () => {
    const message = await messageFor((c) => { c.displays[0].show_locations = 'yes' })

    expect(message).toContain('displays[0].show_locations')
  })

  it('weather_on_dates with an unknown key', async () => {
    const message = await messageFor((c) => { c.displays[0].weather_on_dates = { day: true } })

    expect(message).toContain('displays[0].weather_on_dates.day: unknown setting')
  })

  it('night_text next_alarm without an alarm block', async () => {
    const message = await messageFor((c) => { c.displays[0].night_text = 'next_alarm' })

    expect(message).toContain('displays[0].night_text: is next_alarm, but there is no "alarm" block')
  })

  it('names the display whose night_text needs an alarm block', async () => {
    const message = await messageFor((c) => {
      c.displays.push({ id: 'kitchen', name: 'Kitchen', night_text: 'next_alarm' })
    })

    expect(message).toContain('displays[1].night_text')
    expect(message).not.toContain('displays[0].night_text')
  })

  it('accepts night_text next_alarm with an alarm block', async () => {
    const config = minimalConfig()
    config.displays[0].night_text = 'next_alarm'
    config.homeassistant = { url: 'http://ha.local:8123', token: 'abc' }
    config.alarm = { entity_id: 'sensor.phone_next_alarm' }
    const { config: loaded } = await load({ config })

    expect(loaded.displays[0]!.night_text).toBe('next_alarm')
  })

  it('an unknown night_text', async () => {
    const message = await messageFor((c) => { c.displays[0].night_text = 'weather' })

    expect(message).toContain('displays[0].night_text')
  })

  it('an unknown orientation', async () => {
    const message = await messageFor((c) => { c.displays[0].orientation = 'sideways' })

    expect(message).toContain('displays[0].orientation')
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
    ['quiet hours that start and end together', (c: Raw) => { c.policies = { auto_presence: { quiet_hours: { from: '22:00', to: '22:00' } } } }, 'policies.auto_presence.quiet_hours.to: from and to must differ'],
    ['a negative night_below_lux', (c: Raw) => { c.policies = { auto_brightness: { night_below_lux: -1 } } }, 'policies.auto_brightness.night_below_lux'],
    ['a night_below_lux of 0, which no reading is below', (c: Raw) => { c.policies = { auto_brightness: { night_below_lux: 0 } } }, 'policies.auto_brightness.night_below_lux'],
    ['a night action without night_below_lux', (c: Raw) => { c.policies = { auto_brightness: { night_action: 'night_view' } } }, 'policies.auto_brightness.night_below_lux: is needed when night_action is night_view'],
    ['a screen_off night action without night_below_lux', (c: Raw) => { c.policies = { auto_brightness: { night_action: 'screen_off' } } }, 'policies.auto_brightness.night_below_lux: is needed when night_action is screen_off'],
    ['night_above_lux without night_below_lux', (c: Raw) => { c.policies = { auto_brightness: { night_above_lux: 5 } } }, 'policies.auto_brightness.night_above_lux: needs night_below_lux as well'],
    ['night_above_lux equal to night_below_lux', (c: Raw) => { c.policies = { auto_brightness: { night_below_lux: 5, night_above_lux: 5 } } }, 'policies.auto_brightness.night_above_lux: must be more than night_below_lux'],
    ['night_above_lux below night_below_lux', (c: Raw) => { c.policies = { auto_brightness: { night_below_lux: 5, night_above_lux: 2 } } }, 'policies.auto_brightness.night_above_lux: must be more than night_below_lux'],
    ['an unknown night_action', (c: Raw) => { c.policies = { auto_brightness: { night_action: 'sleep' } } }, 'policies.auto_brightness.night_action'],
    ['an auto brightness curve of one point', (c: Raw) => { c.policies = { auto_brightness: { curve: [{ lux: 0, brightness: 50 }] } } }, 'policies.auto_brightness.curve: must have at least two points'],
    ['an auto brightness curve that is empty', (c: Raw) => { c.policies = { auto_brightness: { curve: [] } } }, 'policies.auto_brightness.curve: must have at least two points'],
    ['an auto brightness curve whose lux does not go up', (c: Raw) => { c.policies = { auto_brightness: { curve: [{ lux: 0, brightness: 10 }, { lux: 20, brightness: 60 }, { lux: 10, brightness: 100 }] } } }, 'policies.auto_brightness.curve: lux must go up from each point to the next'],
    ['an auto brightness curve that repeats a lux', (c: Raw) => { c.policies = { auto_brightness: { curve: [{ lux: 5, brightness: 10 }, { lux: 5, brightness: 60 }] } } }, 'policies.auto_brightness.curve: lux must go up from each point to the next'],
    ['a curve point with a negative lux', (c: Raw) => { c.policies = { auto_brightness: { curve: [{ lux: -1, brightness: 10 }, { lux: 5, brightness: 60 }] } } }, 'policies.auto_brightness.curve[0].lux'],
    ['a curve point with a brightness above 100', (c: Raw) => { c.policies = { auto_brightness: { curve: [{ lux: 0, brightness: 10 }, { lux: 5, brightness: 101 }] } } }, 'policies.auto_brightness.curve[1].brightness: must be from 0 to 100'],
    ['a curve point with a fractional brightness', (c: Raw) => { c.policies = { auto_brightness: { curve: [{ lux: 0, brightness: 10.5 }, { lux: 5, brightness: 60 }] } } }, 'policies.auto_brightness.curve[0].brightness: must be a whole number'],
    ['a curve point with an unknown key', (c: Raw) => { c.policies = { auto_brightness: { curve: [{ lux: 0, brightness: 10, percent: 5 }, { lux: 5, brightness: 60 }] } } }, 'policies.auto_brightness.curve[0].percent: unknown setting'],
    ['a min_step of 0', (c: Raw) => { c.policies = { auto_brightness: { min_step: 0 } } }, 'policies.auto_brightness.min_step'],
    ['a min_step above 50', (c: Raw) => { c.policies = { auto_brightness: { min_step: 51 } } }, 'policies.auto_brightness.min_step'],
    ['a fractional min_step', (c: Raw) => { c.policies = { auto_brightness: { min_step: 2.5 } } }, 'policies.auto_brightness.min_step'],
    ['a negative smoothing_seconds', (c: Raw) => { c.policies = { auto_brightness: { smoothing_seconds: -1 } } }, 'policies.auto_brightness.smoothing_seconds'],
    ['smoothing_seconds above 600', (c: Raw) => { c.policies = { auto_brightness: { smoothing_seconds: 601 } } }, 'policies.auto_brightness.smoothing_seconds'],
    ['a negative sync.months_back', (c: Raw) => { c.sync = { months_back: -1 } }, 'sync.months_back'],
    ['sync.months_ahead above 60', (c: Raw) => { c.sync = { months_ahead: 61 } }, 'sync.months_ahead'],
    ['a fractional sync.months_ahead', (c: Raw) => { c.sync = { months_ahead: 1.5 } }, 'sync.months_ahead'],
    ['an unknown sync key', (c: Raw) => { c.sync = { months: 6 } }, 'sync.months: unknown setting'],
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

describe('schedules', () => {
  const rule = (extra: Raw = {}) => ({ view: 'agenda', from: '06:30', to: '09:00', ...extra })
  const schedule = (extra: Raw = {}) => ({ id: 'mornings', rules: [rule()], ...extra })

  async function schedulesOf(schedules: unknown[]) {
    const raw = minimalConfig()
    raw.displays[0].schedules = schedules
    return (await load({ config: raw })).config.displays[0]!.schedules
  }

  it('takes a rule that shows the week by part of day view', async () => {
    const [only] = await schedulesOf([schedule({ rules: [rule({ view: 'week_parts' })] })])

    expect(only!.rules[0]).toMatchObject({ view: 'week_parts' })
  })

  it('is empty by default, and the name defaults to the id', async () => {
    expect((await load({ config: minimalConfig() })).config.displays[0]!.schedules).toEqual([])
    const [only] = await schedulesOf([schedule()])

    expect(only).toMatchObject({ id: 'mornings', name: 'mornings' })
  })

  it('keeps a name that is given', async () => {
    expect((await schedulesOf([schedule({ name: 'Morning agenda' })]))[0]!.name).toBe('Morning agenda')
  })

  it('runs every day unless told otherwise', async () => {
    expect((await schedulesOf([schedule()]))[0]!.rules[0]!.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  })

  it.each([
    ['every_day', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']],
    ['weekdays', ['mon', 'tue', 'wed', 'thu', 'fri']],
    ['weekends', ['sat', 'sun']],
    [['sun', 'mon', 'wed', 'mon'], ['mon', 'wed', 'sun']],
  ])('takes days as %j and normalises it to a list in week order', async (days, expected) => {
    const [only] = await schedulesOf([schedule({ rules: [rule({ days })] })])

    expect(only!.rules[0]!.days).toEqual(expected)
  })

  it('refuses days that are not a set name or a list of days', async () => {
    for (const days of ['mondays', [], ['funday']]) {
      const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [rule({ days })] })] })

      expect(message).toContain('displays[0].schedules[0].rules[0].days')
    }
  })

  it('takes a window that runs past midnight', async () => {
    expect((await schedulesOf([schedule({ rules: [rule({ from: '22:00', to: '02:00' })] })]))[0]!.rules[0]).toMatchObject({ from: '22:00', to: '02:00' })
  })

  it('refuses a window whose from equals its to', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [rule({ from: '09:00', to: '09:00' })] })] })

    expect(message).toContain('displays[0].schedules[0].rules[0]')
  })

  it('refuses a time that is not HH:MM', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [rule({ from: '25:00' })] })] })

    expect(message).toContain('displays[0].schedules[0].rules[0].from')
  })

  it('refuses a schedule id used twice on one display, naming the path', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule(), schedule()] })

    expect(message).toContain('displays[0].schedules[1].id: duplicate id "mornings"')
  })

  it('allows the same schedule id on two displays', async () => {
    const raw = minimalConfig()
    raw.displays = [{ id: 'hallway', name: 'Hallway', schedules: [schedule()] }, { id: 'kitchen', name: 'Kitchen', schedules: [schedule()] }]

    const { config } = await load({ config: raw })

    expect(config.displays.map(display => display.schedules[0]!.id)).toEqual(['mornings', 'mornings'])
  })

  it('refuses an id that is not a slug', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ id: 'Morning Agenda' })] })

    expect(message).toContain('displays[0].schedules[0].id')
  })

  it('refuses a photo rule without a photos block, naming the rule', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [rule({ view: 'photo' })] })] })

    expect(message).toContain('displays[0].schedules[0].rules[0].view: is photo, but there is no "photos" block')
  })

  it('refuses a week_photo rule without a photos block, naming the rule', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [rule({ view: 'week_photo' })] })] })

    expect(message).toContain('displays[0].schedules[0].rules[0].view: is week_photo, but there is no "photos" block')
  })

  it('takes a week_photo rule with a photos block', async () => {
    const raw = minimalConfig()
    raw.photos = { immich: { url: 'http://immich.local', api_key: 'k' } }
    raw.displays[0].schedules = [schedule({ rules: [rule({ view: 'week_photo' })] })]

    expect((await load({ config: raw })).config.displays[0]!.schedules[0]!.rules[0]!.view).toBe('week_photo')
  })

  it('takes a photo rule with a photos block', async () => {
    const raw = minimalConfig()
    raw.photos = { immich: { url: 'http://immich.local', api_key: 'k' } }
    raw.displays[0].schedules = [schedule({ rules: [rule({ view: 'photo' })] })]

    expect((await load({ config: raw })).config.displays[0]!.schedules[0]!.rules[0]!.view).toBe('photo')
  })

  it('takes a custom rule with the id of a layout', async () => {
    const [only] = await schedulesOf([schedule({ rules: [rule({ view: 'custom', layout: 'kitchen' })] })])

    expect(only!.rules[0]).toMatchObject({ view: 'custom', layout: 'kitchen' })
  })

  it('refuses a custom rule without a layout, naming the rule', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [rule({ view: 'custom' })] })] })

    expect(message).toContain('displays[0].schedules[0].rules[0].layout: is missing')
  })

  it('refuses a layout on a rule for any other view', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [rule({ view: 'agenda', layout: 'kitchen' })] })] })

    expect(message).toContain('displays[0].schedules[0].rules[0].layout: is set, but the view is agenda')
  })

  it('refuses a layout that is not an id', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [rule({ view: 'custom', layout: 'Kitchen Board' })] })] })

    expect(message).toContain('displays[0].schedules[0].rules[0].layout')
  })

  it('refuses a view that does not exist', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [rule({ view: 'clock' })] })] })

    expect(message).toContain('displays[0].schedules[0].rules[0].view: must be one of')
  })

  it('refuses a schedule with no rules', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [] })] })

    expect(message).toContain('displays[0].schedules[0].rules: must have at least one rule')
  })

  it('refuses an unknown key in a rule', async () => {
    const message = await messageFor((c) => { c.displays[0].schedules = [schedule({ rules: [rule({ day: 'mon' })] })] })

    expect(message).toContain('displays[0].schedules[0].rules[0].day: unknown setting')
  })
})
