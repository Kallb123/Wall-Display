import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeatherSnapshot } from '../../../shared/weather'
import { WeatherError } from '../../../server/weather/errors'
import { createWeatherService, REEMIT_AFTER_MS } from '../../../server/weather/service'

// The service under fake timers, with a stub for the fetch and for the log:
// no network. Each snapshot is stamped with the fake clock, as the real load is.

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const INTERVAL = 10 * MINUTE
const START = new Date('2026-10-28T12:00:00Z')

function snapshot(overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return {
    current: { condition: 'rainy', temperature: 12 },
    daily: [{ date: '2026-10-28', condition: 'rainy', high: 14, low: 8 }],
    temperature_unit: '°C',
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

/** A promise settled from outside, for a fetch that is still in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function setup(loadImpl: () => Promise<WeatherSnapshot> = () => Promise.resolve(snapshot()), random = () => 0.5) {
  const load = vi.fn(loadImpl)
  const onChange = vi.fn<(weather: WeatherSnapshot) => void>()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const service = createWeatherService({ load, intervalMs: INTERVAL, onChange, random, log })
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

  it('keeps the jitter inside the interval, for an interval shorter than 10 seconds', async () => {
    const load = vi.fn(() => Promise.resolve(snapshot()))
    const service = createWeatherService({ load, intervalMs: 4000, onChange: vi.fn(), random: () => 0.999, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })

    service.start()
    await vi.advanceTimersByTimeAsync(4000)

    expect(load).toHaveBeenCalledTimes(1)
    service.stop()
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

  it('has no weather until the first poll succeeds', async () => {
    const { service } = setup(undefined, () => 0)
    expect(service.get()).toBeNull()
    expect(service.status()).toEqual({ last_success_at: null, last_error: null })

    service.start()
    await vi.advanceTimersByTimeAsync(1)

    expect(service.get()).toEqual(snapshot({ updated_at: START.toISOString() }))
    expect(service.status()).toEqual({ last_success_at: START.toISOString(), last_error: null })
  })

  it('updates the cached snapshot on every success, even when nothing changed', async () => {
    const { service } = setup(undefined, () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(service.get()!.updated_at).toBe(new Date(START.getTime() + INTERVAL).toISOString())
  })
})

describe('failures', () => {
  const FAILURE = new WeatherError('fetch', 'HTTP 500 Internal Server Error')

  it('keeps the last good snapshot, and says why it has not been updated', async () => {
    let fail = false
    const { service } = setup(() => fail ? Promise.reject(FAILURE) : Promise.resolve(snapshot()), () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)
    const good = service.get()

    fail = true
    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(service.get()).toEqual(good)
    expect(service.status()).toEqual({ last_success_at: good!.updated_at, last_error: 'HTTP 500 Internal Server Error' })
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
    // After the third: 8 x would be 80 minutes, so an hour.
    await vi.advanceTimersByTimeAsync(HOUR - 1)
    expect(load).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('goes back to the normal interval after a success', async () => {
    let fail = true
    const { service, load, log } = setup(() => fail ? Promise.reject(FAILURE) : Promise.resolve(snapshot()), () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    fail = false
    await vi.advanceTimersByTimeAsync(2 * INTERVAL)
    expect(load).toHaveBeenCalledTimes(2)
    expect(service.status().last_error).toBeNull()
    expect(log.info).toHaveBeenCalledWith('[weather] working again after 1 failed attempt')

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('logs a failure once, not at every poll, and again when the reason changes', async () => {
    const errors = [FAILURE, FAILURE, FAILURE, new WeatherError('fetch', 'could not connect (ECONNREFUSED)')]
    const { service, log } = setup(() => Promise.reject(errors.shift() ?? FAILURE), () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(10 * HOUR)

    expect(log.warn.mock.calls.map(([line]) => line)).toEqual([
      '[weather] HTTP 500 Internal Server Error; the last good weather is kept, trying again in 1200 s',
      '[weather] could not connect (ECONNREFUSED); the last good weather is kept, trying again in 3600 s',
      '[weather] HTTP 500 Internal Server Error; the last good weather is kept, trying again in 3600 s',
    ])
  })

  it('logs a failure again after a success in between', async () => {
    let fail = true
    const { service, log } = setup(() => fail ? Promise.reject(FAILURE) : Promise.resolve(snapshot()), () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    fail = false
    await vi.advanceTimersByTimeAsync(2 * INTERVAL)
    fail = true
    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(log.warn).toHaveBeenCalledTimes(2)
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
  it('is called with the first snapshot', async () => {
    const { service, onChange } = setup(undefined, () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(1)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(snapshot({ updated_at: START.toISOString() }))
  })

  it('is not called again while only updated_at differs', async () => {
    const { service, onChange } = setup(undefined, () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(5 * INTERVAL)

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the current condition', { current: { condition: 'sunny', temperature: 12 } }],
    ['the current temperature', { current: { condition: 'rainy', temperature: 13 } }],
    ['a forecast high', { daily: [{ date: '2026-10-28', condition: 'rainy', high: 15, low: 8 }] }],
    ['a forecast condition', { daily: [{ date: '2026-10-28', condition: 'sunny', high: 14, low: 8 }] }],
    ['a new day', { daily: [{ date: '2026-10-28', condition: 'rainy', high: 14, low: 8 }, { date: '2026-10-29', condition: null, high: null, low: null }] }],
    ['the unit', { temperature_unit: '°F' }],
  ])('is called when %s changes', async (_name, change) => {
    let next: Partial<WeatherSnapshot> = {}
    const { service, onChange } = setup(() => Promise.resolve(snapshot(next)), () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)

    next = change
    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining(change))
  })

  it('is called again once the displays\' copy is an hour old, though nothing changed', async () => {
    expect(REEMIT_AFTER_MS).toBe(HOUR)
    const { service, onChange } = setup(undefined, () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(HOUR - 1)
    expect(onChange).toHaveBeenCalledTimes(1)
    // The poll at 60 minutes: the first one was at 0, the sixth at 50, the seventh at 60.
    await vi.advanceTimersByTimeAsync(1)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[1]![0].updated_at).toBe(new Date(START.getTime() + HOUR).toISOString())

    // And the hour starts again from that one.
    await vi.advanceTimersByTimeAsync(HOUR - 1)
    expect(onChange).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('counts the hour from the last snapshot sent, not the last one fetched', async () => {
    // A change at 10 minutes is sent; the hour then runs from there.
    let temperature = 12
    const { service, onChange } = setup(() => Promise.resolve(snapshot({ current: { condition: 'rainy', temperature } })), () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)
    temperature = 13
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(onChange).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(HOUR - INTERVAL - 1)
    expect(onChange).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('is not called for a failed poll, and the snapshot after a failure is compared with the last one sent', async () => {
    let step = 0
    const { service, onChange } = setup(() => ++step === 2 ? Promise.reject(new WeatherError('fetch', 'timed out after 30 s')) : Promise.resolve(snapshot()), () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2 * INTERVAL + INTERVAL)

    expect(step).toBe(3)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not stop the polling if it throws, and says so without a secret', async () => {
    const { service, load, onChange, log } = setup(undefined, () => 0)
    onChange.mockImplementation(() => { throw new Error('socket exploded') })
    service.start()

    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(load).toHaveBeenCalledTimes(2)
    expect(log.error).toHaveBeenCalledWith('[weather] telling the app about the change failed: socket exploded')
  })
})

describe('logging', () => {
  it('logs the first success only', async () => {
    const { service, log } = setup(undefined, () => 0)
    service.start()

    await vi.advanceTimersByTimeAsync(5 * INTERVAL)

    expect(log.info.mock.calls).toEqual([['[weather] rainy, and a forecast for 1 day']])
  })
})

describe('refresh', () => {
  it('polls now, and the next poll is an interval after that', async () => {
    const { service, load } = setup(undefined, () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(5 * MINUTE)

    await service.refresh()
    expect(load).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('shares a poll that is in flight', async () => {
    const pending = deferred<WeatherSnapshot>()
    const { service, load } = setup(() => pending.promise, () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)

    const first = service.refresh()
    const second = service.refresh()
    pending.resolve(snapshot())
    await Promise.all([first, second])

    expect(load).toHaveBeenCalledTimes(1)
    expect(service.get()).not.toBeNull()
  })

  it('never rejects', async () => {
    const { service } = setup(() => Promise.reject(new WeatherError('fetch', 'HTTP 500 Internal Server Error')), () => 0)

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

  it('ignores a success that arrives afterwards: no snapshot, no onChange, no log, no next poll', async () => {
    const pending = deferred<WeatherSnapshot>()
    const { service, load, onChange, log } = setup(() => pending.promise, () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)

    service.stop()
    pending.resolve(snapshot())
    await vi.advanceTimersByTimeAsync(3 * HOUR)

    expect(service.get()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('ignores a failure that arrives afterwards: no log, no retry', async () => {
    const pending = deferred<WeatherSnapshot>()
    const { service, load, log } = setup(() => pending.promise, () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)

    service.stop()
    pending.reject(new WeatherError('fetch', 'HTTP 500 Internal Server Error'))
    await vi.advanceTimersByTimeAsync(3 * HOUR)

    expect(service.status().last_error).toBeNull()
    expect(log.warn).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good snapshot readable', async () => {
    const { service } = setup(undefined, () => 0)
    service.start()
    await vi.advanceTimersByTimeAsync(1)

    service.stop()

    expect(service.get()).not.toBeNull()
  })
})
