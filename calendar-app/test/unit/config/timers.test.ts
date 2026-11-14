import { describe, expect, it } from 'vitest'
import { load, loadError, minimalConfig } from './helpers'

// The `timers` block: the Home Assistant entities that hold kitchen timers.

type Raw = ReturnType<typeof minimalConfig>

const HA = { url: 'http://homeassistant.local:8123', token: 'secret-token' }

function withTimers(change: (config: Raw) => void = () => {}): Raw {
  const config = minimalConfig()
  config.homeassistant = HA
  config.timers = { entities: [{ entity_id: 'sensor.kitchen_speaker_timers' }] }
  change(config)
  return config
}

async function messageFor(change: (config: Raw) => void): Promise<string> {
  return (await loadError({ config: withTimers(change) })).message
}

describe('timers', () => {
  it('is left out by default', async () => {
    const { config } = await load({ config: minimalConfig() })

    expect(config.timers).toBeUndefined()
  })

  it('polls every 30 seconds and keeps a finished timer for 60 unless told otherwise', async () => {
    const { config } = await load({ config: withTimers() })

    expect(config.timers).toEqual({
      entities: [{ entity_id: 'sensor.kitchen_speaker_timers' }],
      poll_seconds: 30,
      done_seconds: 60,
    })
  })

  it('takes several entities, each for some displays or all', async () => {
    const { config } = await load({ config: withTimers((c) => {
      c.displays.push({ id: 'kitchen', name: 'Kitchen' })
      c.timers = {
        entities: [{ entity_id: 'sensor.kitchen_speaker_timers', displays: ['kitchen'] }, { entity_id: 'timer.pasta' }],
        poll_seconds: 5,
        done_seconds: 0,
      }
    }) })

    expect(config.timers?.entities).toEqual([{ entity_id: 'sensor.kitchen_speaker_timers', displays: ['kitchen'] }, { entity_id: 'timer.pasta' }])
    expect(config.timers?.poll_seconds).toBe(5)
    expect(config.timers?.done_seconds).toBe(0)
  })

  it('needs the homeassistant block', async () => {
    const config = withTimers()
    delete config.homeassistant
    const message = (await loadError({ config })).message

    expect(message).toContain('timers: reads Home Assistant timer entities')
    expect(message).toContain('"homeassistant" block')
  })

  it('needs at least one entity', async () => {
    expect(await messageFor((c) => { c.timers = { entities: [] } })).toContain('timers.entities: must list at least one entity')
  })

  it('refuses an unknown display', async () => {
    const message = await messageFor((c) => { c.timers.entities[0].displays = ['garage'] })

    expect(message).toContain('timers.entities[0].displays[0]: unknown display "garage"')
  })

  it('refuses a duplicate entity', async () => {
    const message = await messageFor((c) => { c.timers.entities.push({ entity_id: 'sensor.kitchen_speaker_timers' }) })

    expect(message).toContain('timers.entities[1].entity_id: duplicate entity "sensor.kitchen_speaker_timers"')
  })

  it.each(['timers', 'sensor.', '.timers', 'sensor.kitchen timers', 'Sensor.Timers'])('refuses the entity id %j', async (entityId) => {
    const message = await messageFor((c) => { c.timers.entities[0].entity_id = entityId })

    expect(message).toContain('must be an entity id like')
  })

  it.each([
    ['poll_seconds', 4],
    ['done_seconds', -1],
    ['done_seconds', 601],
    ['poll_seconds', 30.5],
  ])('refuses %s of %j', async (key, value) => {
    const message = await messageFor((c) => { c.timers[key] = value })

    expect(message).toContain(`timers.${key}`)
  })
})
