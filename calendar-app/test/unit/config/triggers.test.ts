import { describe, expect, it } from 'vitest'
import { cameraKindFor } from '../../../server/config/schema'
import { load, loadError, minimalConfig } from './helpers'

// The `cameras` and `triggers` blocks: a camera's feed, and something in Home
// Assistant (a doorbell, say) that makes the wall act.

type Raw = ReturnType<typeof minimalConfig>

const HA = { url: 'http://homeassistant.local:8123', token: 'secret-token' }

function withDoorbell(change: (config: Raw) => void = () => {}): Raw {
  const config = minimalConfig()
  config.homeassistant = HA
  config.cameras = [{ id: 'front-door', name: 'Front door', url: 'http://go2rtc.local:1984/stream.html?src=front_door' }]
  config.triggers = [{
    id: 'doorbell',
    when: { entity_id: 'binary_sensor.front_doorbell', to: 'on' },
    actions: [{ type: 'set_camera', camera: 'front-door' }],
  }]
  change(config)
  return config
}

async function messageFor(change: (config: Raw) => void): Promise<string> {
  return (await loadError({ config: withDoorbell(change) })).message
}

describe('cameras', () => {
  it('default to none', async () => {
    const { config } = await load({ config: minimalConfig() })

    expect(config.cameras).toEqual([])
    expect(config.triggers).toEqual([])
  })

  it('work out how to show the feed from its address, and take the id as the name when there is none', async () => {
    const { config } = await load({ config: withDoorbell((c) => {
      c.cameras.push(
        { id: 'garden', url: 'http://go2rtc.local:1984/api/stream.mjpeg?src=garden' },
        { id: 'drive', url: 'http://go2rtc.local:1984/api/stream.mp4?src=drive', kind: 'page' },
      )
    }) })

    expect(config.cameras).toEqual([
      { id: 'front-door', name: 'Front door', url: 'http://go2rtc.local:1984/stream.html?src=front_door', kind: 'page' },
      { id: 'garden', name: 'garden', url: 'http://go2rtc.local:1984/api/stream.mjpeg?src=garden', kind: 'image' },
      // Set by hand, it wins over the address.
      { id: 'drive', name: 'drive', url: 'http://go2rtc.local:1984/api/stream.mp4?src=drive', kind: 'page' },
    ])
  })

  it('need an http or https address', async () => {
    expect(await messageFor((c) => { c.cameras[0].url = 'rtsp://camera.local/stream' })).toContain('cameras[0].url')
  })

  it('need unique ids', async () => {
    const message = await messageFor((c) => { c.cameras.push({ id: 'front-door', url: 'http://go2rtc.local:1984/stream.html?src=x' }) })

    expect(message).toContain('cameras[1].id: duplicate id "front-door"')
  })

  it('refuse a kind that is not one', async () => {
    expect(await messageFor((c) => { c.cameras[0].kind = 'rtsp' })).toContain('cameras[0].kind')
  })
})

describe('cameraKindFor', () => {
  it.each([
    ['http://go2rtc:1984/stream.html?src=door', 'page'],
    ['http://go2rtc:1984/webrtc.html?src=door', 'page'],
    ['http://go2rtc:1984/api/stream.mjpeg?src=door', 'image'],
    ['http://go2rtc:1984/api/frame.jpeg?src=door', 'image'],
    ['http://camera.local/snapshot.JPG', 'image'],
    ['http://go2rtc:1984/api/stream.mp4?src=door', 'video'],
    ['http://camera.local/live.webm', 'video'],
    ['http://camera.local/', 'page'],
    ['not a url', 'page'],
  ] as const)('%s is a %s', (url, kind) => {
    expect(cameraKindFor(url)).toBe(kind)
  })
})

describe('triggers', () => {
  it('read a state trigger, with single states made lists and numbers made text', async () => {
    const { config } = await load({ config: withDoorbell((c) => {
      c.triggers[0].when = { entity_id: ['binary_sensor.front_doorbell', 'binary_sensor.back_doorbell'], from: 'off', to: ['on', 2] }
      c.triggers[0].displays = ['hallway']
    }) })

    expect(config.triggers).toEqual([{
      id: 'doorbell',
      when: { kind: 'state', entity_ids: ['binary_sensor.front_doorbell', 'binary_sensor.back_doorbell'], from: ['off'], to: ['on', '2'] },
      displays: ['hallway'],
      actions: [{ type: 'set_camera', camera: 'front-door', seconds: 60, wake: true }],
    }])
  })

  it('read an event trigger, and any command as an action', async () => {
    const { config } = await load({ config: withDoorbell((c) => {
      c.triggers[0].when = { event_type: 'doorbell_pressed', event_data: { device: 'front' } }
      c.triggers[0].actions = [
        { type: 'set_camera', camera: 'front-door', seconds: 120, wake: false },
        { type: 'set_overlay', overlay: { text: 'Someone is at the door', icon: 'bell', ttl: 120 } },
      ]
    }) })

    expect(config.triggers[0]!.when).toEqual({ kind: 'event', event_type: 'doorbell_pressed', event_data: { device: 'front' } })
    expect(config.triggers[0]!.actions).toHaveLength(2)
    expect(config.triggers[0]!.displays).toBeUndefined()
  })

  it('need the homeassistant block', async () => {
    expect(await messageFor((c) => { delete c.homeassistant })).toContain('triggers[0]: listens to Home Assistant, but there is no "homeassistant" block')
  })

  it('need either an entity or an event, not both and not neither', async () => {
    expect(await messageFor((c) => { c.triggers[0].when = { to: 'on' } })).toContain('must set either entity_id')
    expect(await messageFor((c) => { c.triggers[0].when = { entity_id: 'binary_sensor.door', event_type: 'ring' } })).toContain('must set either entity_id')
  })

  it('keep from and to for state changes, and event_data for events', async () => {
    expect(await messageFor((c) => { c.triggers[0].when = { event_type: 'ring', to: 'on' } })).toContain('triggers[0].when.to: is only for a state change')
    expect(await messageFor((c) => { c.triggers[0].when = { entity_id: 'binary_sensor.door', event_data: { a: 1 } } })).toContain('triggers[0].when.event_data: is only for an event')
  })

  it('refuse an entity id that is not one, and true or false as a state', async () => {
    expect(await messageFor((c) => { c.triggers[0].when.entity_id = 'doorbell' })).toContain('triggers[0].when.entity_id')
    expect(await messageFor((c) => { c.triggers[0].when.to = true })).toContain('triggers[0].when.to')
  })

  it('need at least one action, and refuse one that is not a command', async () => {
    expect(await messageFor((c) => { c.triggers[0].actions = [] })).toContain('triggers[0].actions: must have at least one action')
    expect(await messageFor((c) => { c.triggers[0].actions = [{ type: 'ring_bell' }] })).toContain('triggers[0].actions[0]')
    expect(await messageFor((c) => { c.triggers[0].actions[0].seconds = 1 })).toContain('triggers[0].actions[0].seconds')
  })

  it('refuse a camera, a display or a schedule that is not in the config', async () => {
    expect(await messageFor((c) => { c.triggers[0].actions[0].camera = 'garden' })).toContain('triggers[0].actions[0].camera: unknown camera "garden"')
    expect(await messageFor((c) => { c.triggers[0].displays = ['kitchen'] })).toContain('triggers[0].displays[0]: unknown display "kitchen"')
    expect(await messageFor((c) => { c.triggers[0].actions = [{ type: 'set_schedule', schedule: 'mornings', on: false }] })).toContain('display "hallway" has no schedule "mornings"')
  })

  it('accept taking the camera down as an action', async () => {
    const { config } = await load({ config: withDoorbell((c) => { c.triggers[0].actions = [{ type: 'set_camera', camera: null }] }) })

    expect(config.triggers[0]!.actions[0]).toMatchObject({ type: 'set_camera', camera: null })
  })

  it('need unique ids', async () => {
    expect(await messageFor((c) => { c.triggers.push({ ...c.triggers[0] }) })).toContain('triggers[1].id: duplicate id "doorbell"')
  })
})
