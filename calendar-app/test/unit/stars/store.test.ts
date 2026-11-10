import { describe, expect, it, vi } from 'vitest'
import { MAX_STARS_PER_DAY } from '../../../shared/stars'
import type { StarChart } from '../../../shared/stars'
import { starChartPeople, starCounts } from '../../../server/db/schema'
import { createStarsService } from '../../../server/stars/service'
import { adjustStars, buildStarChart, countStarRows, getStarSettings, listStarCounts, saveStarSettings, starSettingsEntries } from '../../../server/stars/store'
import { migratedMemoryDb } from '../db/helpers'

// The star chart store against a migrated in-memory database, and the service.

const NOW = new Date('2026-11-09T12:00:00Z')
const PEOPLE = [
  { id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139' },
  { id: 'isla', name: 'Isla', initial: 'I', colour: '#D27FA0' },
  { id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4' },
]

describe('star settings', () => {
  it('defaults to off, weekly, with no goal', () => {
    const { db } = migratedMemoryDb()
    expect(getStarSettings(db, 'isla')).toEqual({ enabled: false, period: 'week', goal: null })
  })

  it('saves, replaces and reads back', () => {
    const { db } = migratedMemoryDb()
    expect(saveStarSettings(db, 'isla', { enabled: true, period: 'day', goal: 3 }, NOW)).toEqual({ enabled: true, period: 'day', goal: 3 })
    saveStarSettings(db, 'isla', { enabled: true, period: 'week', goal: null }, NOW)
    expect(getStarSettings(db, 'isla')).toEqual({ enabled: true, period: 'week', goal: null })
    expect(db.select().from(starChartPeople).all()).toHaveLength(1)
  })

  it('lists every person in the order given, with defaults for those never saved', () => {
    const { db } = migratedMemoryDb()
    saveStarSettings(db, 'theo', { enabled: true, period: 'day', goal: 2 }, NOW)
    const entries = starSettingsEntries(db, PEOPLE)
    expect(entries.map(entry => entry.id)).toEqual(['mum', 'isla', 'theo'])
    expect(entries[0]).toEqual({ ...PEOPLE[0], enabled: false, period: 'week', goal: null })
    expect(entries[2]).toMatchObject({ id: 'theo', enabled: true, period: 'day', goal: 2 })
  })

  it('refuses a period or goal the table does not allow', () => {
    const { db } = migratedMemoryDb()
    expect(() => db.insert(starChartPeople).values({ personId: 'x', enabled: true, period: 'month' as 'day', goal: null, updatedAt: NOW }).run()).toThrow()
    expect(() => db.insert(starChartPeople).values({ personId: 'x', enabled: true, period: 'day', goal: 0, updatedAt: NOW }).run()).toThrow()
  })
})

describe('adjustStars', () => {
  it('adds, takes away, and deletes the row when a day falls to 0', () => {
    const { db } = migratedMemoryDb()
    expect(adjustStars(db, 'isla', '2026-11-09', 3, NOW)).toBe(3)
    expect(adjustStars(db, 'isla', '2026-11-09', -1, NOW)).toBe(2)
    expect(adjustStars(db, 'isla', '2026-11-09', -2, NOW)).toBe(0)
    expect(countStarRows(db)).toBe(0)
  })

  it('stops at 0 and at the most a day holds', () => {
    const { db } = migratedMemoryDb()
    expect(adjustStars(db, 'isla', '2026-11-09', -5, NOW)).toBe(0)
    expect(countStarRows(db)).toBe(0)
    for (let i = 0; i < 12; i++) adjustStars(db, 'isla', '2026-11-09', 10, NOW)
    expect(adjustStars(db, 'isla', '2026-11-09', 10, NOW)).toBe(MAX_STARS_PER_DAY)
  })

  it('keeps each person and day apart', () => {
    const { db } = migratedMemoryDb()
    adjustStars(db, 'isla', '2026-11-09', 1, NOW)
    adjustStars(db, 'isla', '2026-11-08', 2, NOW)
    adjustStars(db, 'theo', '2026-11-09', 4, NOW)
    expect(listStarCounts(db, '2026-11-01', '2026-11-30')).toEqual({ isla: { '2026-11-08': 2, '2026-11-09': 1 }, theo: { '2026-11-09': 4 } })
  })

  it('refuses a negative count at the table', () => {
    const { db } = migratedMemoryDb()
    expect(() => db.insert(starCounts).values({ personId: 'isla', date: '2026-11-09', count: -1, updatedAt: NOW }).run()).toThrow()
  })
})

describe('listStarCounts', () => {
  it('returns only the range, ends included', () => {
    const { db } = migratedMemoryDb()
    for (const date of ['2026-10-26', '2026-10-27', '2026-11-09', '2026-11-10']) adjustStars(db, 'isla', date, 1, NOW)
    expect(listStarCounts(db, '2026-10-27', '2026-11-09')).toEqual({ isla: { '2026-10-27': 1, '2026-11-09': 1 } })
  })
})

describe('buildStarChart', () => {
  it('has the people switched on, in config order, and only their counts in the last 14 days', () => {
    const { db } = migratedMemoryDb()
    saveStarSettings(db, 'theo', { enabled: true, period: 'day', goal: 2 }, NOW)
    saveStarSettings(db, 'mum', { enabled: true, period: 'week', goal: null }, NOW)
    saveStarSettings(db, 'isla', { enabled: false, period: 'week', goal: null }, NOW)
    adjustStars(db, 'theo', '2026-11-09', 1, NOW)
    adjustStars(db, 'theo', '2026-10-26', 1, NOW)
    adjustStars(db, 'isla', '2026-11-09', 1, NOW)
    adjustStars(db, 'gone', '2026-11-09', 1, NOW)

    expect(buildStarChart(db, PEOPLE, '2026-11-09')).toEqual({
      people: [
        { id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139', period: 'week', goal: null },
        { id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4', period: 'day', goal: 2 },
      ],
      counts: { theo: { '2026-11-09': 1 } },
    })
  })

  it('is empty when nobody has a chart, and ignores a person no longer in the config', () => {
    const { db } = migratedMemoryDb()
    expect(buildStarChart(db, PEOPLE, '2026-11-09')).toEqual({ people: [], counts: {} })
    saveStarSettings(db, 'gone', { enabled: true, period: 'week', goal: null }, NOW)
    expect(buildStarChart(db, PEOPLE, '2026-11-09')).toEqual({ people: [], counts: {} })
  })
})

describe('createStarsService', () => {
  const chart = (n: number): StarChart => ({ people: [], counts: { a: { '2026-11-09': n } } })

  it('starts empty, loads on start without notifying, and notifies only on a change', () => {
    let next = chart(1)
    const onChange = vi.fn()
    const service = createStarsService({ load: () => next, onChange })
    expect(service.get()).toEqual({ people: [], counts: {} })

    service.start()
    expect(service.get()).toEqual(chart(1))
    expect(onChange).not.toHaveBeenCalled()

    service.changed()
    expect(onChange).not.toHaveBeenCalled()
    next = chart(2)
    service.changed()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(chart(2))
    service.changed()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good chart when loading throws, and logs it', () => {
    let fail = false
    const log = { warn: vi.fn(), error: vi.fn() }
    const onChange = vi.fn()
    const service = createStarsService({ load: () => { if (fail) throw new Error('disk'); return chart(1) }, onChange, log })
    service.start()
    fail = true
    expect(() => service.changed()).not.toThrow()
    expect(service.get()).toEqual(chart(1))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('disk'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not throw when a subscriber does', () => {
    let n = 1
    const log = { warn: vi.fn(), error: vi.fn() }
    const service = createStarsService({ load: () => chart(n), onChange: () => { throw new Error('boom') }, log })
    service.start()
    n = 2
    expect(() => service.changed()).not.toThrow()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })
})
