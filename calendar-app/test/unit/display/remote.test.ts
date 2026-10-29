import { describe, expect, it } from 'vitest'
import { MONTH_RANGE } from '../../../shared/display'
import {
  OFFLINE_AFTER_MS,
  clearPin,
  connectionState,
  loadPin,
  monthCommandFor,
  monthLabel,
  monthOptions,
  savePin,
} from '../../../app/utils/remote'

describe('monthLabel', () => {
  it('is the month and year in British English', () => {
    expect(monthLabel('2026-10')).toBe('October 2026')
    expect(monthLabel('2027-01')).toBe('January 2027')
  })

  it('does not depend on the process time zone (the unit tests run in Auckland, ahead of UTC)', () => {
    expect(monthLabel('2026-03')).toBe('March 2026')
    expect(monthLabel('2026-12')).toBe('December 2026')
  })
})

describe('monthOptions', () => {
  const options = monthOptions('2026-10')

  it('runs 12 months either side of the current one, 25 in all, earliest first', () => {
    expect(options).toHaveLength(MONTH_RANGE * 2 + 1)
    expect(options[0]).toEqual({ value: '2025-10', label: 'October 2025' })
    expect(options[MONTH_RANGE]).toEqual({ value: '2026-10', label: 'October 2026' })
    expect(options.at(-1)).toEqual({ value: '2027-10', label: 'October 2027' })
  })

  it('has every month once, in order, across a year end', () => {
    const values = options.map(option => option.value)
    expect(new Set(values).size).toBe(25)
    expect(values).toEqual([...values].sort())
    expect(values.slice(2, 5)).toEqual(['2025-12', '2026-01', '2026-02'])
  })

  it('works from a January and a December', () => {
    expect(monthOptions('2027-01')[0]!.value).toBe('2026-01')
    expect(monthOptions('2026-12').at(-1)!.value).toBe('2027-12')
  })
})

describe('monthCommandFor', () => {
  it('says current for the current month, which unpins the wall', () => {
    expect(monthCommandFor('2026-10', '2026-10')).toBe('current')
  })

  it('is the month itself for any other', () => {
    expect(monthCommandFor('2026-11', '2026-10')).toBe('2026-11')
    expect(monthCommandFor('2025-10', '2026-10')).toBe('2025-10')
  })
})

describe('connectionState', () => {
  const down = (notOpenMs: number, online = true) => connectionState({ open: false, online, notOpenMs })

  it('is connected while the socket is open', () => {
    expect(connectionState({ open: true, online: true, notOpenMs: 0 })).toBe('connected')
  })

  it('is reconnecting for the first ten seconds without a socket, the first connection included', () => {
    expect(down(0)).toBe('reconnecting')
    expect(down(OFFLINE_AFTER_MS - 1)).toBe('reconnecting')
  })

  it('is offline from ten seconds on', () => {
    expect(OFFLINE_AFTER_MS).toBe(10_000)
    expect(down(OFFLINE_AFTER_MS)).toBe('offline')
    expect(down(60_000)).toBe('offline')
  })

  it('is offline at once when the phone has no network', () => {
    expect(down(0, false)).toBe('offline')
  })

  it('trusts an open socket over the phone\'s guess at its network', () => {
    expect(connectionState({ open: true, online: false, notOpenMs: 0 })).toBe('connected')
  })
})

/** The parts of Storage the PIN uses, backed by a map. */
class FakeStorage {
  items = new Map<string, string>()
  getItem(key: string) {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.items.set(key, value)
  }

  removeItem(key: string) {
    this.items.delete(key)
  }
}

/** A storage that throws on every use, as a blocked one does. */
const broken = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  },
  removeItem() {
    throw new Error('blocked')
  },
} as unknown as Storage

describe('the kept PIN', () => {
  it('is saved under wallcal.remote.pin and given back', () => {
    const storage = new FakeStorage()
    savePin(storage as unknown as Storage, '4821')

    expect(storage.items.get('wallcal.remote.pin')).toBe('4821')
    expect(loadPin(storage as unknown as Storage)).toBe('4821')
  })

  it('is null before one is saved and after it is cleared', () => {
    const storage = new FakeStorage() as unknown as Storage
    expect(loadPin(storage)).toBeNull()

    savePin(storage, '4821')
    clearPin(storage)

    expect(loadPin(storage)).toBeNull()
  })

  it('is null, and no error, where storage is missing or blocked', () => {
    expect(loadPin(null)).toBeNull()
    expect(loadPin(undefined)).toBeNull()
    expect(loadPin(broken)).toBeNull()
    expect(() => savePin(broken, '4821')).not.toThrow()
    expect(() => clearPin(broken)).not.toThrow()
    expect(() => savePin(null, '4821')).not.toThrow()
  })
})
