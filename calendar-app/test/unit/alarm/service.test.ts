import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextAlarm } from '../../../shared/display'
import { AlarmError } from '../../../server/alarm/errors'
import { createAlarmService } from '../../../server/alarm/service'

// The service under fake timers, with a stub for the fetch and for the log: no network.

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const INTERVAL = 5 * MINUTE
const START = new Date('2026-10-30T22:00:00Z')
const SIX_FORTY_FIVE = '2026-10-31T06:45:00.000Z'
const SEVEN = '2026-10-31T07:00:00.000Z'

/** A promise settled from outside, for a fetch that is still in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function setup(loadImpl: () => Promise<NextAlarm> = () => Promise.resolve(SIX_FORTY_FIVE), random = () => 0.5) {
  const load = vi.fn(loadImpl)
  const onChange = vi.fn<(alarm: NextAlarm) => void>()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const service = createAlarmService({ load, intervalMs: INTERVAL, onChange, random, log })
  const logged = () => JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls])
  return { service, load, onChange, log, logged }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('polling', () => {
  it('makes the first poll after a jitter of up to 10 seconds, and nothing before start()', async () => {
    const { service, load } = setup(undefined, () => 0.25)

    await vi.advanceTimersByTimeAsync(HOUR)
    expect(load).not.toHaveBeenCalled()

    service.start()
    await vi.advanceTimersByTimeAsync(2499)
    expect(load).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('polls again every interval', async () => {
    const { service, load } = setup(undefined, () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3 * INTERVAL)
    expect(load).toHaveBeenCalledTimes(5)
  })

  it('starts only once', async () => {
    const { service, load } = setup(undefined, () => 0)

    service.start()
    service.start()
    await vi.advanceTimersByTimeAsync(INTERVAL - 1)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('has no alarm until the first poll succeeds', async () => {
    const { service } = setup(undefined, () => 0)
    expect(service.get()).toBeNull()
    expect(service.status()).toEqual({ last_success_at: null, last_error: null })

    service.start()
    await vi.advanceTimersByTimeAsync(1)

    expect(service.get()).toBe(SIX_FORTY_FIVE)
    expect(service.status()).toEqual({ last_success_at: START.toISOString(), last_error: null })
  })

  it('updates last_success_at on every success, even when nothing changed', async () => {
    const { service } = setup(undefined, () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(service.status().last_success_at).toBe(new Date(START.getTime() + INTERVAL).toISOString())
  })
})

describe('failures', () => {
  const FAILURE = new AlarmError('fetch', 'HTTP 500 Internal Server Error')

  it('keeps the last good alarm, and says why it has not been updated', async () => {
    let fail = false
    const { service } = setup(() => fail ? Promise.reject(FAILURE) : Promise.resolve(SIX_FORTY_FIVE), () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)

    fail = true
    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(service.get()).toBe(SIX_FORTY_FIVE)
    expect(service.status()).toEqual({ last_success_at: START.toISOString(), last_error: 'HTTP 500 Internal Server Error' })
  })

  it('backs off: twice the interval, then four times, up to an hour', async () => {
    const { service, load } = setup(() => Promise.reject(FAILURE), () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)

    // After the first failure: 2 x the interval.
    await vi.advanceTimersByTimeAsync(2 * INTERVAL - 1)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    // After the second: 4 x.
    await vi.advanceTimersByTimeAsync(4 * INTERVAL - 1)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(3)
    // After the third: 8 x would be 40 minutes, then 16 x would pass the hour.
    await vi.advanceTimersByTimeAsync(8 * INTERVAL - 1)
    expect(load).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(HOUR - 1)
    expect(load).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(5)
  })

  it('goes back to the normal interval after a success', async () => {
    let fail = true
    const { service, load, log } = setup(() => fail ? Promise.reject(FAILURE) : Promise.resolve(SIX_FORTY_FIVE), () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    fail = false
    await vi.advanceTimersByTimeAsync(2 * INTERVAL)
    expect(load).toHaveBeenCalledTimes(2)
    expect(service.status().last_error).toBeNull()
    expect(log.info).toHaveBeenCalledWith('[alarm] working again after 1 failed attempt')

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('logs a failure once, not at every poll, and again when the reason changes', async () => {
    const errors = [FAILURE, FAILURE, FAILURE, new AlarmError('fetch', 'could not connect (ECONNREFUSED)')]
    const { service, log } = setup(() => Promise.reject(errors.shift() ?? FAILURE), () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(10 * HOUR)

    expect(log.warn.mock.calls.map(([line]) => line)).toEqual([
      '[alarm] HTTP 500 Internal Server Error; the last good alarm is kept, trying again in 600 s',
      '[alarm] could not connect (ECONNREFUSED); the last good alarm is kept, trying again in 3600 s',
      '[alarm] HTTP 500 Internal Server Error; the last good alarm is kept, trying again in 3600 s',
    ])
  })

  it('reports an error that is not ours by name only', async () => {
    const { service, logged } = setup(() => Promise.reject(new TypeError('failed to fetch https://ha.example.com/secret-token')), () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(1)

    expect(service.status().last_error).toBe('unexpected error (TypeError)')
    expect(logged()).not.toContain('ha.example.com')
    expect(logged()).not.toContain('secret-token')
  })
})

describe('onChange', () => {
  it('is called with the first alarm', async () => {
    const { service, onChange } = setup(undefined, () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(1)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(SIX_FORTY_FIVE)
  })

  it('is called with the first answer even when there is no alarm, so a display hears it', async () => {
    const { service, onChange } = setup(() => Promise.resolve(null), () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(3 * INTERVAL)

    expect(onChange.mock.calls).toEqual([[null]])
  })

  it('is not called again while the alarm is the same', async () => {
    const { service, onChange } = setup(undefined, () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(5 * INTERVAL)

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('is called when the alarm moves, is set, or is cleared', async () => {
    const answers: NextAlarm[] = [null, SIX_FORTY_FIVE, SIX_FORTY_FIVE, SEVEN, null, null]
    const { service, onChange } = setup(() => Promise.resolve(answers.shift() ?? null), () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(5 * INTERVAL)

    expect(onChange.mock.calls).toEqual([[null], [SIX_FORTY_FIVE], [SEVEN], [null]])
    expect(service.get()).toBeNull()
  })

  it('is not called for a failed poll, and the answer after a failure is compared with the last one', async () => {
    let step = 0
    const { service, onChange } = setup(() => ++step === 2 ? Promise.reject(new AlarmError('fetch', 'timed out after 30 s')) : Promise.resolve(SIX_FORTY_FIVE), () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2 * INTERVAL + INTERVAL)

    expect(step).toBe(3)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not stop the polling if it throws, and says so', async () => {
    const { service, load, onChange, log } = setup(undefined, () => 0)
    onChange.mockImplementation(() => { throw new Error('socket exploded') })
    service.start()

    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(load).toHaveBeenCalledTimes(2)
    expect(log.error).toHaveBeenCalledWith('[alarm] telling the app about the change failed: socket exploded')
  })
})

describe('refresh', () => {
  it('polls now, and the next poll is an interval after that', async () => {
    const { service, load } = setup(undefined, () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(2 * MINUTE)

    await service.refresh()
    expect(load).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('shares a poll that is in flight', async () => {
    const pending = deferred<NextAlarm>()
    const { service, load } = setup(() => pending.promise, () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)

    const first = service.refresh()
    const second = service.refresh()
    pending.resolve(SIX_FORTY_FIVE)
    await Promise.all([first, second])

    expect(load).toHaveBeenCalledTimes(1)
    expect(service.get()).toBe(SIX_FORTY_FIVE)
  })

  it('never rejects', async () => {
    const { service } = setup(() => Promise.reject(new AlarmError('fetch', 'HTTP 500 Internal Server Error')), () => 0)

    await expect(service.refresh()).resolves.toBeUndefined()
    expect(service.status().last_error).toBe('HTTP 500 Internal Server Error')
  })

  it('fetches once before start(), and leaves the timing to start()', async () => {
    const { service, load } = setup(undefined, () => 0)

    await service.refresh()
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(load).toHaveBeenCalledTimes(1)

    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does nothing once stopped', async () => {
    const { service, load } = setup(undefined, () => 0)
    service.stop()

    await service.refresh()

    expect(load).not.toHaveBeenCalled()
  })
})

describe('stop', () => {
  it('cancels the poll that is waiting', async () => {
    const { service, load } = setup(undefined, () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)

    service.stop()
    await vi.advanceTimersByTimeAsync(3 * HOUR)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('cancels a poll that has not run yet', async () => {
    const { service, load } = setup(undefined, () => 0.5)
    service.start()

    service.stop()
    await vi.advanceTimersByTimeAsync(HOUR)

    expect(load).not.toHaveBeenCalled()
  })

  it('ignores a poll that was in flight: no change, no get(), no log', async () => {
    const pending = deferred<NextAlarm>()
    const { service, onChange, log } = setup(() => pending.promise, () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)

    service.stop()
    pending.resolve(SIX_FORTY_FIVE)
    await vi.advanceTimersByTimeAsync(HOUR)

    expect(onChange).not.toHaveBeenCalled()
    expect(service.get()).toBeNull()
    expect(log.info).not.toHaveBeenCalled()
  })

  it('ignores a failure that arrives after it: nothing logged, no further poll', async () => {
    let fail!: (error: unknown) => void
    const { service, load, log } = setup(() => new Promise<NextAlarm>((_resolve, reject) => { fail = reject }), () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)

    service.stop()
    fail(new AlarmError('fetch', 'HTTP 500 Internal Server Error'))
    await vi.advanceTimersByTimeAsync(3 * HOUR)

    expect(load).toHaveBeenCalledTimes(1)
    expect(log.warn).not.toHaveBeenCalled()
    expect(service.status().last_error).toBeNull()
  })
})
