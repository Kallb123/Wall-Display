import { describe, expect, it } from 'vitest'
import { isKnownTimeZone, syncWindow, wallTimeOf, zonedWallTimeToUtc } from '../../../server/sources/time'

const London = 'Europe/London'

function utc(wall: Parameters<typeof zonedWallTimeToUtc>[0], zone = London): string {
  return zonedWallTimeToUtc(wall, zone).toISOString()
}

describe('the test process', () => {
  it('runs in a time zone that is not the display zone, so nothing may lean on it', () => {
    // vitest.config.ts sets TZ for the unit project. Auckland is UTC+13 in January.
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-780)
  })
})

describe('zonedWallTimeToUtc', () => {
  it('reads winter London as UTC', () => {
    expect(utc({ year: 2026, month: 1, day: 15, hour: 9 })).toBe('2026-01-15T09:00:00.000Z')
  })

  it('reads summer London as an hour behind', () => {
    expect(utc({ year: 2026, month: 7, day: 15, hour: 9 })).toBe('2026-07-15T08:00:00.000Z')
  })

  it('reads other zones too', () => {
    expect(utc({ year: 2026, month: 7, day: 15, hour: 9 }, 'America/New_York')).toBe('2026-07-15T13:00:00.000Z')
    expect(utc({ year: 2026, month: 1, day: 15, hour: 9 }, 'Asia/Kolkata')).toBe('2026-01-15T03:30:00.000Z')
    expect(utc({ year: 2026, month: 1, day: 15, hour: 9 }, 'UTC')).toBe('2026-01-15T09:00:00.000Z')
  })

  it('has the right instants either side of the March change (clocks go forward at 01:00 UTC on 29 March 2026)', () => {
    expect(utc({ year: 2026, month: 3, day: 29, hour: 0, minute: 59 })).toBe('2026-03-29T00:59:00.000Z')
    expect(utc({ year: 2026, month: 3, day: 29, hour: 2, minute: 0 })).toBe('2026-03-29T01:00:00.000Z')
    expect(utc({ year: 2026, month: 3, day: 29, hour: 9 })).toBe('2026-03-29T08:00:00.000Z')
    expect(utc({ year: 2026, month: 3, day: 28, hour: 9 })).toBe('2026-03-28T09:00:00.000Z')
  })

  it('has the right instants either side of the October change (clocks go back at 01:00 UTC on 25 October 2026)', () => {
    expect(utc({ year: 2026, month: 10, day: 25, hour: 0, minute: 59 })).toBe('2026-10-24T23:59:00.000Z')
    expect(utc({ year: 2026, month: 10, day: 25, hour: 2, minute: 0 })).toBe('2026-10-25T02:00:00.000Z')
    expect(utc({ year: 2026, month: 10, day: 25, hour: 9 })).toBe('2026-10-25T09:00:00.000Z')
    expect(utc({ year: 2026, month: 10, day: 24, hour: 9 })).toBe('2026-10-24T08:00:00.000Z')
  })

  it('moves a time in the spring gap forward by the gap', () => {
    // 01:30 never happens in London on 29 March 2026. It becomes 02:30 BST.
    expect(utc({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 })).toBe('2026-03-29T01:30:00.000Z')
    expect(wallTimeOf(zonedWallTimeToUtc({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, London), London))
      .toMatchObject({ day: 29, hour: 2, minute: 30 })
    expect(utc({ year: 2026, month: 3, day: 29, hour: 1, minute: 0 })).toBe('2026-03-29T01:00:00.000Z')
  })

  it('takes the first of the two times in the autumn overlap', () => {
    // 01:30 happens twice in London on 25 October 2026. The first is BST.
    expect(utc({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 })).toBe('2026-10-25T00:30:00.000Z')
    expect(utc({ year: 2026, month: 10, day: 25, hour: 1, minute: 0 })).toBe('2026-10-25T00:00:00.000Z')
  })

  it('handles the gap and overlap in a zone with a different change time and size', () => {
    // Lord Howe Island shifts by 30 minutes. Clocks go forward at 02:00 on 4 October 2026 (to 02:30).
    expect(utc({ year: 2026, month: 10, day: 4, hour: 2, minute: 15 }, 'Australia/Lord_Howe')).toBe('2026-10-03T15:45:00.000Z')
    // New York springs forward at 02:00 local on 8 March 2026: 02:30 does not exist.
    expect(utc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York')).toBe('2026-03-08T07:30:00.000Z')
    // ...and falls back at 02:00 local on 1 November 2026: 01:30 happens twice, first as EDT.
    expect(utc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York')).toBe('2026-11-01T05:30:00.000Z')
  })

  it('does not depend on the process time zone', () => {
    expect(utc({ year: 2026, month: 6, day: 1, hour: 0 })).toBe('2026-05-31T23:00:00.000Z')
  })

  it('normalises overflowing fields', () => {
    expect(utc({ year: 2026, month: 13, day: 1 })).toBe('2027-01-01T00:00:00.000Z')
    expect(utc({ year: 2026, month: 2, day: 30, hour: 25 })).toBe('2026-03-03T01:00:00.000Z')
  })
})

describe('zonedWallTimeToUtc against Intl', () => {
  // The zone's clock changes are found once a year and remembered. Check them
  // against asking Intl directly, over ten years and zones that change at
  // different times, by different amounts, or not at all.
  const zones = ['Europe/London', 'America/New_York', 'Australia/Lord_Howe', 'Australia/Sydney', 'Asia/Kolkata', 'Pacific/Auckland', 'America/Sao_Paulo', 'Africa/Casablanca', 'UTC']

  it.each(zones)('reads the wall back to the same wall in %s, always choosing the earlier of a repeated time', (zone) => {
    let seed = 12345
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let i = 0; i < 3000; i++) {
      const instant = Date.UTC(2018, 0, 1) + Math.floor(random() * 10 * 365 * 86_400_000)
      const wall = wallTimeOf(new Date(instant), zone)

      const back = zonedWallTimeToUtc(wall, zone).getTime()

      expect(wallTimeOf(new Date(back), zone)).toEqual(wall)
      expect(back).toBeLessThanOrEqual(instant)
      expect(instant - back).toBeLessThanOrEqual(2 * 3_600_000)
    }
  })

  it.each(zones)('finds the same changes in %s as stepping through Intl hour by hour in 2026', (zone) => {
    // Every wall time on the hour: where the clocks skip it, it moves forward; elsewhere it is exact.
    for (let hour = 0; hour < 365 * 24; hour += 1) {
      const instant = Date.UTC(2026, 0, 1) + hour * 3_600_000
      const wall = wallTimeOf(new Date(instant), zone)
      const back = zonedWallTimeToUtc(wall, zone).getTime()

      expect(wallTimeOf(new Date(back), zone)).toEqual(wall)
    }
  })
})

describe('wallTimeOf', () => {
  it('reads an instant on a London wall', () => {
    expect(wallTimeOf(new Date('2026-10-31T23:30:00Z'), London)).toEqual({ year: 2026, month: 10, day: 31, hour: 23, minute: 30, second: 0 })
    expect(wallTimeOf(new Date('2026-06-30T23:30:00Z'), London)).toEqual({ year: 2026, month: 7, day: 1, hour: 0, minute: 30, second: 0 })
  })

  it('shows midnight as 0, not 24', () => {
    expect(wallTimeOf(new Date('2026-01-01T00:00:00Z'), London).hour).toBe(0)
  })
})

describe('isKnownTimeZone', () => {
  it('accepts IANA names and refuses Windows names', () => {
    expect(isKnownTimeZone('Europe/London')).toBe(true)
    expect(isKnownTimeZone('UTC')).toBe(true)
    expect(isKnownTimeZone('GMT Standard Time')).toBe(false)
    expect(isKnownTimeZone('Nowhere/Land')).toBe(false)
  })
})

describe('syncWindow', () => {
  const iso = ({ start, end }: { start: Date, end: Date }) => [start.toISOString(), end.toISOString()]

  it('runs from the first of the month a year back to the first of the month after a year ahead', () => {
    // Mid-October 2026 in BST. The window opens in October 2025 (BST) and closes on 1 November 2027 (GMT).
    expect(iso(syncWindow(new Date('2026-10-28T12:00:00Z'), London, 12, 12))).toEqual([
      '2025-09-30T23:00:00.000Z', // 1 October 2025 00:00 BST
      '2027-11-01T00:00:00.000Z', // 1 November 2027 00:00 GMT
    ])
  })

  it('has start and end at local midnight, which is not midnight UTC in summer', () => {
    // March 2026, 6 back = 1 September 2025 (BST); 6 ahead = 1 October 2026 (BST).
    expect(iso(syncWindow(new Date('2026-03-15T12:00:00Z'), London, 6, 6))).toEqual([
      '2025-08-31T23:00:00.000Z',
      '2026-09-30T23:00:00.000Z',
    ])
  })

  it('crosses the year boundary going back from January', () => {
    expect(iso(syncWindow(new Date('2026-01-10T12:00:00Z'), London, 2, 1))).toEqual([
      '2025-11-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ])
  })

  it('crosses the year boundary going ahead from December', () => {
    expect(iso(syncWindow(new Date('2026-12-20T12:00:00Z'), London, 1, 2))).toEqual([
      '2026-11-01T00:00:00.000Z',
      '2027-03-01T00:00:00.000Z',
    ])
  })

  it('goes by the month on the wall, not the UTC month, just after local midnight on the 1st', () => {
    // 00:30 BST on 1 June is still 31 May in UTC. It is June.
    const now = new Date('2026-05-31T23:30:00Z')
    expect(iso(syncWindow(now, London, 0, 0))).toEqual([
      '2026-05-31T23:00:00.000Z', // 1 June 00:00 BST
      '2026-06-30T23:00:00.000Z', // 1 July 00:00 BST
    ])
  })

  it('still counts the old month an hour before local midnight on the 1st', () => {
    const now = new Date('2026-05-31T22:30:00Z') // 23:30 BST on 31 May
    expect(iso(syncWindow(now, London, 0, 0))).toEqual([
      '2026-04-30T23:00:00.000Z', // 1 May 00:00 BST
      '2026-05-31T23:00:00.000Z', // 1 June 00:00 BST
    ])
  })

  it('is just the current month with no months either side', () => {
    expect(iso(syncWindow(new Date('2026-02-14T12:00:00Z'), London, 0, 0))).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ])
  })

  it('works in another zone', () => {
    // Auckland is UTC+13 in January.
    expect(iso(syncWindow(new Date('2026-01-15T12:00:00Z'), 'Pacific/Auckland', 0, 0))).toEqual([
      '2025-12-31T11:00:00.000Z',
      '2026-01-31T11:00:00.000Z',
    ])
  })

  it('covers 25 months with the default window', () => {
    const { start, end } = syncWindow(new Date('2026-10-28T12:00:00Z'), London, 12, 12)
    expect(wallTimeOf(start, London)).toMatchObject({ year: 2025, month: 10, day: 1, hour: 0 })
    expect(wallTimeOf(end, London)).toMatchObject({ year: 2027, month: 11, day: 1, hour: 0 })
  })
})
