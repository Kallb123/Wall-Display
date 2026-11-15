import { describe, expect, it } from 'vitest'
import { setupStatus } from '../../../server/settings/setup'
import { parsedConfig } from './helpers'

const HA_TOKEN = 'ha-secret-token'
const MQTT_PASSWORD = 'mqtt-secret-password'
const PIN = '4821'
const CAMERA_TOKEN = 'camera-secret-token'

/** A config with every block the Setup tab shows, each holding a secret that must not come out. */
const full = () => parsedConfig({
  timezone: 'Europe/Paris',
  sync: { months_back: 3, months_ahead: 6 },
  remote: { pin: PIN },
  groups: [{ id: 'everyone', name: 'Everyone', aliases: ['All'], people: ['mum'] }],
  homeassistant: { url: 'http://ha.local:8123/some/path', token: HA_TOKEN },
  mqtt: { url: 'mqtt://mosquitto:1883', username: 'wall', password: MQTT_PASSWORD, discovery_prefix: 'ha' },
  button: { single: 'toggle_screen' },
  weather: { entity_id: 'weather.home' },
  alarm: { entity_id: 'sensor.phone_next_alarm', poll_seconds: 120 },
  timers: { entities: [{ entity_id: 'timer.pasta', displays: ['kitchen'] }, { entity_id: 'sensor.speaker_timers' }], done_seconds: 30 },
  cameras: [{ id: 'door', name: 'Front door', url: `http://user:pass@go2rtc.local:1984/api/stream.mp4?src=door&token=${CAMERA_TOKEN}` }],
  triggers: [
    { id: 'doorbell', when: { entity_id: 'binary_sensor.doorbell', to: 'on' }, actions: [{ type: 'set_camera', camera: 'door' }] },
    { id: 'bus', when: { event_type: 'bus_due', event_data: { stop: 12 } }, displays: ['hallway'], actions: [{ type: 'set_view', view: 'agenda' }] },
  ],
}, {
  schedules: [{ id: 'nights', rules: [{ view: 'night', from: '22:00', to: '06:00', days: 'every_day' }] }],
})

describe('setupStatus', () => {
  it('shows every block the other tabs leave out', () => {
    const status = setupStatus(full())

    expect(status.timezone).toBe('Europe/Paris')
    expect(status.sync).toEqual({ months_back: 3, months_ahead: 6 })
    expect(status.remote_pin).toBe(true)
    expect(status.displays).toEqual([{ id: 'hallway', name: 'Hallway' }, { id: 'kitchen', name: 'Kitchen' }])
    expect(status.groups).toEqual([{ id: 'everyone', name: 'Everyone', aliases: ['All'], people: ['mum'] }])
    expect(status.homeassistant).toEqual({ host: 'ha.local:8123' })
    expect(status.mqtt).toEqual({ broker: 'mqtt://mosquitto:1883', client_id: 'wallcal', signs_in: true, discovery: true, discovery_prefix: 'ha' })
    expect(status.button).toEqual({ single: 'toggle_screen', double: 'toggle_photo', long: 'ha' })
    expect(status.brightness_curve).toHaveLength(3)
    expect(status.weather).toEqual({ entity_id: 'weather.home', poll_seconds: 600 })
    expect(status.alarm).toEqual({ entity_id: 'sensor.phone_next_alarm', poll_seconds: 120 })
  })

  it('lists each display\'s schedules with the days filled in', () => {
    expect(setupStatus(full()).schedules).toEqual([
      { display_id: 'hallway', schedules: [{ id: 'nights', name: 'nights', rules: [{ view: 'night', layout: null, photo_feed: null, from: '22:00', to: '06:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }] }] },
      { display_id: 'kitchen', schedules: [] },
    ])
  })

  it('lists the kitchen timers, with null for an entity on every display', () => {
    expect(setupStatus(full()).timers).toEqual({
      poll_seconds: 30,
      done_seconds: 30,
      entities: [{ entity_id: 'timer.pasta', displays: ['kitchen'] }, { entity_id: 'sensor.speaker_timers', displays: null }],
    })
  })

  it('names a camera by host and path, without credentials or a query', () => {
    expect(setupStatus(full()).cameras).toEqual([{ id: 'door', name: 'Front door', kind: 'video', where: 'go2rtc.local:1984/api/stream.mp4' }])
  })

  it('lists the triggers, with the actions\' defaults filled in', () => {
    expect(setupStatus(full()).triggers).toEqual([
      { id: 'doorbell', when: { kind: 'state', entity_ids: ['binary_sensor.doorbell'], from: null, to: ['on'] }, displays: null, actions: [{ type: 'set_camera', camera: 'door', seconds: 60, wake: true }] },
      { id: 'bus', when: { kind: 'event', event_type: 'bus_due', event_data: { stop: 12 } }, displays: ['hallway'], actions: [{ type: 'set_view', view: 'agenda' }] },
    ])
  })

  it('carries no token, password, PIN or camera credential', () => {
    const text = JSON.stringify(setupStatus(full()))

    for (const secret of [HA_TOKEN, MQTT_PASSWORD, PIN, CAMERA_TOKEN, 'user:pass', '/some/path']) expect(text).not.toContain(secret)
  })

  it('says what is not set up', () => {
    const status = setupStatus(parsedConfig())

    expect(status.remote_pin).toBe(false)
    expect(status.homeassistant).toBeNull()
    expect(status.mqtt).toBeNull()
    expect(status.weather).toBeNull()
    expect(status.alarm).toBeNull()
    expect(status.timers).toBeNull()
    expect(status.cameras).toEqual([])
    expect(status.triggers).toEqual([])
  })
})
