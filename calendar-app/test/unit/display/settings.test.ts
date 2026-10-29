import { describe, expect, it } from 'vitest'
import type { ConnectionsStatus } from '../../../shared/settings'
import {
  detectionIsOff,
  detectionLabel,
  discoveryBlockedReason,
  fallbackDateLabel,
  fullDateTime,
  homeAssistantChip,
  lastSyncLabel,
  listNames,
  mqttChip,
  mqttLinkChip,
  occurrencesLabel,
  photoSourceLabel,
  pollLabel,
  relativeTime,
  remotesChip,
  screenLabel,
  shownMonthLabel,
  sourceLabel,
  viewLabel,
  wallPageChip,
} from '../../../app/utils/settings'

// Wed 28 Oct 2026, 09:41 in London (the clocks went back on the 25th, so that is 09:41Z).
const NOW = new Date('2026-10-28T09:41:00Z')
const LONDON = 'Europe/London'

describe('detectionLabel', () => {
  it('says Off when detection is off, whatever it would search', () => {
    expect(detectionLabel(false, ['title', 'description'])).toBe('Off')
    expect(detectionLabel(false, [])).toBe('Off')
  })

  it('names where a name is looked for when it has to start the text', () => {
    expect(detectionLabel(true, ['title', 'description'])).toBe('Title and description')
    expect(detectionLabel(true, ['description', 'title'])).toBe('Title and description')
    expect(detectionLabel(true, ['title'])).toBe('Title only')
    expect(detectionLabel(true, ['description'])).toBe('Description only')
  })

  it('says "Anywhere in" for a name that may be anywhere in the text', () => {
    expect(detectionLabel('anywhere', ['title', 'description'])).toBe('Anywhere in title and description')
    expect(detectionLabel('anywhere', ['title'])).toBe('Anywhere in title')
    expect(detectionLabel('anywhere', ['description'])).toBe('Anywhere in description')
  })

  it('is Off when there is nowhere to look', () => {
    expect(detectionLabel(true, [])).toBe('Off')
  })
})

describe('detectionIsOff', () => {
  it('is true only when the label says Off', () => {
    expect(detectionIsOff({ detect_people: false, detect_in: ['title'] })).toBe(true)
    expect(detectionIsOff({ detect_people: true, detect_in: [] })).toBe(true)
    expect(detectionIsOff({ detect_people: true, detect_in: ['title'] })).toBe(false)
    expect(detectionIsOff({ detect_people: 'anywhere', detect_in: ['description'] })).toBe(false)
  })
})

describe('sourceLabel', () => {
  it('names each source type', () => {
    expect(sourceLabel('ics')).toBe('ICS feed')
    expect(sourceLabel('homeassistant')).toBe('Home Assistant')
  })
})

describe('pollLabel', () => {
  it('uses the biggest whole unit', () => {
    expect(pollLabel(900)).toBe('Every 15 minutes')
    expect(pollLabel(60)).toBe('Every minute')
    expect(pollLabel(3600)).toBe('Every hour')
    expect(pollLabel(7200)).toBe('Every 2 hours')
  })

  it('falls back to seconds when the time is not a whole number of minutes', () => {
    expect(pollLabel(90)).toBe('Every 90 seconds')
    expect(pollLabel(30)).toBe('Every 30 seconds')
    expect(pollLabel(1)).toBe('Every second')
  })
})

describe('relativeTime', () => {
  const ago = (seconds: number) => relativeTime(new Date(NOW.getTime() - seconds * 1000).toISOString(), NOW)

  it('says Just now for under a minute, and for a time a little in the future', () => {
    expect(ago(0)).toBe('Just now')
    expect(ago(59)).toBe('Just now')
    expect(ago(-20)).toBe('Just now')
  })

  it('counts minutes, hours and days, rounding down', () => {
    expect(ago(60)).toBe('1 minute ago')
    expect(ago(120)).toBe('2 minutes ago')
    expect(ago(59 * 60 + 59)).toBe('59 minutes ago')
    expect(ago(3600)).toBe('1 hour ago')
    expect(ago(5 * 3600 + 1800)).toBe('5 hours ago')
    expect(ago(24 * 3600)).toBe('1 day ago')
    expect(ago(3 * 24 * 3600)).toBe('3 days ago')
  })
})

describe('fullDateTime', () => {
  it('is the weekday, date and 24-hour time in the zone given', () => {
    expect(fullDateTime('2026-10-28T09:39:00Z', LONDON)).toBe('Wed 28 Oct 2026, 09:39')
  })

  it('does not use the process time zone (the unit tests run in Auckland)', () => {
    expect(fullDateTime('2026-10-28T23:30:00Z', LONDON)).toBe('Wed 28 Oct 2026, 23:30')
    expect(fullDateTime('2026-10-28T23:30:00Z', 'Pacific/Auckland')).toBe('Thu 29 Oct 2026, 12:30')
  })
})

describe('lastSyncLabel', () => {
  it('says how long ago the last success was', () => {
    expect(lastSyncLabel({ syncing: true, last_success_at: '2026-10-28T09:39:00Z' }, NOW)).toBe('2 minutes ago')
  })

  it('says Never when there has been no success', () => {
    expect(lastSyncLabel({ syncing: true, last_success_at: null }, NOW)).toBe('Never')
  })

  it('says why a source that is never synced has no time', () => {
    expect(lastSyncLabel({ syncing: false, last_success_at: null }, NOW)).toBe('Not synced: this source type has no sync yet')
  })
})

describe('fallbackDateLabel', () => {
  const timed = (start: string) => ({ start, all_day: false, start_date: null })
  const allDay = (date: string) => ({ start: `${date}T00:00:00Z`, all_day: true, start_date: date })

  it('says Today, Tomorrow and Yesterday for an all-day event by its own date', () => {
    expect(fallbackDateLabel(allDay('2026-10-28'), NOW, LONDON)).toBe('Today')
    expect(fallbackDateLabel(allDay('2026-10-29'), NOW, LONDON)).toBe('Tomorrow')
    expect(fallbackDateLabel(allDay('2026-10-27'), NOW, LONDON)).toBe('Yesterday')
  })

  it('writes any other day as weekday, day and month', () => {
    expect(fallbackDateLabel(allDay('2026-10-31'), NOW, LONDON)).toBe('Sat 31 Oct')
    expect(fallbackDateLabel(allDay('2026-11-02'), NOW, LONDON)).toBe('Mon 2 Nov')
    expect(fallbackDateLabel(allDay('2027-01-01'), NOW, LONDON)).toBe('Fri 1 Jan')
  })

  it('puts a timed event on the day it starts in the wall\'s zone', () => {
    // 23:30 UTC on the 28th is already the 29th in Auckland, but still the 28th in London.
    expect(fallbackDateLabel(timed('2026-10-28T23:30:00Z'), NOW, LONDON)).toBe('Today')
    expect(fallbackDateLabel(timed('2026-10-28T23:30:00Z'), NOW, 'Pacific/Auckland')).toBe('Tomorrow')
    expect(fallbackDateLabel(timed('2026-10-31T14:00:00Z'), NOW, LONDON)).toBe('Sat 31 Oct')
  })

  it('judges "today" in the wall\'s zone too, not the process\'s', () => {
    const lateInLondon = new Date('2026-10-28T23:30:00Z')
    expect(fallbackDateLabel(allDay('2026-10-28'), lateInLondon, LONDON)).toBe('Today')
    expect(fallbackDateLabel(allDay('2026-10-28'), lateInLondon, 'Pacific/Auckland')).toBe('Yesterday')
  })
})

describe('occurrencesLabel', () => {
  it('is empty for one occurrence and counts more', () => {
    expect(occurrencesLabel(1)).toBe('')
    expect(occurrencesLabel(2)).toBe('· 2 times')
    expect(occurrencesLabel(4)).toBe('· 4 times')
  })
})

describe('mqttChip', () => {
  const mqtt = (changes: Partial<ConnectionsStatus['mqtt']>): ConnectionsStatus['mqtt'] =>
    ({ configured: true, broker: 'mqtt://mosquitto:1883', discovery: true, connected: 2, total: 2, ...changes })

  it('is Off, quietly, when there is no mqtt block', () => {
    expect(mqttChip(mqtt({ configured: false, broker: null, connected: 0 }))).toEqual({ label: 'Off', tone: 'off', detail: null })
  })

  it('is Connected when every display is', () => {
    expect(mqttChip(mqtt({}))).toEqual({ label: 'Connected', tone: 'ok', detail: null })
  })

  it('counts the displays when only some are connected', () => {
    expect(mqttChip(mqtt({ connected: 1 }))).toEqual({ label: '1 of 2 connected', tone: 'warn', detail: null })
  })

  it('is Disconnected when none are', () => {
    expect(mqttChip(mqtt({ connected: 0 }))).toEqual({ label: 'Disconnected', tone: 'bad', detail: null })
  })
})

describe('homeAssistantChip', () => {
  it('is Not set up without a Home Assistant in the config', () => {
    expect(homeAssistantChip({ configured: false, state: 'off', error: null, checked_at: null })).toEqual({ label: 'Not set up', tone: 'off', detail: null })
  })

  it('is Connected when Home Assistant answered', () => {
    expect(homeAssistantChip({ configured: true, state: 'ok', error: null, checked_at: '2026-10-28T09:40:00Z' })).toEqual({ label: 'Connected', tone: 'ok', detail: null })
  })

  it('is Unreachable with the reason when it did not', () => {
    expect(homeAssistantChip({ configured: true, state: 'error', error: 'Home Assistant refused the token', checked_at: '2026-10-28T09:40:00Z' }))
      .toEqual({ label: 'Unreachable', tone: 'bad', detail: 'Home Assistant refused the token' })
  })
})

describe('mqttLinkChip', () => {
  it('names each state, with a tone, and passes the error on', () => {
    expect(mqttLinkChip('connected', null)).toEqual({ label: 'Connected', tone: 'ok', detail: null })
    expect(mqttLinkChip('connecting', null)).toEqual({ label: 'Connecting', tone: 'warn', detail: null })
    expect(mqttLinkChip('disconnected', 'Connection refused')).toEqual({ label: 'Disconnected', tone: 'bad', detail: 'Connection refused' })
    expect(mqttLinkChip('off', null)).toEqual({ label: 'Off', tone: 'off', detail: null })
  })
})

describe('shownMonthLabel', () => {
  it('says This month while the display follows the calendar', () => {
    expect(shownMonthLabel(null)).toBe('This month')
  })

  it('names a pinned month in British English, whatever the process time zone', () => {
    expect(shownMonthLabel('2026-11')).toBe('November 2026')
    expect(shownMonthLabel('2027-01')).toBe('January 2027')
  })
})

describe('the display state labels', () => {
  it('names the views, the photo sources and the screen', () => {
    expect(viewLabel('agenda')).toBe('Agenda')
    expect(viewLabel('photo')).toBe('Photo frame')
    expect(photoSourceLabel('google')).toBe('Google Photos')
    expect(photoSourceLabel('immich')).toBe('Immich')
    expect(screenLabel('on')).toBe('On')
    expect(screenLabel('off')).toBe('Off (standby)')
  })

})

describe('wallPageChip', () => {
  it('says whether the wall\'s page is connected', () => {
    expect(wallPageChip(1)).toEqual({ label: 'Connected', tone: 'ok', detail: null })
    expect(wallPageChip(0)).toEqual({ label: 'Not connected', tone: 'bad', detail: null })
  })

  it('counts them if there are several, which is worth noticing', () => {
    expect(wallPageChip(2)).toEqual({ label: '2 connected', tone: 'ok', detail: null })
  })
})

describe('remotesChip', () => {
  it('counts the remotes, and treats none as quiet, not broken', () => {
    expect(remotesChip(0)).toEqual({ label: 'None connected', tone: 'off', detail: null })
    expect(remotesChip(3)).toEqual({ label: '3 connected', tone: 'ok', detail: null })
  })
})

describe('listNames', () => {
  it('reads as a sentence', () => {
    expect(listNames([])).toBe('')
    expect(listNames(['Hallway'])).toBe('Hallway')
    expect(listNames(['Hallway', 'Kitchen'])).toBe('Hallway and Kitchen')
    expect(listNames(['Hallway', 'Kitchen', 'Attic'])).toBe('Hallway, Kitchen and Attic')
  })
})

describe('discoveryBlockedReason', () => {
  const connections = (mqtt: Partial<ConnectionsStatus['mqtt']>): ConnectionsStatus => ({
    mqtt: { configured: true, broker: 'mqtt://mosquitto:1883', discovery: true, connected: 1, total: 1, ...mqtt },
    homeassistant: { configured: false, state: 'off', error: null, checked_at: null },
  })

  it('has no reason before the connections are known, as the server will say if it cannot', () => {
    expect(discoveryBlockedReason(null)).toBeNull()
  })

  it('has none when MQTT and discovery are on, even with the broker down', () => {
    expect(discoveryBlockedReason(connections({}))).toBeNull()
    expect(discoveryBlockedReason(connections({ connected: 0 }))).toBeNull()
  })

  it('says when MQTT is off, which comes before discovery', () => {
    expect(discoveryBlockedReason(connections({ configured: false, broker: null, discovery: false }))).toMatch(/^MQTT is off/)
  })

  it('says when discovery is off', () => {
    expect(discoveryBlockedReason(connections({ discovery: false }))).toMatch(/^Discovery is off/)
  })
})
