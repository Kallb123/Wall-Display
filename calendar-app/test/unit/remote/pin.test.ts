import { describe, expect, it } from 'vitest'
import { createPinGuard } from '../../../server/remote/pin'

/** A guard on a clock the test moves. */
function guardAt(options: { maxFailures?: number, windowMs?: number } = {}) {
  let time = 1_000_000
  const guard = createPinGuard({ ...options, now: () => time })
  return { guard, advance: (ms: number) => void (time += ms) }
}

describe('the remote PIN guard', () => {
  it('lets everything through when no PIN is configured', () => {
    const { guard } = guardAt()

    expect(guard.check(undefined, undefined, 'a')).toBe('ok')
    expect(guard.check(undefined, '', 'a')).toBe('ok')
    expect(guard.check(undefined, '9999', 'a')).toBe('ok')
  })

  it('answers missing for no PIN, and does not count it as a failure', () => {
    const { guard } = guardAt({ maxFailures: 2 })

    for (let i = 0; i < 5; i++) expect(guard.check('2468', undefined, 'a')).toBe('missing')
    expect(guard.check('2468', '', 'a')).toBe('missing')
    expect(guard.check('2468', '2468', 'a')).toBe('ok')
  })

  it('answers wrong for another PIN, and ok for the right one', () => {
    const { guard } = guardAt()

    expect(guard.check('2468', '1357', 'a')).toBe('wrong')
    expect(guard.check('2468', '2468', 'a')).toBe('ok')
  })

  it('compares PINs of any length without throwing, and only an exact match passes', () => {
    const { guard } = guardAt()

    expect(guard.check('2468', '24', 'a')).toBe('wrong')
    expect(guard.check('2468', '246800000000000000000000', 'a')).toBe('wrong')
    expect(guard.check('2468', '24680', 'a')).toBe('wrong')
    expect(guard.check('2468', '246', 'a')).toBe('wrong')
    expect(guard.check('2468', '2468', 'a')).toBe('ok')
  })

  it('locks a client out after the maximum wrong PINs, even for the right one', () => {
    const { guard } = guardAt()

    for (let i = 0; i < 10; i++) expect(guard.check('2468', `000${i}`, 'a')).toBe('wrong')
    expect(guard.check('2468', '0000', 'a')).toBe('locked')
    expect(guard.check('2468', '2468', 'a')).toBe('locked')
  })

  it('unlocks once the window after the first failure has passed, with a fresh count', () => {
    const { guard, advance } = guardAt({ maxFailures: 3, windowMs: 60_000 })

    guard.check('2468', '1111', 'a')
    advance(20_000)
    guard.check('2468', '1111', 'a')
    guard.check('2468', '1111', 'a')
    expect(guard.check('2468', '2468', 'a')).toBe('locked')

    // The window runs from the first failure, not the last.
    advance(39_999)
    expect(guard.check('2468', '2468', 'a')).toBe('locked')
    advance(1)
    expect(guard.check('2468', '1111', 'a')).toBe('wrong')
    guard.check('2468', '1111', 'a')
    expect(guard.check('2468', '1111', 'a')).toBe('wrong')
    expect(guard.check('2468', '2468', 'a')).toBe('locked')
  })

  it('forgets failures that fall outside the window', () => {
    const { guard, advance } = guardAt({ maxFailures: 3, windowMs: 60_000 })

    guard.check('2468', '1111', 'a')
    guard.check('2468', '1111', 'a')
    advance(60_000)
    guard.check('2468', '1111', 'a')
    guard.check('2468', '1111', 'a')

    expect(guard.check('2468', '2468', 'a')).toBe('ok')
  })

  it('clears a client\'s failures when it sends the right PIN', () => {
    const { guard } = guardAt({ maxFailures: 3 })

    guard.check('2468', '1111', 'a')
    guard.check('2468', '1111', 'a')
    expect(guard.check('2468', '2468', 'a')).toBe('ok')

    guard.check('2468', '1111', 'a')
    guard.check('2468', '1111', 'a')
    expect(guard.check('2468', '2468', 'a')).toBe('ok')
  })

  it('counts each client separately', () => {
    const { guard } = guardAt({ maxFailures: 2 })

    guard.check('2468', '1111', 'a')
    guard.check('2468', '1111', 'a')

    expect(guard.check('2468', '2468', 'a')).toBe('locked')
    expect(guard.check('2468', '2468', 'b')).toBe('ok')
    expect(guard.check('2468', '1111', 'b')).toBe('wrong')
  })

  it('drops expired entries on each check, so the map does not grow without bound', () => {
    const { guard, advance } = guardAt({ maxFailures: 1, windowMs: 60_000 })

    for (let i = 0; i < 100; i++) guard.check('2468', '1111', `client-${i}`)
    expect(guard.size()).toBe(100)

    advance(59_999)
    guard.check('2468', undefined, 'someone-else')
    expect(guard.size()).toBe(100)

    // Any check prunes, whoever it is from.
    advance(1)
    guard.check('2468', undefined, 'someone-else')
    expect(guard.size()).toBe(0)
  })

  it('does not hold anything for clients that never fail', () => {
    const { guard } = guardAt()

    guard.check('2468', '2468', 'a')
    guard.check('2468', undefined, 'b')
    guard.check(undefined, '1111', 'c')

    expect(guard.size()).toBe(0)
  })
})
