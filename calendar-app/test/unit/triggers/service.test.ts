import { describe, expect, it, vi } from 'vitest'
import type { TriggerConfig } from '../../../server/config/schema'
import { createTriggerRunner, haTriggerFor, subscriptionsFor } from '../../../server/triggers/service'

// What the config's triggers ask Home Assistant for, and what the wall does
// when one fires.

const DOORBELL: TriggerConfig = {
  id: 'doorbell',
  when: { kind: 'state', entity_ids: ['binary_sensor.front_doorbell'], from: null, to: ['on'] },
  displays: ['hallway'],
  actions: [
    { type: 'set_camera', camera: 'front-door', seconds: 60, wake: true },
    { type: 'set_overlay', overlay: { text: 'Someone is at the door', icon: 'bell', ttl: 60 } },
  ],
}

describe('haTriggerFor', () => {
  it('writes a state trigger with the states it names', () => {
    expect(haTriggerFor({ kind: 'state', entity_ids: ['binary_sensor.front_doorbell'], from: ['off'], to: ['on'] }))
      .toEqual({ platform: 'state', entity_id: ['binary_sensor.front_doorbell'], from: ['off'], to: ['on'] })
    expect(haTriggerFor({ kind: 'state', entity_ids: ['binary_sensor.a'], from: null, to: ['on'] }))
      .toEqual({ platform: 'state', entity_id: ['binary_sensor.a'], to: ['on'] })
  })

  it('makes a state trigger with no states fire on a real change, as an event entity needs', () => {
    expect(haTriggerFor({ kind: 'state', entity_ids: ['event.front_door_ding'], from: null, to: null }))
      .toEqual({ platform: 'state', entity_id: ['event.front_door_ding'], not_from: ['unavailable'], not_to: ['unavailable', 'unknown'] })
  })

  it('writes an event trigger, with its data when there is some', () => {
    expect(haTriggerFor({ kind: 'event', event_type: 'doorbell_pressed', event_data: null }))
      .toEqual({ platform: 'event', event_type: 'doorbell_pressed' })
    expect(haTriggerFor({ kind: 'event', event_type: 'doorbell_pressed', event_data: { door: 'front' } }))
      .toEqual({ platform: 'event', event_type: 'doorbell_pressed', event_data: { door: 'front' } })
  })

  it('gives each trigger its id to subscribe under', () => {
    expect(subscriptionsFor([DOORBELL])).toEqual([{ id: 'doorbell', trigger: { platform: 'state', entity_id: ['binary_sensor.front_doorbell'], to: ['on'] } }])
  })
})

describe('the trigger runner', () => {
  function setup(triggers: TriggerConfig[], applyCommand = vi.fn()) {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const runner = createTriggerRunner({ triggers, displays: ['hallway', 'kitchen'], control: { applyCommand }, log })
    return { runner, applyCommand, log }
  }

  it('applies the actions in order to the trigger\'s displays', () => {
    const { runner, applyCommand, log } = setup([DOORBELL])

    runner.fire('doorbell')

    expect(applyCommand.mock.calls).toEqual([['hallway', DOORBELL.actions[0]], ['hallway', DOORBELL.actions[1]]])
    expect(log.info).toHaveBeenCalledWith('[triggers] "doorbell" fired: set_camera, set_overlay on hallway')
  })

  it('acts on every display when the trigger names none', () => {
    const { runner, applyCommand } = setup([{ ...DOORBELL, displays: undefined }])

    runner.fire('doorbell')

    expect(applyCommand.mock.calls.map(call => call[0])).toEqual(['hallway', 'hallway', 'kitchen', 'kitchen'])
  })

  it('logs an action that is refused and carries on with the rest', () => {
    const applyCommand = vi.fn().mockImplementationOnce(() => { throw new Error('Unknown camera "front-door"') })
    const { runner, log } = setup([DOORBELL], applyCommand)

    runner.fire('doorbell')

    expect(applyCommand).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledWith('[triggers] "doorbell": set_camera on hallway failed: Unknown camera "front-door"')
  })

  it('does nothing for an id it does not know', () => {
    const { runner, applyCommand } = setup([DOORBELL])

    runner.fire('garage')

    expect(applyCommand).not.toHaveBeenCalled()
  })
})
