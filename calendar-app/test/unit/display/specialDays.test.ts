import { describe, expect, it } from 'vitest'
import type { Preview } from '../../../shared/display'
import type { SpecialDaysResolution, Takeover } from '../../../shared/special-days'
import { activePreview, greetingSize, isEvening, previewKey, previewQuery, takeoverInForce, tileArt } from '../../../app/utils/specialDays'
import { CALENDAR_VIEWS, isCalendarView } from '../../../app/utils/views'

const takeover: Takeover = { id: 'halloween', name: 'Halloween', date: '2026-10-31', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null }
const resolution = (changes: Partial<SpecialDaysResolution> = {}): SpecialDaysResolution => ({
  today: '2026-10-31', from: '2026-09-17', to: '2026-11-14', tiles: [], current: { id: 'halloween', name: 'Halloween' }, takeover, tomorrow_art: [], ...changes,
})

describe('isEvening', () => {
  it('is from 18:00 wall time', () => {
    expect(isEvening(new Date('2026-10-28T17:59:59Z'), 'Europe/London')).toBe(false)
    expect(isEvening(new Date('2026-10-28T18:00:00Z'), 'Europe/London')).toBe(true)
    expect(isEvening(new Date('2026-10-28T23:59:59Z'), 'Europe/London')).toBe(true)
  })

  it('is false from midnight, which a 24-hour clock may call 24', () => {
    expect(isEvening(new Date('2026-10-28T00:00:00Z'), 'Europe/London')).toBe(false)
    expect(isEvening(new Date('2026-10-28T00:30:00Z'), 'UTC')).toBe(false)
  })

  it('reads the hour in the display\'s time zone, not the machine\'s', () => {
    // 17:30 in London while BST has ended (GMT), but 18:30 in Paris and 02:30 the next day in Tokyo.
    const instant = new Date('2026-10-28T17:30:00Z')
    expect(isEvening(instant, 'Europe/London')).toBe(false)
    expect(isEvening(instant, 'Europe/Paris')).toBe(true)
    expect(isEvening(instant, 'Asia/Tokyo')).toBe(false)
  })

  it('follows summer time', () => {
    // 17:30 UTC on 28 June is 18:30 in London.
    expect(isEvening(new Date('2026-06-28T17:30:00Z'), 'Europe/London')).toBe(true)
    expect(isEvening(new Date('2026-06-28T16:30:00Z'), 'Europe/London')).toBe(false)
  })
})

describe('activePreview', () => {
  const preview: Preview = { special_day: 'halloween', until: '2026-10-28T09:42:00.000Z' }

  it('is the preview until its time, and null at it and after', () => {
    expect(activePreview(preview, new Date('2026-10-28T09:41:59Z'))).toBe(preview)
    expect(activePreview(preview, new Date('2026-10-28T09:42:00Z'))).toBeNull()
    expect(activePreview(preview, new Date('2026-10-28T10:00:00Z'))).toBeNull()
  })

  it('is null for none', () => {
    expect(activePreview(null, new Date())).toBeNull()
  })
})

describe('previewQuery and previewKey', () => {
  it('asks for a day by special_day and a scene by scene', () => {
    expect(previewQuery({ special_day: 'christmas', until: '2026-10-28T09:42:00.000Z' })).toEqual({ special_day: 'christmas' })
    expect(previewQuery({ scene: 'birthday', until: '2026-10-28T09:42:00.000Z' })).toEqual({ scene: 'birthday' })
  })

  it('keys by the target, ignoring when it ends, and tells a day from a scene of the same id', () => {
    const day = { special_day: 'birthday', until: '2026-10-28T09:42:00.000Z' }
    expect(previewKey(day)).toBe(previewKey({ ...day, until: '2026-10-28T09:50:00.000Z' }))
    expect(previewKey(day)).not.toBe(previewKey({ scene: 'birthday', until: day.until }))
    expect(previewKey(null)).toBeNull()
  })
})

describe('takeoverInForce', () => {
  const context = { resolution: resolution(), view: 'month' as const, today: '2026-10-31', previewing: false }

  it('is the takeover on its own date, on every calendar view', () => {
    for (const view of CALENDAR_VIEWS) expect(takeoverInForce({ ...context, view })).toBe(takeover)
  })

  it('is null on the photo frame and the night view', () => {
    expect(takeoverInForce({ ...context, view: 'photo' })).toBeNull()
    expect(takeoverInForce({ ...context, view: 'night' })).toBeNull()
  })

  it('does not outlive its midnight, even if the server has not said so', () => {
    expect(takeoverInForce({ ...context, today: '2026-11-01' })).toBeNull()
  })

  it('does not start before its midnight either', () => {
    expect(takeoverInForce({ ...context, today: '2026-10-30' })).toBeNull()
  })

  it('is null until the settings, and so the date, have arrived', () => {
    expect(takeoverInForce({ ...context, today: null })).toBeNull()
  })

  it('is null with none to show', () => {
    expect(takeoverInForce({ ...context, resolution: null })).toBeNull()
    expect(takeoverInForce({ ...context, resolution: resolution({ takeover: null }) })).toBeNull()
  })

  it('takes the server\'s word for a preview, whatever today is', () => {
    expect(takeoverInForce({ ...context, today: '2026-10-28', previewing: true })).toBe(takeover)
    expect(takeoverInForce({ ...context, today: null, previewing: true })).toBe(takeover)
    // But a preview of a photo frame is still the photo frame.
    expect(takeoverInForce({ ...context, view: 'photo', previewing: true })).toBeNull()
  })
})

describe('isCalendarView', () => {
  it('is month, week and agenda', () => {
    expect([...CALENDAR_VIEWS]).toEqual(['month', 'week', 'agenda'])
    expect(['month', 'week', 'agenda', 'photo', 'night'].map(view => isCalendarView(view as never))).toEqual([true, true, true, false, false])
  })
})

describe('tileArt', () => {
  it('lists the art of the days that have some, in order', () => {
    const day = (id: string, tile_art: string | null) => ({ id, name: id, palette: 'warm' as const, tile_art })

    expect(tileArt([day('a', 'a.svg'), day('b', null), day('c', 'c.webp')])).toEqual(['a.svg', 'c.webp'])
    expect(tileArt([])).toEqual([])
  })
})

describe('greetingSize', () => {
  it('shrinks as the greeting gets longer, and stays a whole number of px', () => {
    expect(greetingSize('Happy Halloween')).toBe(56)
    expect(greetingSize('Happy 7th birthday, Isla!')).toBe(56)
    expect(greetingSize('Happy 7th birthday to our favourite Isla!')).toBe(46)
    expect(greetingSize('x'.repeat(80))).toBe(38)
  })
})
