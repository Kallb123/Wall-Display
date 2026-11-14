import { describe, expect, it } from 'vitest'
import { parseTimedelta, parseTimerEntity } from '../../../server/timers/parse'

// Entity states as Home Assistant gives them, for a timer helper and for the
// ha-google-home integration's timers sensor.

const HELPER = 'timer.pasta'
const SPEAKER = 'sensor.kitchen_speaker_timers'

function helper(state: string, attributes: Record<string, unknown> = {}) {
  return {
    entity_id: HELPER,
    state,
    attributes: { duration: '0:10:00', editable: true, friendly_name: 'Pasta', ...attributes },
    last_changed: '2026-11-14T12:00:00+00:00',
  }
}

function speaker(timers: unknown, state = '2') {
  return {
    entity_id: SPEAKER,
    state,
    attributes: { timers, friendly_name: 'Kitchen speaker timers', icon: 'mdi:timer-sand' },
  }
}

/** One item as the integration writes it. */
function item(overrides: Record<string, unknown> = {}) {
  return {
    timer_id: 'timer/6a4b',
    fire_time: 1_794_000_000,
    local_time: '2026-11-14 12:20:00',
    local_time_iso: '2026-11-14T12:20:00+00:00',
    duration: '0:10:00',
    remaining: null,
    status: 'set',
    label: null,
    ...overrides,
  }
}

describe('parseTimedelta', () => {
  it.each([
    ['0:10:00', 600],
    ['1:02:03', 3723],
    ['1 day, 2:00:00', 93_600],
    ['3 days, 0:00:01', 259_201],
    ['0:00:05.250000', 5],
    ['12:00:00', 43_200],
    [' 0:01:00 ', 60],
  ])('reads %j as %d seconds', (value, seconds) => {
    expect(parseTimedelta(value)).toBe(seconds)
  })

  it.each(['', '10 minutes', '0:61:00', '-1 day, 23:59:00', '600', null, undefined, 600])('reads %j as nothing', (value) => {
    expect(parseTimedelta(value)).toBeNull()
  })
})

describe('a timer helper', () => {
  it('is running while active, ending at finishes_at', () => {
    const parsed = parseTimerEntity(HELPER, helper('active', { finishes_at: '2026-11-14T12:10:00+00:00', remaining: '0:10:00' }))

    expect(parsed.shape).toBe('helper')
    expect(parsed.timers).toEqual([{
      id: 'timer.pasta',
      label: 'Pasta',
      status: 'running',
      ends_at: '2026-11-14T12:10:00.000Z',
      remaining_seconds: null,
      duration_seconds: 600,
    }])
  })

  it('is paused with its remaining time', () => {
    const { timers } = parseTimerEntity(HELPER, helper('paused', { remaining: '0:04:12' }))

    expect(timers).toEqual([{
      id: 'timer.pasta',
      label: 'Pasta',
      status: 'paused',
      ends_at: null,
      remaining_seconds: 252,
      duration_seconds: 600,
    }])
  })

  it('is no timer when idle', () => {
    expect(parseTimerEntity(HELPER, helper('idle')).timers).toEqual([])
  })

  it('reads a duration with days, and takes no label from a missing name', () => {
    const state = helper('active', { duration: '1 day, 2:00:00', finishes_at: '2026-11-15T14:00:00+02:00', friendly_name: undefined })
    const { timers } = parseTimerEntity(HELPER, state)

    expect(timers[0]).toMatchObject({ label: null, duration_seconds: 93_600, ends_at: '2026-11-15T12:00:00.000Z' })
  })

  it.each([
    ['active without finishes_at', helper('active')],
    ['active with a finishes_at that is not a time', helper('active', { finishes_at: 'soon' })],
    ['active with a finishes_at without an offset', helper('active', { finishes_at: '2026-11-14T12:10:00' })],
    ['paused without remaining', helper('paused')],
    ['paused with a remaining that is not a duration', helper('paused', { remaining: 'a while' })],
  ])('skips %s', (_name, state) => {
    expect(parseTimerEntity(HELPER, state).timers).toEqual([])
  })

  it('has no duration when it is missing or not a duration', () => {
    const { timers } = parseTimerEntity(HELPER, helper('active', { finishes_at: '2026-11-14T12:10:00+00:00', duration: 5 }))

    expect(timers[0]!.duration_seconds).toBeNull()
  })

  it('is no timer, and not a shape to complain about, when unavailable', () => {
    expect(parseTimerEntity(HELPER, helper('unavailable'))).toEqual({ timers: [], shape: 'helper' })
  })
})

describe('a speaker timers sensor', () => {
  it('reads a timer that is set, paused and ringing', () => {
    const { timers, shape } = parseTimerEntity(SPEAKER, speaker([
      item({ timer_id: 'timer/1', label: 'Eggs' }),
      item({ timer_id: 'timer/2', status: 'paused', fire_time: null, remaining: '0:03:30', duration: '0:05:00' }),
      item({ timer_id: 'timer/3', status: 'ringing', fire_time: 1_793_999_000, duration: '1:00:00' }),
    ]))

    expect(shape).toBe('speaker')
    expect(timers).toEqual([
      { id: 'sensor.kitchen_speaker_timers/timer/1', label: 'Eggs', status: 'running', ends_at: new Date(1_794_000_000 * 1000).toISOString(), remaining_seconds: null, duration_seconds: 600 },
      { id: 'sensor.kitchen_speaker_timers/timer/2', label: null, status: 'paused', ends_at: null, remaining_seconds: 210, duration_seconds: 300 },
      { id: 'sensor.kitchen_speaker_timers/timer/3', label: null, status: 'ringing', ends_at: new Date(1_793_999_000 * 1000).toISOString(), remaining_seconds: null, duration_seconds: 3600 },
    ])
  })

  it('turns an empty label into none, and a duration with days into seconds', () => {
    const { timers } = parseTimerEntity(SPEAKER, speaker([item({ label: '', duration: '1 day, 2:00:00' })]))

    expect(timers[0]).toMatchObject({ label: null, duration_seconds: 93_600 })
  })

  it('keeps a ringing timer that has no time', () => {
    const { timers } = parseTimerEntity(SPEAKER, speaker([item({ status: 'ringing', fire_time: null })]))

    expect(timers).toMatchObject([{ status: 'ringing', ends_at: null }])
  })

  it('skips the statuses that are not timers', () => {
    const { timers } = parseTimerEntity(SPEAKER, speaker([item({ status: 'none' }), item({ status: 'unknown' }), item({ status: 'exploded' }), item({ status: undefined })]))

    expect(timers).toEqual([])
  })

  it('skips a set timer with no time and a paused one with no remaining time', () => {
    const { timers } = parseTimerEntity(SPEAKER, speaker([item({ fire_time: null }), item({ status: 'paused', fire_time: null, remaining: null })]))

    expect(timers).toEqual([])
  })

  it('skips malformed items one by one and keeps the good ones', () => {
    const { timers } = parseTimerEntity(SPEAKER, speaker([
      null,
      'timer',
      7,
      [],
      { status: 'set', fire_time: 1_794_000_000 },
      item({ timer_id: '' }),
      item({ timer_id: 'timer/ok', fire_time: 'tomorrow' }),
      item({ timer_id: 'timer/good', label: 'Tea', duration: 'ten minutes', remaining: 7 }),
      item({ timer_id: 42 }),
    ]))

    expect(timers.map(timer => timer.id)).toEqual(['sensor.kitchen_speaker_timers/timer/good', 'sensor.kitchen_speaker_timers/42'])
    expect(timers[0]).toMatchObject({ label: 'Tea', duration_seconds: null })
  })

  it('is no timers for an empty list', () => {
    expect(parseTimerEntity(SPEAKER, speaker([], '0'))).toEqual({ timers: [], shape: 'speaker' })
  })

  it('reads any entity with a timers list, whatever its id', () => {
    const { timers, shape } = parseTimerEntity('sensor.some_fork', speaker([item()]))

    expect(shape).toBe('speaker')
    expect(timers[0]!.id).toBe('sensor.some_fork/timer/6a4b')
  })
})

describe('anything else', () => {
  it.each(['unavailable', 'unknown'])('is no timers when the state is %s', (state) => {
    expect(parseTimerEntity(SPEAKER, { entity_id: SPEAKER, state, attributes: {} })).toEqual({ timers: [], shape: 'unavailable' })
  })

  it.each([
    ['an entity with neither shape', { state: '3', attributes: { friendly_name: 'Something' } }],
    ['a timers attribute that is not a list', { state: '3', attributes: { timers: 'none' } }],
    ['something that is not an object', 'on'],
    ['null', null],
  ])('is no timers, and the odd shape, for %s', (_name, state) => {
    expect(parseTimerEntity(SPEAKER, state)).toEqual({ timers: [], shape: 'unknown' })
  })
})
