import { describe, expect, it, vi } from 'vitest'
import type { HaCheck } from '../../../../server/sources/homeassistant/ping'
import { createHaStatusCache } from '../../../../server/sources/homeassistant/status'

const MINUTE = 60_000
const START = new Date('2026-10-28T12:00:00Z')

/** A cache on a clock the test moves, over a check it answers by hand. */
function setup(results: HaCheck[] = [{ ok: true }], options: { ttlMs?: number } = {}) {
  let time = START.getTime()
  let calls = 0
  const check = vi.fn(async (): Promise<HaCheck> => results[Math.min(calls++, results.length - 1)]!)
  const cache = createHaStatusCache({ check, now: () => new Date(time), ...options })
  return { cache, check, advance: (ms: number) => void (time += ms) }
}

describe('the Home Assistant status cache', () => {
  it('checks on the first ask and records when', async () => {
    const { cache, check } = setup()

    expect(await cache.get()).toEqual({ ok: true, checkedAt: START })
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('answers from memory for a minute, and checks again after', async () => {
    const { cache, check, advance } = setup([{ ok: true }, { ok: false, error: 'could not connect (ECONNREFUSED)' }])
    await cache.get()

    advance(MINUTE - 1)
    expect(await cache.get()).toMatchObject({ ok: true, checkedAt: START })
    expect(check).toHaveBeenCalledTimes(1)

    advance(1)
    expect(await cache.get()).toEqual({ ok: false, error: 'could not connect (ECONNREFUSED)', checkedAt: new Date(START.getTime() + MINUTE) })
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('keeps a failure for as long as a success, so a Home Assistant that is down is not asked every few seconds', async () => {
    const { cache, check, advance } = setup([{ ok: false, error: 'timed out after 5 s' }])
    await cache.get()

    for (let i = 0; i < 5; i++) {
      advance(10_000)
      expect(await cache.get()).toMatchObject({ ok: false, error: 'timed out after 5 s' })
    }
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('uses the time to live it is given', async () => {
    const { cache, check, advance } = setup([{ ok: true }], { ttlMs: 5000 })
    await cache.get()

    advance(4999)
    await cache.get()
    expect(check).toHaveBeenCalledTimes(1)

    advance(1)
    await cache.get()
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('shares one check between callers that arrive while it runs', async () => {
    let finish!: (result: HaCheck) => void
    const check = vi.fn(() => new Promise<HaCheck>((resolve) => {
      finish = resolve
    }))
    const cache = createHaStatusCache({ check, now: () => START })

    const asks = [cache.get(), cache.get(), cache.get()]
    expect(check).toHaveBeenCalledTimes(1)
    finish({ ok: true })

    const answers = await Promise.all(asks)
    expect(answers[0]).toEqual({ ok: true, checkedAt: START })
    expect(answers[1]).toBe(answers[0])
    expect(answers[2]).toBe(answers[0])
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('stamps the time the check finished, not the time it was asked for', async () => {
    let time = START.getTime()
    let finish!: (result: HaCheck) => void
    const cache = createHaStatusCache({ check: () => new Promise<HaCheck>((resolve) => {
      finish = resolve
    }), now: () => new Date(time) })

    const ask = cache.get()
    time += 4000
    finish({ ok: true })

    expect((await ask).checkedAt).toEqual(new Date(START.getTime() + 4000))
  })

  it('starts a new check once the last one has finished and gone stale', async () => {
    const { cache, check, advance } = setup()
    await cache.get()
    advance(MINUTE)

    await Promise.all([cache.get(), cache.get()])

    expect(check).toHaveBeenCalledTimes(2)
  })

  it('answers with an error, naming only the kind, when the check throws, and tries again next time', async () => {
    const check = vi.fn<() => Promise<HaCheck>>()
    check.mockRejectedValueOnce(new TypeError('boom at http://ha.local with the-token'))
    check.mockResolvedValueOnce({ ok: true })
    let time = START.getTime()
    const cache = createHaStatusCache({ check, now: () => new Date(time) })

    const first = await cache.get()
    expect(first).toEqual({ ok: false, error: 'unexpected error (TypeError)', checkedAt: START })

    time += MINUTE
    expect(await cache.get()).toMatchObject({ ok: true })
  })
})
