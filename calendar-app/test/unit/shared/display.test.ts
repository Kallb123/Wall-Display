import { describe, expect, it } from 'vitest'
import { addMonths, addWeeks, commandSchema, currentMonth, currentWeek, DEFAULT_DAY_PARTS, DEFAULT_PREVIEW_SECONDS, displayStateSchema, firstDayOfWeek, monthDiff, NEXT_VIEW_ORDER, RETURN_VIEWS, VIEWS, WEEK_RANGE, WEEK_VIEWS, weekDiff } from '../../../shared/display'

describe('the display state schema', () => {
  it('fills in every field from nothing', () => {
    expect(displayStateSchema.parse({})).toEqual({
      view: 'month',
      month: null,
      month_set_at: null,
      week: null,
      week_set_at: null,
      screen: 'on',
      photo_source: 'immich',
      last_calendar_view: 'month',
      brightness: 100,
      auto_presence: true,
      auto_brightness: true,
      overlay: null,
      preview: null,
      schedules_off: [],
      schedule: null,
    })
  })

  it('turns both automatic policies on for a stored document that predates them', () => {
    const state = displayStateSchema.parse({ view: 'week', month: null, screen: 'off', photo_source: 'local', brightness: 20, overlay: null })

    expect(state).toMatchObject({ auto_presence: true, auto_brightness: true })
  })

  it('remembers month as the view toggle_photo goes back to for a stored document that predates it, and keeps one it has', () => {
    expect(displayStateSchema.parse({ view: 'photo' }).last_calendar_view).toBe('month')
    expect(displayStateSchema.parse({ view: 'photo', last_calendar_view: 'week' }).last_calendar_view).toBe('week')
  })

  it('does not take photo as the view to go back to', () => {
    expect(displayStateSchema.safeParse({ last_calendar_view: 'photo' }).success).toBe(false)
  })

  it('keeps an automatic policy that was switched off', () => {
    expect(displayStateSchema.parse({ auto_presence: false })).toMatchObject({ auto_presence: false, auto_brightness: true })
    expect(displayStateSchema.parse({ auto_brightness: false })).toMatchObject({ auto_presence: true, auto_brightness: false })
  })

  it('keeps what a stored document has and defaults the rest', () => {
    const state = displayStateSchema.parse({ view: 'agenda', brightness: 40 })

    expect(state).toMatchObject({ view: 'agenda', brightness: 40, screen: 'on', month: null })
  })

  it('drops keys it no longer knows, so an old document still loads', () => {
    const state = displayStateSchema.parse({ view: 'week', zoom: 2 })

    expect(state).not.toHaveProperty('zoom')
    expect(state.view).toBe('week')
  })

  it('has no preview for a stored document that predates it, and keeps one that is running', () => {
    expect(displayStateSchema.parse({ view: 'week' }).preview).toBeNull()
    expect(displayStateSchema.parse({ preview: { special_day: 'christmas', until: '2026-10-28T12:01:00.000Z' } }).preview).toEqual({ special_day: 'christmas', until: '2026-10-28T12:01:00.000Z' })
    expect(displayStateSchema.parse({ preview: { scene: 'birthday', until: '2026-10-28T12:01:00.000Z' } }).preview).toEqual({ scene: 'birthday', until: '2026-10-28T12:01:00.000Z' })
  })

  it.each([
    ['both a day and a scene', { special_day: 'christmas', scene: 'birthday', until: '2026-10-28T12:01:00.000Z' }],
    ['neither', { until: '2026-10-28T12:01:00.000Z' }],
    ['no until', { special_day: 'christmas' }],
    ['an until that is not an instant', { special_day: 'christmas', until: 'soon' }],
    ['an empty id', { special_day: '', until: '2026-10-28T12:01:00.000Z' }],
  ])('rejects a preview with %s', (_name, preview) => {
    expect(displayStateSchema.safeParse({ preview }).success).toBe(false)
  })

  it('accepts a pinned month and an overlay', () => {
    const stored = {
      month: '2026-12',
      month_set_at: '2026-10-28T10:00:00.000Z',
      overlay: { text: 'Bins out tonight', icon: 'trash', until: '2026-10-28T18:00:00.000Z' },
    }

    expect(displayStateSchema.parse(stored)).toMatchObject(stored)
  })

  it.each([
    ['an unknown view', { view: 'year' }],
    ['a month that is not YYYY-MM', { month: '2026-13' }],
    ['a week that is only a month', { week: '2026-12' }],
    ['a week date that does not exist', { week: '2026-02-31' }],
    ['brightness over 100', { brightness: 101 }],
    ['an empty overlay text', { overlay: { text: ' ', icon: null, until: null } }],
    ['an until that is not an instant', { overlay: { text: 'Hi', icon: null, until: 'tomorrow' } }],
  ])('rejects %s', (_name, stored) => {
    expect(displayStateSchema.safeParse(stored).success).toBe(false)
  })
})

describe('the command schema', () => {
  it.each([
    [{ type: 'set_view', view: 'photo' }],
    [{ type: 'next_view' }],
    [{ type: 'set_month', month: '2026-12' }],
    [{ type: 'set_month', month: 'current' }],
    [{ type: 'set_month', month: 'prev' }],
    [{ type: 'set_month', month: 'next' }],
    [{ type: 'set_week', week: '2026-12-07' }],
    [{ type: 'set_week', week: 'current' }],
    [{ type: 'set_week', week: 'prev' }],
    [{ type: 'set_week', week: 'next' }],
    [{ type: 'set_screen', screen: 'off' }],
    [{ type: 'set_brightness', brightness: 0 }],
    [{ type: 'set_brightness', brightness: 100 }],
    [{ type: 'set_photo_source', photo_source: 'local' }],
    [{ type: 'set_auto_presence', auto_presence: false }],
    [{ type: 'set_auto_presence', auto_presence: true }],
    [{ type: 'set_auto_brightness', auto_brightness: false }],
    [{ type: 'set_auto_brightness', auto_brightness: true }],
    [{ type: 'set_schedule', schedule: 'daytime-photos', on: false }],
    [{ type: 'set_overlay', overlay: { text: 'Bins out tonight' } }],
    [{ type: 'set_overlay', overlay: { text: 'Bins out tonight', icon: 'trash', ttl: 3600 } }],
    [{ type: 'set_overlay', overlay: null }],
    [{ type: 'photo_next' }],
    [{ type: 'toggle_photo' }],
    [{ type: 'refresh' }],
    [{ type: 'preview_special_day', id: 'christmas', seconds: 60 }],
    [{ type: 'preview_special_day', scene: 'birthday', seconds: 5 }],
    [{ type: 'preview_special_day', id: 'christmas', seconds: 600 }],
  ])('accepts %j', (command) => {
    expect(commandSchema.parse(command)).toEqual(command)
  })

  it('trims an overlay text', () => {
    expect(commandSchema.parse({ type: 'set_overlay', overlay: { text: '  Hi  ' } })).toEqual({ type: 'set_overlay', overlay: { text: 'Hi' } })
  })

  it.each([
    ['an unknown type', { type: 'explode' }],
    ['no type', { view: 'month' }],
    ['not an object', 'next_view'],
    ['an extra key', { type: 'next_view', view: 'month' }],
    ['a misspelt key', { type: 'set_view', veiw: 'month' }],
    ['an unknown view', { type: 'set_view', view: 'year' }],
    ['a month with the wrong number', { type: 'set_month', month: '2026-13' }],
    ['a month without a leading zero', { type: 'set_month', month: '2026-1' }],
    ['an unknown month word', { type: 'set_month', month: 'last' }],
    ['a week that is only a month', { type: 'set_week', week: '2026-12' }],
    ['a date that does not exist', { type: 'set_week', week: '2026-02-31' }],
    ['a date with a month 13', { type: 'set_week', week: '2026-13-01' }],
    ['an unknown week word', { type: 'set_week', week: 'last' }],
    ['a week with no value', { type: 'set_week' }],
    ['brightness over 100', { type: 'set_brightness', brightness: 101 }],
    ['brightness under 0', { type: 'set_brightness', brightness: -1 }],
    ['fractional brightness', { type: 'set_brightness', brightness: 1.5 }],
    ['brightness as a string', { type: 'set_brightness', brightness: '50' }],
    ['an unknown photo source', { type: 'set_photo_source', photo_source: 'flickr' }],
    ['auto_presence as a string', { type: 'set_auto_presence', auto_presence: 'ON' }],
    ['auto_presence missing', { type: 'set_auto_presence' }],
    ['a misspelt auto_presence', { type: 'set_auto_presence', auto_presense: true }],
    ['auto_brightness as a number', { type: 'set_auto_brightness', auto_brightness: 1 }],
    ['a set_schedule without on', { type: 'set_schedule', schedule: 'mornings' }],
    ['a set_schedule with a bad id', { type: 'set_schedule', schedule: 'Morning Agenda', on: true }],
    ['the internal schedule_start', { type: 'schedule_start', schedule: 'mornings', rule: 0, view: 'agenda' }],
    ['the internal schedule_end', { type: 'schedule_end', schedule: 'mornings', rule: 0 }],
    ['an extra key on set_auto_brightness', { type: 'set_auto_brightness', auto_brightness: true, brightness: 50 }],
    ['a zero ttl', { type: 'set_overlay', overlay: { text: 'Hi', ttl: 0 } }],
    ['a ttl over a week', { type: 'set_overlay', overlay: { text: 'Hi', ttl: 604801 } }],
    ['an empty overlay text', { type: 'set_overlay', overlay: { text: '' } }],
    ['an extra overlay key', { type: 'set_overlay', overlay: { text: 'Hi', until: null } }],
    ['a missing overlay', { type: 'set_overlay' }],
    ['a preview of neither a day nor a scene', { type: 'preview_special_day' }],
    ['a preview of both a day and a scene', { type: 'preview_special_day', id: 'christmas', scene: 'birthday' }],
    ['a preview with an empty id', { type: 'preview_special_day', id: '  ' }],
    ['a preview with an empty scene', { type: 'preview_special_day', scene: '' }],
    ['a preview under 5 seconds', { type: 'preview_special_day', id: 'christmas', seconds: 4 }],
    ['a preview over 600 seconds', { type: 'preview_special_day', id: 'christmas', seconds: 601 }],
    ['a fractional preview length', { type: 'preview_special_day', id: 'christmas', seconds: 5.5 }],
    ['a preview length as a string', { type: 'preview_special_day', id: 'christmas', seconds: '60' }],
    ['a misspelt preview key', { type: 'preview_special_day', special_day: 'christmas' }],
  ])('rejects %s', (_name, command) => {
    expect(commandSchema.safeParse(command).success).toBe(false)
  })

  it('previews for a minute when it is not told how long, and trims the id', () => {
    expect(commandSchema.parse({ type: 'preview_special_day', id: ' christmas ' })).toEqual({ type: 'preview_special_day', id: 'christmas', seconds: DEFAULT_PREVIEW_SECONDS })
    expect(DEFAULT_PREVIEW_SECONDS).toBe(60)
  })

  it('says what is wrong with a preview that names neither or both', () => {
    for (const command of [{ type: 'preview_special_day' }, { type: 'preview_special_day', id: 'a', scene: 'b' }]) {
      expect(commandSchema.safeParse(command).error?.issues[0]?.message).toBe('needs exactly one of id and scene')
    }
  })
})

describe('months', () => {
  it('names the current month on the wall in the given zone', () => {
    // 23:30 UTC on the last day of September is already October in London (BST).
    const instant = new Date('2026-09-30T23:30:00Z')

    expect(currentMonth(instant, 'Europe/London')).toBe('2026-10')
    expect(currentMonth(instant, 'UTC')).toBe('2026-09')
    expect(currentMonth(instant, 'America/New_York')).toBe('2026-09')
  })

  it('does not depend on the process time zone', () => {
    // The unit tests run in Pacific/Auckland, which is already into 2027 here.
    expect(currentMonth(new Date('2026-12-31T12:00:00Z'), 'Europe/London')).toBe('2026-12')
  })

  it('adds months across a year boundary, forwards and back', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2027-01', -1)).toBe('2026-12')
    expect(addMonths('2026-10', 14)).toBe('2027-12')
    expect(addMonths('2026-10', -24)).toBe('2024-10')
    expect(addMonths('2026-10', 0)).toBe('2026-10')
  })

  it('counts the months between two', () => {
    expect(monthDiff('2026-10', '2026-10')).toBe(0)
    expect(monthDiff('2026-12', '2027-01')).toBe(1)
    expect(monthDiff('2027-01', '2026-12')).toBe(-1)
    expect(monthDiff('2025-10', '2027-10')).toBe(24)
  })
})

describe('views', () => {
  it('lists the week by part of day view, and steps through it last', () => {
    expect(VIEWS).toEqual(['month', 'week', 'week_parts', 'agenda', 'photo', 'night'])
    expect(NEXT_VIEW_ORDER).toEqual(['month', 'agenda', 'week', 'week_parts'])
    expect(RETURN_VIEWS).toContain('week_parts')
    expect(commandSchema.parse({ type: 'set_view', view: 'week_parts' })).toEqual({ type: 'set_view', view: 'week_parts' })
  })

  it('has the default parts of the day', () => {
    expect(DEFAULT_DAY_PARTS).toEqual({ afternoon: 12, evening: 17 })
  })
})

describe('weeks', () => {
  it('finds the first day of the week that holds a date', () => {
    // Wed 28 October 2026.
    expect(firstDayOfWeek('2026-10-28', 'monday')).toBe('2026-10-26')
    expect(firstDayOfWeek('2026-10-28', 'sunday')).toBe('2026-10-25')
    expect(firstDayOfWeek('2026-10-26', 'monday')).toBe('2026-10-26')
    expect(firstDayOfWeek('2026-10-25', 'monday')).toBe('2026-10-19')
    expect(firstDayOfWeek('2026-10-25', 'sunday')).toBe('2026-10-25')
  })

  it('lists the views that follow a pinned week, within the views there are', () => {
    expect(WEEK_VIEWS).toEqual(['week', 'week_parts'])
    expect(WEEK_RANGE).toBe(52)
  })

  it('crosses a month and a year', () => {
    expect(firstDayOfWeek('2027-01-01', 'monday')).toBe('2026-12-28')
  })

  it('works out the current week in the display time zone', () => {
    // 23:30 UTC on Sunday 25 October is already Monday 26 October in Auckland.
    const now = new Date('2026-10-25T23:30:00Z')

    expect(currentWeek(now, 'Europe/London', 'monday')).toBe('2026-10-19')
    expect(currentWeek(now, 'Pacific/Auckland', 'monday')).toBe('2026-10-26')
  })

  it('moves by whole weeks and counts the distance', () => {
    expect(addWeeks('2026-10-26', 1)).toBe('2026-11-02')
    expect(addWeeks('2026-10-26', -52)).toBe('2025-10-27')
    expect(weekDiff('2026-10-26', '2026-12-07')).toBe(6)
    expect(weekDiff('2026-10-26', '2026-10-12')).toBe(-2)
  })
})
