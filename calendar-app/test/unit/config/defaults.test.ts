import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { load, loadError, minimalConfig } from './helpers'

describe('defaults', () => {
  it('fills in people', async () => {
    const { config } = await load({ config: minimalConfig() })

    expect(config.timezone).toBe('Europe/London')
    expect(config.people[0]).toEqual({ id: 'mum', name: 'Mum', colour: '#C67139', initial: 'M', aliases: [] })
  })

  it('keeps an explicit initial', async () => {
    const raw = minimalConfig()
    raw.people[0].initial = 'Z'
    const { config } = await load({ config: raw })

    expect(config.people[0]!.initial).toBe('Z')
  })

  it('fills in calendars', async () => {
    const { config } = await load({ config: minimalConfig() })

    expect(config.calendars[0]).toEqual({
      id: 'family',
      person: 'mum',
      detect_people: true,
      detect_in: ['title', 'description'],
      strip_names: false,
      rules: [],
      source: { type: 'ics', url: 'https://example.com/family.ics', poll_seconds: 120 },
    })
  })

  it('defaults to no calendars', async () => {
    const raw = minimalConfig()
    delete raw.calendars
    const { config } = await load({ config: raw })

    expect(config.calendars).toEqual([])
  })

  it('fills in displays', async () => {
    const { config } = await load({ config: minimalConfig() })

    expect(config.displays[0]).toEqual({
      id: 'hallway',
      name: 'Hallway',
      theme: 'light',
      month_style: 'soft',
      month_return_minutes: 15,
      week_start: 'monday',
    })
  })

  it('fills in button, policies and leaves optional blocks out', async () => {
    const { config } = await load({ config: minimalConfig() })

    expect(config.button).toEqual({ single: 'next_view', double: 'toggle_photo', long: 'ha' })
    expect(config.policies).toEqual({
      auto_presence: { off_after_minutes: 10 },
      auto_brightness: { night_action: 'none' },
    })
    expect(config.photos).toBeUndefined()
    expect(config.remote).toBeUndefined()
    expect(config.homeassistant).toBeUndefined()
    expect(config.weather).toBeUndefined()
  })

  it('polls the weather every ten minutes unless told otherwise', async () => {
    const raw = minimalConfig()
    raw.homeassistant = { url: 'http://ha.local', token: 't' }
    raw.weather = { entity_id: 'weather.home' }
    const { config } = await load({ config: raw })

    expect(config.weather).toEqual({ entity_id: 'weather.home', poll_seconds: 600 })
  })

  it('keeps a year of events either side of this month unless told otherwise', async () => {
    const { config } = await load({ config: minimalConfig() })

    expect(config.sync).toEqual({ months_back: 12, months_ahead: 12 })
  })

  it('fills in a partly given sync block', async () => {
    const raw = minimalConfig()
    raw.sync = { months_back: 3 }
    const { config } = await load({ config: raw })

    expect(config.sync).toEqual({ months_back: 3, months_ahead: 12 })
  })

  it('accepts a sync window of none or five years', async () => {
    const raw = minimalConfig()
    raw.sync = { months_back: 0, months_ahead: 60 }
    const { config } = await load({ config: raw })

    expect(config.sync).toEqual({ months_back: 0, months_ahead: 60 })
  })

  it('fills in partly given blocks', async () => {
    const raw = minimalConfig()
    raw.button = { long: 'toggle_screen' }
    raw.photos = { immich: { url: 'http://immich.local', api_key: 'k' } }
    raw.calendars.push({ id: 'bins', person: 'mum', source: { type: 'homeassistant', entity_id: 'calendar.bins' } })
    raw.homeassistant = { url: 'http://ha.local', token: 't' }
    const { config } = await load({ config: raw })

    expect(config.button).toEqual({ single: 'next_view', double: 'toggle_photo', long: 'toggle_screen' })
    expect(config.photos).toEqual({
      interval_seconds: 60,
      landscape_only: false,
      cache_max_mb: 2048,
      immich: { url: 'http://immich.local', api_key: 'k', album_ids: [] },
    })
    expect(config.calendars[1]!.source).toEqual({ type: 'homeassistant', entity_id: 'calendar.bins', poll_seconds: 300 })
  })

  it('returns a deeply frozen config', async () => {
    const { config } = await load({ config: minimalConfig() })

    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.people[0])).toBe(true)
    expect(Object.isFrozen(config.calendars[0]!.source)).toBe(true)
    expect(() => { (config.people as unknown[]).push({}) }).toThrow()
  })
})

describe('relative file: URLs', () => {
  async function urlFor(url: string) {
    const raw = minimalConfig()
    raw.calendars[0].source.url = url
    const { dir, config } = await load({ config: raw })
    return { dir, url: (config.calendars[0]!.source as { url: string }).url }
  }

  it('resolve from the config file\'s folder, not the working directory', async () => {
    const { dir, url } = await urlFor('file:./fixtures/family.ics')

    expect(url).toBe(pathToFileURL(join(dir, 'fixtures/family.ics')).href)
    expect(url.startsWith('file:///')).toBe(true)
  })

  it('handle .. and bare relative paths', async () => {
    const { dir, url } = await urlFor('file:../other/a.ics')
    expect(url).toBe(pathToFileURL(join(dir, '../other/a.ics')).href)

    const bare = await urlFor('file:a b.ics')
    expect(bare.url).toBe(pathToFileURL(join(bare.dir, 'a b.ics')).href)
  })

  it('keep absolute paths and file:/// URLs', async () => {
    expect((await urlFor('file:/srv/cal/a.ics')).url).toBe('file:///srv/cal/a.ics')
    expect((await urlFor('file:///srv/cal/a.ics')).url).toBe('file:///srv/cal/a.ics')
  })

  it('do not need the file to exist', async () => {
    const { url } = await urlFor('file:./does-not-exist.ics')

    expect(url).toContain('does-not-exist.ics')
  })

  it('are rejected when empty', async () => {
    const raw = minimalConfig()
    raw.calendars[0].source.url = 'file:'

    expect((await loadError({ config: raw })).message).toContain('calendars[0].source.url')
  })
})

describe('WALLCAL_TIMEZONE', () => {
  it('overrides timezone', async () => {
    const raw = minimalConfig()
    raw.timezone = 'Europe/Paris'
    const { config } = await load({ config: raw, env: { WALLCAL_TIMEZONE: 'America/New_York' } })

    expect(config.timezone).toBe('America/New_York')
  })

  it('applies when the file has no timezone', async () => {
    const { config } = await load({ config: minimalConfig(), env: { WALLCAL_TIMEZONE: 'Asia/Tokyo' } })

    expect(config.timezone).toBe('Asia/Tokyo')
  })

  it('is validated, and the error says where the value came from', async () => {
    const error = await loadError({ config: minimalConfig(), env: { WALLCAL_TIMEZONE: 'Nowhere/Land' } })

    expect(error.message).toContain('timezone')
    expect(error.message).toContain('WALLCAL_TIMEZONE')
  })
})
