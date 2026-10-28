import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarConfig } from '../../../server/config/schema'
import { IcsSourceError } from '../../../server/sources/ics/errors'
import { createSyncScheduler, MAX_BACKOFF_MS, retryDelayMs } from '../../../server/sources/scheduler'
import type { RefreshResult, SyncOutcome } from '../../../server/sources/scheduler'
import { calendarConfig } from './helpers'

// The scheduler under fake timers, with a stub for the sync and for the log:
// no network, no database.

const SECOND = 1000
const INTERVAL = 60 * SECOND
const NOTHING_NEW: SyncOutcome = { status: 'not-modified', changed: false, summary: 'not modified' }
const CHANGED: SyncOutcome = { status: 'updated', changed: true, summary: '1 added, 0 changed, 0 removed (1 events)' }
const FAILURE = new IcsSourceError('fetch', 'HTTP 500 Internal Server Error')

const ics = (id: string, pollSeconds = INTERVAL / SECOND) =>
  calendarConfig({ id, source: { type: 'ics', url: `https://example.com/secret-token-${id}/basic.ics`, poll_seconds: pollSeconds } })
const homeAssistant = (id: string) =>
  calendarConfig({ id, source: { type: 'homeassistant', entity_id: 'calendar.bins', poll_seconds: 300 } })

/** A promise settled from outside, for a sync that is still in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function setup(calendars: CalendarConfig[], syncImpl: (calendar: CalendarConfig) => Promise<SyncOutcome> = () => Promise.resolve(NOTHING_NEW), random = () => 0.5) {
  const sync = vi.fn(syncImpl)
  const onChange = vi.fn<(calendarIds: string[]) => void>()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const scheduler = createSyncScheduler({
    calendars,
    canSync: calendar => calendar.source.type === 'ics',
    sync,
    onChange,
    random,
    log,
  })
  const calls = (id: string) => sync.mock.calls.filter(([calendar]) => calendar.id === id).length
  const logged = () => JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls])
  return { scheduler, sync, onChange, log, calls, logged }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('retryDelayMs', () => {
  it('is the interval until something fails, then doubles for each failure up to an hour', () => {
    expect([0, 1, 2, 3, 6, 7, 30].map(failures => retryDelayMs(INTERVAL, failures) / SECOND)).toEqual([60, 120, 240, 480, 3600, 3600, 3600])
  })

  it('never waits less than the interval, even for an interval over an hour', () => {
    expect(retryDelayMs(2 * MAX_BACKOFF_MS, 3)).toBe(2 * MAX_BACKOFF_MS)
  })
})

describe('polling', () => {
  it('makes the first poll of each calendar after a jitter of up to 10 seconds, and nothing before start()', async () => {
    const { scheduler, calls } = setup([ics('a'), ics('b')], undefined, vi.fn().mockReturnValueOnce(0.25).mockReturnValueOnce(0.9))

    await vi.advanceTimersByTimeAsync(60 * SECOND)
    expect(calls('a') + calls('b')).toBe(0)

    scheduler.start()
    await vi.advanceTimersByTimeAsync(2499)
    expect(calls('a')).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls('a')).toBe(1)
    expect(calls('b')).toBe(0)
    await vi.advanceTimersByTimeAsync(6499)
    expect(calls('b')).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls('b')).toBe(1)
  })

  it('polls again every interval, each calendar on its own', async () => {
    const { scheduler, calls } = setup([ics('a', 60), ics('b', 300)], undefined, () => 0)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(600 * SECOND)

    // At 0 s and then every 60 s; at 0 s and then every 300 s.
    expect(calls('a')).toBe(11)
    expect(calls('b')).toBe(3)
  })

  it('spreads the first polls over at most the interval when the interval is short', async () => {
    const { scheduler, calls } = setup([ics('a', 30)], undefined, () => 0.999)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(9989)
    expect(calls('a')).toBe(0)
    await vi.advanceTimersByTimeAsync(11)
    expect(calls('a')).toBe(1)
  })

  it('does not start a second poll while one is still running', async () => {
    const first = deferred<SyncOutcome>()
    const { scheduler, calls } = setup([ics('a')], () => first.promise, () => 0)
    scheduler.start()

    // Far past several intervals: the one sync is still waiting on the network.
    await vi.advanceTimersByTimeAsync(10 * INTERVAL)
    expect(calls('a')).toBe(1)

    first.resolve(NOTHING_NEW)
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(calls('a')).toBe(2)
  })

  it('skips calendars whose source cannot be synced yet, and says so once', async () => {
    const { scheduler, calls, log } = setup([ics('a'), homeAssistant('bins')], undefined, () => 0)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(10 * INTERVAL)
    scheduler.start()

    expect(calls('a')).toBe(11)
    expect(calls('bins')).toBe(0)
    expect(log.info.mock.calls.filter(([line]) => String(line).includes('bins (homeassistant)'))).toHaveLength(1)
  })

  it('starts nothing when there is nothing to sync', async () => {
    const { scheduler, sync, log } = setup([homeAssistant('bins')])
    scheduler.start()

    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(sync).not.toHaveBeenCalled()
    await expect(scheduler.refreshAll()).resolves.toEqual([])
    expect(log.warn).not.toHaveBeenCalled()
  })
})

describe('failures', () => {
  /** The times, in seconds from the start, at which a sync that always fails was called. */
  async function failureTimes(count: number) {
    const times: number[] = []
    const start = Date.now()
    const { scheduler, log } = setup([ics('a')], () => {
      times.push((Date.now() - start) / SECOND)
      return Promise.reject(FAILURE)
    }, () => 0)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(count * MAX_BACKOFF_MS)
    return { times, log }
  }

  it('waits twice as long after each failure in a row, up to an hour', async () => {
    const { times } = await failureTimes(6)

    const gaps = times.slice(1, 9).map((time, index) => time - times[index]!)
    expect(gaps).toEqual([120, 240, 480, 960, 1920, 3600, 3600, 3600])
  })

  it('goes back to the interval after a success, and says so once', async () => {
    let failing = 2
    const { scheduler, calls, log } = setup([ics('a')], () => failing-- > 0 ? Promise.reject(FAILURE) : Promise.resolve(NOTHING_NEW), () => 0)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(0)
    expect(calls('a')).toBe(1) // fails: next in 120 s
    await vi.advanceTimersByTimeAsync(119 * SECOND)
    expect(calls('a')).toBe(1)
    await vi.advanceTimersByTimeAsync(1 * SECOND)
    expect(calls('a')).toBe(2) // fails: next in 240 s
    await vi.advanceTimersByTimeAsync(240 * SECOND)
    expect(calls('a')).toBe(3) // works
    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(calls('a')).toBe(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls('a')).toBe(4)

    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.info.mock.calls.filter(([line]) => String(line).includes('working again after 2'))).toHaveLength(1)
  })

  it('logs a warning with the calendar, the safe message and when it will retry', async () => {
    const { log } = await failureTimes(1)

    expect(log.warn.mock.calls[0]).toEqual(['[sync] a: HTTP 500 Internal Server Error; the last good events are kept, trying again in 120 s (1 in a row)'])
    expect(log.warn.mock.calls[1]![0]).toContain('trying again in 240 s (2 in a row)')
  })

  it('never logs a URL, even when the error carries one', async () => {
    const url = 'https://calendar.example.com/secret-token-abc123/basic.ics'
    const { scheduler, logged } = setup([ics('a')], () => Promise.reject(new TypeError(`Failed to parse URL from ${url}`)), () => 0)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(0)

    expect(logged()).toContain('unexpected error (TypeError)')
    expect(logged()).not.toContain('secret-token')
    expect(logged()).not.toContain('calendar.example.com')
  })

  it('does not let a rejection escape, whatever was thrown', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const thrown = [undefined, 'a string', { not: 'an error' }, FAILURE, new Error('boom')]
      const { scheduler, calls } = setup([ics('a')], () => Promise.reject(thrown[calls('a') - 1]), () => 0)
      scheduler.start()

      await vi.advanceTimersByTimeAsync(2 * MAX_BACKOFF_MS)
      await scheduler.refreshAll()
      await vi.advanceTimersByTimeAsync(0)

      expect(calls('a')).toBeGreaterThanOrEqual(thrown.length)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('does not let a sync that throws straight away, instead of rejecting, escape either', async () => {
    const { scheduler, calls } = setup([ics('a')], () => { throw FAILURE }, () => 0)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(0)
    await expect(scheduler.refreshAll()).resolves.toEqual([{ calendarId: 'a', status: 'error', error: 'HTTP 500 Internal Server Error' }])

    expect(calls('a')).toBe(2)
  })

  it('keeps polling the other calendars while one fails', async () => {
    const { scheduler, calls } = setup([ics('bad'), ics('good')], calendar => calendar.id === 'bad' ? Promise.reject(FAILURE) : Promise.resolve(NOTHING_NEW), () => 0)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(10 * INTERVAL)

    expect(calls('good')).toBe(11)
    expect(calls('bad')).toBeLessThan(5)
  })
})

describe('telling the app', () => {
  it('calls onChange with the calendar after a sync that changed events, and not otherwise', async () => {
    const outcomes = [CHANGED, NOTHING_NEW, { ...CHANGED, summary: 'again' }, { status: 'updated' as const, changed: false, summary: 'the same events' }]
    const { scheduler, onChange } = setup([ics('a')], () => Promise.resolve(outcomes.shift() ?? NOTHING_NEW), () => 0)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(0)
    expect(onChange.mock.calls).toEqual([[['a']]])
    await vi.advanceTimersByTimeAsync(INTERVAL)
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(onChange.mock.calls).toEqual([[['a']], [['a']]])
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('does not call onChange after a failure', async () => {
    const { scheduler, onChange } = setup([ics('a')], () => Promise.reject(FAILURE), () => 0)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('carries on if onChange throws', async () => {
    const { scheduler, onChange, calls, log } = setup([ics('a')], () => Promise.resolve(CHANGED), () => 0)
    onChange.mockImplementation(() => { throw new Error('listener broke') })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(calls('a')).toBe(2)
    expect(log.error.mock.calls[0]![0]).toContain('listener broke')
  })

  it('logs the first success and every change, but not a poll that found nothing new', async () => {
    const outcomes = [NOTHING_NEW, NOTHING_NEW, CHANGED, NOTHING_NEW]
    const { scheduler, log } = setup([ics('a')], () => Promise.resolve(outcomes.shift() ?? NOTHING_NEW), () => 0)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(5 * INTERVAL)

    expect(log.info.mock.calls).toEqual([['[sync] a: not modified'], ['[sync] a: 1 added, 0 changed, 0 removed (1 events)']])
  })

  it('logs the warnings of a sync that has something to say', async () => {
    const { scheduler, log } = setup([ics('a')], () => Promise.resolve({ ...CHANGED, warnings: ['an event with an unknown time zone'] }), () => 0)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(0)

    expect(log.warn.mock.calls).toEqual([['[sync] a: an event with an unknown time zone']])
  })
})

describe('refreshAll', () => {
  it('polls every calendar now and resolves with how each went', async () => {
    const { scheduler, calls } = setup([ics('a'), ics('b'), ics('c'), homeAssistant('bins')], (calendar) => {
      if (calendar.id === 'b') return Promise.resolve(CHANGED)
      if (calendar.id === 'c') return Promise.reject(FAILURE)
      return Promise.resolve(NOTHING_NEW)
    })
    scheduler.start()

    const results = await scheduler.refreshAll()

    // Before the jitter has run out, and without waiting for it.
    expect(results).toEqual<RefreshResult[]>([
      { calendarId: 'a', status: 'not-modified' },
      { calendarId: 'b', status: 'updated' },
      { calendarId: 'c', status: 'error', error: 'HTTP 500 Internal Server Error' },
    ])
    expect([calls('a'), calls('b'), calls('c'), calls('bins')]).toEqual([1, 1, 1, 0])
  })

  it('reports only the safe message for an error of its own', async () => {
    const url = 'https://calendar.example.com/secret-token-abc123/basic.ics'
    const { scheduler } = setup([ics('a')], () => Promise.reject(new TypeError(`Failed to parse URL from ${url}`)))

    const results = await scheduler.refreshAll()

    expect(results).toEqual([{ calendarId: 'a', status: 'error', error: 'unexpected error (TypeError)' }])
    expect(JSON.stringify(results)).not.toContain('secret-token')
  })

  it('takes the place of the poll that was waiting, and the schedule goes on from there', async () => {
    const { scheduler, calls } = setup([ics('a')], undefined, () => 0.5)
    scheduler.start() // first poll due at 5 s

    await vi.advanceTimersByTimeAsync(2 * SECOND)
    await scheduler.refreshAll()
    expect(calls('a')).toBe(1)

    // The waiting poll at 5 s is gone; the next is an interval after the forced one (2 s).
    await vi.advanceTimersByTimeAsync(3 * SECOND)
    expect(calls('a')).toBe(1)
    await vi.advanceTimersByTimeAsync(INTERVAL - 3 * SECOND - 1)
    expect(calls('a')).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls('a')).toBe(2)
  })

  it('continues the backoff after a forced poll that fails', async () => {
    const { scheduler, calls } = setup([ics('a')], () => Promise.reject(FAILURE))
    scheduler.start()

    await scheduler.refreshAll() // the first failure: next in 120 s
    await scheduler.refreshAll() // the second: next in 240 s
    expect(calls('a')).toBe(2)

    await vi.advanceTimersByTimeAsync(239 * SECOND)
    expect(calls('a')).toBe(2)
    await vi.advanceTimersByTimeAsync(1 * SECOND)
    expect(calls('a')).toBe(3)
  })

  it('works before start(), and a success resets the backoff', async () => {
    let failing = true
    const { scheduler, calls } = setup([ics('a')], () => failing ? Promise.reject(FAILURE) : Promise.resolve(NOTHING_NEW))

    await scheduler.refreshAll()
    failing = false
    await scheduler.refreshAll()
    expect(calls('a')).toBe(2)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(calls('a')).toBe(3)
  })

  it('waits for a sync that is in flight and then syncs once more, never two at a time', async () => {
    const gates = [deferred<SyncOutcome>(), deferred<SyncOutcome>()]
    let running = 0
    let mostAtOnce = 0
    let started = 0
    const { scheduler, calls } = setup([ics('a'), ics('b')], async (calendar) => {
      if (calendar.id === 'b') return NOTHING_NEW
      running++
      mostAtOnce = Math.max(mostAtOnce, running)
      try {
        return await gates[started++]!.promise
      } finally {
        running--
      }
    }, () => 0)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls('a')).toBe(1) // the scheduled poll is in flight

    let finished: RefreshResult[] | undefined
    const refresh = scheduler.refreshAll().then((results) => { finished = results })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls('a')).toBe(1) // not started a second one
    expect(calls('b')).toBe(2) // b was idle (its scheduled poll was done): forced at once

    gates[0]!.resolve(NOTHING_NEW)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls('a')).toBe(2) // the forced one starts when the first is done
    expect(finished).toBeUndefined()

    gates[1]!.resolve(CHANGED)
    await refresh

    expect(finished).toEqual([{ calendarId: 'a', status: 'updated' }, { calendarId: 'b', status: 'not-modified' }])
    expect(mostAtOnce).toBe(1)
  })

  it('shares one refresh between callers that arrive while it is running', async () => {
    const gate = deferred<SyncOutcome>()
    const { scheduler, calls } = setup([ics('a'), ics('b')], () => gate.promise)

    const first = scheduler.refreshAll()
    const second = scheduler.refreshAll()
    await vi.advanceTimersByTimeAsync(0)

    expect(second).toBe(first)
    gate.resolve(NOTHING_NEW)
    await expect(first).resolves.toHaveLength(2)
    expect([calls('a'), calls('b')]).toEqual([1, 1])

    // A later one is a refresh of its own.
    await scheduler.refreshAll()
    expect([calls('a'), calls('b')]).toEqual([2, 2])
  })
})

describe('stop', () => {
  it('cancels every waiting poll', async () => {
    const { scheduler, sync } = setup([ics('a'), ics('b')])
    scheduler.start()
    await vi.advanceTimersByTimeAsync(10 * SECOND)
    expect(sync).toHaveBeenCalledTimes(2)

    scheduler.stop()
    await vi.advanceTimersByTimeAsync(2 * MAX_BACKOFF_MS)

    expect(sync).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the polls that have not started yet', async () => {
    const { scheduler, sync } = setup([ics('a')])
    scheduler.start()

    scheduler.stop()
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS)

    expect(sync).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a sync that finishes afterwards: no log, no change, no next poll', async () => {
    const gate = deferred<SyncOutcome>()
    const { scheduler, sync, onChange, log } = setup([ics('a')], () => gate.promise, () => 0)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(sync).toHaveBeenCalledTimes(1)

    scheduler.stop()
    gate.resolve(CHANGED)
    await vi.advanceTimersByTimeAsync(2 * MAX_BACKOFF_MS)

    expect(onChange).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a sync that fails afterwards, as one does when the database has been closed under it', async () => {
    const gate = deferred<SyncOutcome>()
    const { scheduler, sync, log } = setup([ics('a')], () => gate.promise, () => 0)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)

    scheduler.stop()
    gate.reject(new TypeError('The database connection is not open'))
    await vi.advanceTimersByTimeAsync(2 * MAX_BACKOFF_MS)

    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not poll for a refresh that was waiting on a sync when it stopped', async () => {
    const gate = deferred<SyncOutcome>()
    const { scheduler, sync } = setup([ics('a')], () => gate.promise, () => 0)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    const refresh = scheduler.refreshAll()

    scheduler.stop()
    gate.resolve(NOTHING_NEW)
    const results = await refresh

    expect(sync).toHaveBeenCalledTimes(1)
    expect(results).toEqual([{ calendarId: 'a', status: 'error', error: 'the server is shutting down' }])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cannot be started again', async () => {
    const { scheduler, sync } = setup([ics('a')])
    scheduler.stop()

    scheduler.start()
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS)

    expect(sync).not.toHaveBeenCalled()
  })
})
