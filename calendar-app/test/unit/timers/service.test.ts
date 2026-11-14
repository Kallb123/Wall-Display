import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WallTimer } from '../../../shared/display'
import { TimersError } from '../../../server/timers/errors'
import { createTimersService } from '../../../server/timers/service'
import type { TimersServiceOptions } from '../../../server/timers/service'

// The service under fake timers, with a stub for the fetch and for the log: no network.

const SECOND = 1000
const MINUTE = 60 * SECOND
const INTERVAL = 30 * SECOND
const DONE = 60 * SECOND
const START = new Date('2026-11-14T12:00:00Z')

const SPEAKER = 'sensor.kitchen_speaker_timers'
const PASTA = 'timer.pasta'
const KETTLE = 'timer.kettle'

/** An instant this long after the start, in epoch seconds. */
const at = (ms: number) => Math.floor((START.getTime() + ms) / 1000)
const iso = (ms: number) => new Date(START.getTime() + ms).toISOString()

/** A speaker's sensor with these items. */
function speaker(...items: Record<string, unknown>[]) {
  return { entity_id: SPEAKER, state: String(items.length), attributes: { timers: items } }
}

function item(id: string, status: string, endsInMs: number | null, extra: Record<string, unknown> = {}) {
  return { timer_id: id, status, fire_time: endsInMs === null ? null : at(endsInMs), duration: '0:10:00', remaining: null, label: null, ...extra }
}

function helper(state: string, attributes: Record<string, unknown> = {}) {
  return { entity_id: PASTA, state, attributes: { friendly_name: 'Pasta', duration: '0:10:00', ...attributes } }
}

function running(id: string, endsInMs: number, extra: Partial<WallTimer> = {}): WallTimer {
  return { id, label: null, status: 'running', ends_at: iso(endsInMs), remaining_seconds: null, duration_seconds: 600, ...extra }
}

type Answers = Record<string, unknown>

function setup(answers: Answers = {}, overrides: Partial<TimersServiceOptions> = {}) {
  const state: Answers = { ...answers }
  const load = vi.fn((entityId: string) => {
    const answer = state[entityId]
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? { entity_id: entityId, state: 'unavailable', attributes: {} })
  })
  const onChange = vi.fn<(displayId: string, timers: WallTimer[]) => void>()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const service = createTimersService({
    entities: [{ entity_id: SPEAKER }, { entity_id: PASTA }],
    displayIds: ['kitchen', 'hallway'],
    load,
    intervalMs: INTERVAL,
    doneMs: DONE,
    onChange,
    random: () => 0,
    log,
    ...overrides,
  })
  /** Changes what Home Assistant answers from now on. */
  const answer = (entityId: string, value: unknown) => { state[entityId] = value }
  const logged = () => JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls])
  return { service, load, onChange, log, logged, answer }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('polling', () => {
  it('polls every entity after a jitter of up to 10 seconds, and nothing before start()', async () => {
    const { service, load } = setup({}, { random: () => 0.25 })

    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(load).not.toHaveBeenCalled()

    service.start()
    await vi.advanceTimersByTimeAsync(2499)
    expect(load).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(load.mock.calls.map(call => call[0])).toEqual([SPEAKER, PASTA])
  })

  it('polls again every interval', async () => {
    const { service, load } = setup()
    service.start()

    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('starts only once, and stop() ends the polling', async () => {
    const { service, load } = setup()
    service.start()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)

    service.stop()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shows what the entities say, for every display', async () => {
    const { service, onChange } = setup({ [SPEAKER]: speaker(item('a', 'set', 5 * MINUTE, { label: 'Eggs' })) })
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    const expected = [running(`${SPEAKER}/a`, 5 * MINUTE, { label: 'Eggs' })]
    expect(service.get('kitchen')).toEqual(expected)
    expect(service.get('hallway')).toEqual(expected)
    expect(onChange).toHaveBeenCalledWith('kitchen', expected)
    expect(onChange).toHaveBeenCalledWith('hallway', expected)
  })
})

describe('failures', () => {
  it('keeps the last good timers, backs off, and says so once', async () => {
    const { service, load, answer, log, logged } = setup({ [SPEAKER]: speaker(item('a', 'set', 5 * MINUTE)) })
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    const kept = service.get('kitchen')

    answer(SPEAKER, new TimersError('fetch', 'HTTP 502 Bad Gateway'))
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(service.get('kitchen')).toEqual(kept)
    expect(service.status().last_error).toBe('HTTP 502 Bad Gateway')

    // The next try is after twice the interval, then four times.
    const calls = () => load.mock.calls.filter(call => call[0] === SPEAKER).length
    const before = calls()
    await vi.advanceTimersByTimeAsync(2 * INTERVAL - 1)
    expect(calls()).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls()).toBe(before + 1)
    await vi.advanceTimersByTimeAsync(4 * INTERVAL)
    expect(calls()).toBe(before + 2)

    const warnings = log.warn.mock.calls.map(call => call[0] as string)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(`${SPEAKER}: HTTP 502 Bad Gateway; the last good timers are kept, trying again in 60 s`)

    answer(SPEAKER, speaker())
    await vi.advanceTimersByTimeAsync(8 * INTERVAL)
    expect(service.get('kitchen')).toEqual([])
    expect(service.status().last_error).toBeNull()
    expect(logged()).toContain('working again after 3 failed attempts')
  })

  it('does not let one entity that fails hold up the others', async () => {
    const { service, load, answer } = setup({ [SPEAKER]: new TimersError('fetch', 'HTTP 404 Not Found') })
    answer(PASTA, helper('active', { finishes_at: iso(5 * MINUTE) }))
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(service.get('kitchen').map(timer => timer.id)).toEqual([PASTA])
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(load.mock.calls.filter(call => call[0] === PASTA).length).toBeGreaterThan(load.mock.calls.filter(call => call[0] === SPEAKER).length)
    expect(service.status().entities).toEqual([
      { entity_id: SPEAKER, last_success_at: null, last_error: 'HTTP 404 Not Found' },
      expect.objectContaining({ entity_id: PASTA, last_error: null }),
    ])
  })

  it('shows an unexpected error by its name only', async () => {
    const { service, logged } = setup({ [SPEAKER]: new TypeError('connect to http://ha.local:8123 with secret') })
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(service.status().last_error).toBe('unexpected error (TypeError)')
    expect(logged()).not.toContain('ha.local')
  })

  it('tells the app nothing after stop()', async () => {
    let finish!: (value: unknown) => void
    const { service, onChange } = setup({}, { load: () => new Promise((resolve) => { finish = resolve }) })
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    service.stop()
    finish(speaker(item('a', 'set', MINUTE)))
    await vi.advanceTimersByTimeAsync(0)

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('refresh', () => {
  it('polls every entity now, and waits for one already in flight rather than asking again', async () => {
    const { service, load } = setup()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)

    await service.refresh()
    expect(load).toHaveBeenCalledTimes(4)

    const first = service.refresh()
    const second = service.refresh()
    await Promise.all([first, second])
    expect(load).toHaveBeenCalledTimes(6)
  })

  it('does nothing after stop()', async () => {
    const { service, load } = setup()
    service.stop()
    await service.refresh()

    expect(load).not.toHaveBeenCalled()
  })
})

describe('change-only emits', () => {
  it('tells each display once after the first poll, even with no timers, and then only about changes', async () => {
    const { service, onChange, answer } = setup()
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onChange.mock.calls).toEqual([['kitchen', []], ['hallway', []]])

    await vi.advanceTimersByTimeAsync(5 * INTERVAL)
    expect(onChange).toHaveBeenCalledTimes(2)

    answer(SPEAKER, speaker(item('a', 'set', 5 * MINUTE)))
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(onChange).toHaveBeenCalledTimes(4)

    // The same answer again is no change.
    await vi.advanceTimersByTimeAsync(3 * INTERVAL)
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  it('says nothing before anything has been read', async () => {
    const { service, onChange } = setup({ [SPEAKER]: new TimersError('fetch', 'HTTP 500') , [PASTA]: new TimersError('fetch', 'HTTP 500') })
    service.start()
    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('tells only the displays whose timers changed', async () => {
    const { service, onChange } = setup({}, { entities: [{ entity_id: SPEAKER, displays: ['kitchen'] }, { entity_id: PASTA, displays: ['hallway'] }] })
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    onChange.mockClear()

    service.push(SPEAKER, speaker(item('a', 'set', 5 * MINUTE)))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toBe('kitchen')
  })

  it('catches an onChange that throws, and goes on', async () => {
    const { service, log } = setup({}, { onChange: () => { throw new Error('boom') } })
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(log.error).toHaveBeenCalledWith('[timers] telling the app about the change failed: boom')
    expect(service.status().last_error).toBeNull()
  })
})

describe('per-display filtering and order', () => {
  it('gives a display the entities that list it, and every display those that list none', async () => {
    const { service } = setup(
      {
        [SPEAKER]: speaker(item('a', 'set', 5 * MINUTE)),
        [PASTA]: helper('active', { finishes_at: iso(3 * MINUTE) }),
        [KETTLE]: { entity_id: KETTLE, state: 'active', attributes: { finishes_at: iso(4 * MINUTE) } },
      },
      { entities: [{ entity_id: SPEAKER, displays: ['kitchen'] }, { entity_id: PASTA, displays: ['hallway'] }, { entity_id: KETTLE }] },
    )
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(service.get('kitchen').map(timer => timer.id)).toEqual([KETTLE, `${SPEAKER}/a`])
    expect(service.get('hallway').map(timer => timer.id)).toEqual([PASTA, KETTLE])
    expect(service.get('garage')).toEqual([])
  })

  it('puts ringing first, then done, then running by end, then paused by time left', async () => {
    const { service, push } = (() => {
      const made = setup({}, { entities: [{ entity_id: SPEAKER }, { entity_id: PASTA }, { entity_id: KETTLE }] })
      return { service: made.service, push: made.service.push }
    })()
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    // A timer that is about to end, which is done once it has gone.
    push(KETTLE, { entity_id: KETTLE, state: 'active', attributes: { finishes_at: iso(MINUTE) } })
    vi.setSystemTime(START.getTime() + MINUTE)
    push(KETTLE, { entity_id: KETTLE, state: 'idle', attributes: {} })

    push(SPEAKER, speaker(
      item('paused-long', 'paused', null, { remaining: '0:09:00' }),
      item('later', 'set', 20 * MINUTE),
      item('paused-short', 'paused', null, { remaining: '0:01:00' }),
      item('soon', 'set', 5 * MINUTE),
      item('ringing', 'ringing', -MINUTE),
    ))

    expect(service.get('kitchen').map(timer => timer.id.replace(`${SPEAKER}/`, ''))).toEqual(['ringing', KETTLE, 'soon', 'later', 'paused-short', 'paused-long'])
  })
})

describe('push', () => {
  it('applies a state at once, and one with none removes the timers', async () => {
    const { service, onChange } = setup()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    onChange.mockClear()

    service.push(PASTA, helper('active', { finishes_at: iso(5 * MINUTE) }))
    expect(service.get('kitchen').map(timer => timer.id)).toEqual([PASTA])
    expect(onChange).toHaveBeenCalledTimes(2)

    service.push(PASTA, null)
    expect(service.get('kitchen')).toEqual([])
  })

  it('ignores entities that are not ours, and everything after stop()', async () => {
    const { service, onChange } = setup()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    onChange.mockClear()

    service.push('timer.other', { entity_id: 'timer.other', state: 'active', attributes: { finishes_at: iso(MINUTE) } })
    service.stop()
    service.push(PASTA, helper('active', { finishes_at: iso(5 * MINUTE) }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('is not undone by a poll that was already in flight', async () => {
    let finish!: (value: unknown) => void
    const { service } = setup({}, { load: () => new Promise((resolve) => { finish = resolve }), entities: [{ entity_id: PASTA }] })
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    service.push(PASTA, helper('active', { finishes_at: iso(5 * MINUTE) }))
    finish(helper('idle'))
    await vi.advanceTimersByTimeAsync(0)

    expect(service.get('kitchen').map(timer => timer.id)).toEqual([PASTA])
  })

  it('shows a timer on a first push even before the first poll has come back', async () => {
    const { service, onChange } = setup()

    service.push(SPEAKER, speaker(item('a', 'set', 5 * MINUTE)))

    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe('done', () => {
  /** A speaker with one timer that ends in a minute, polled once. */
  async function withTimer(overrides: Partial<TimersServiceOptions> = {}) {
    const made = setup({}, { entities: [{ entity_id: SPEAKER }], ...overrides })
    made.service.start()
    await vi.advanceTimersByTimeAsync(0)
    made.service.push(SPEAKER, speaker(item('a', 'set', MINUTE)))
    made.onChange.mockClear()
    return made
  }
  const ID = `${SPEAKER}/a`

  it('keeps a running timer that disappears at its end as done, until done_seconds after, then drops it', async () => {
    const { service, onChange } = await withTimer()
    vi.setSystemTime(START.getTime() + MINUTE + 2 * SECOND)

    service.push(SPEAKER, speaker())
    expect(service.get('kitchen')).toEqual([running(ID, MINUTE, { status: 'done', remaining_seconds: null })])
    expect(onChange).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(DONE - 2 * SECOND - 1)
    expect(service.get('kitchen')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(service.get('kitchen')).toEqual([])
    expect(onChange).toHaveBeenCalledWith('kitchen', [])
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  it('counts a timer that disappears up to 3 seconds early as having ended', async () => {
    const { service } = await withTimer()
    vi.setSystemTime(START.getTime() + MINUTE - 3 * SECOND)

    service.push(SPEAKER, speaker())

    expect(service.get('kitchen').map(timer => timer.status)).toEqual(['done'])
  })

  it('drops a timer that disappears earlier at once, as cancelled', async () => {
    const { service } = await withTimer()
    vi.setSystemTime(START.getTime() + MINUTE - 3 * SECOND - 1)

    service.push(SPEAKER, speaker())

    expect(service.get('kitchen')).toEqual([])
  })

  it('drops a ringing timer that disappears at once, as dismissed', async () => {
    const { service } = await withTimer()
    service.push(SPEAKER, speaker(item('a', 'ringing', MINUTE)))
    vi.setSystemTime(START.getTime() + MINUTE + 5 * SECOND)
    expect(service.get('kitchen').map(timer => timer.status)).toEqual(['ringing'])

    service.push(SPEAKER, speaker())

    expect(service.get('kitchen')).toEqual([])
  })

  it('does not keep a timer that ended longer ago than done_seconds', async () => {
    const { service } = await withTimer()
    vi.setSystemTime(START.getTime() + MINUTE + DONE)

    service.push(SPEAKER, speaker())

    expect(service.get('kitchen')).toEqual([])
  })

  it('keeps nothing when done_seconds is 0', async () => {
    const { service } = await withTimer({ doneMs: 0 })
    vi.setSystemTime(START.getTime() + MINUTE + SECOND)

    service.push(SPEAKER, speaker())

    expect(service.get('kitchen')).toEqual([])
  })

  it('holds a helper that goes idle at its end, found by a poll', async () => {
    const { service, answer } = setup({ [PASTA]: helper('active', { finishes_at: iso(10 * SECOND) }) }, { entities: [{ entity_id: PASTA }] })
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.get('kitchen').map(timer => timer.status)).toEqual(['running'])

    // The helper finished, and the next poll (a few seconds late) finds it idle.
    answer(PASTA, helper('idle'))
    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(service.get('kitchen')).toMatchObject([{ id: PASTA, status: 'done', ends_at: iso(10 * SECOND), remaining_seconds: null }])
    await vi.advanceTimersByTimeAsync(DONE)
    expect(service.get('kitchen')).toEqual([])
  })

  it('drops a done timer when the same one starts again', async () => {
    const { service, answer } = await withTimer()
    vi.setSystemTime(START.getTime() + MINUTE + SECOND)
    service.push(SPEAKER, speaker())
    expect(service.get('kitchen').map(timer => timer.status)).toEqual(['done'])

    // Polls from here on say the same as the push.
    answer(SPEAKER, speaker(item('a', 'set', 10 * MINUTE)))
    service.push(SPEAKER, speaker(item('a', 'set', 10 * MINUTE)))

    expect(service.get('kitchen').map(timer => timer.status)).toEqual(['running'])
    await vi.advanceTimersByTimeAsync(2 * DONE)
    expect(service.get('kitchen').map(timer => timer.status)).toEqual(['running'])
  })

  it('shows a done timer only on the displays of its entity', async () => {
    const { service } = await withTimer({ entities: [{ entity_id: SPEAKER, displays: ['kitchen'] }] })
    vi.setSystemTime(START.getTime() + MINUTE + SECOND)

    service.push(SPEAKER, speaker())

    expect(service.get('kitchen')).toHaveLength(1)
    expect(service.get('hallway')).toEqual([])
  })

  it('keeps nothing from a failed poll as done', async () => {
    const { service, answer } = await withTimer()
    vi.setSystemTime(START.getTime() + MINUTE + SECOND)
    answer(SPEAKER, new TimersError('fetch', 'HTTP 500'))
    await vi.advanceTimersByTimeAsync(INTERVAL)

    // The last good answer still says running: the failure is not a disappearance.
    expect(service.get('kitchen').map(timer => timer.status)).toEqual(['running'])
  })

  it('stops the removal when the service stops', async () => {
    const { service, onChange } = await withTimer()
    vi.setSystemTime(START.getTime() + MINUTE + SECOND)
    service.push(SPEAKER, speaker())
    onChange.mockClear()

    service.stop()
    await vi.advanceTimersByTimeAsync(2 * DONE)

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('entities of an odd shape', () => {
  it('says so once, and shows no timers', async () => {
    const { service, log } = setup({ [SPEAKER]: { entity_id: SPEAKER, state: '3', attributes: {} } }, { entities: [{ entity_id: SPEAKER }] })
    service.start()
    await vi.advanceTimersByTimeAsync(5 * INTERVAL)

    expect(service.get('kitchen')).toEqual([])
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toContain(SPEAKER)
  })
})
