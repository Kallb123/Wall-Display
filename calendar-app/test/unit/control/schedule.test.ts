import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DisplayState, View } from '../../../shared/display'
import { defaultDisplayState, reduceCommand } from '../../../server/control/commands'
import type { ControlCommand } from '../../../server/control/commands'
import { boundariesBetween, createSchedulePolicy, nextBoundaryAfter, occurrenceOn, ruleInProgress } from '../../../server/control/schedule'
import type { PolicySchedule, SchedulePolicy } from '../../../server/control/schedule'
import { MAX_TIMER_MS } from '../../../server/control/service'
import type { LayoutComponent } from '../../../shared/layouts'

// The schedule maths in Europe/London (while the process itself runs in
// Auckland), then the policy with a fake control, which applies commands with the
// real reducer, and fake timers. The clock is the fake timers' clock.

const TZ = 'Europe/London'
const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const

type Rule = PolicySchedule['rules'][number]

function rule(from: string, to: string, extra: Partial<Rule> = {}): Rule {
  return { view: 'agenda', from, to, days: [...ALL], ...extra }
}

function schedule(id: string, rules: Rule[], name = id): PolicySchedule {
  return { id, name, rules }
}

const iso = (date: Date | null | undefined) => date?.toISOString()
const day = (year: number, month: number, dayOfMonth: number) => ({ year, month, day: dayOfMonth })

describe('occurrenceOn', () => {
  it('opens a window on the day, in the zone\'s clock', () => {
    const occurrence = occurrenceOn(rule('06:30', '09:00'), TZ, day(2026, 7, 1))

    // British Summer Time is an hour ahead of UTC.
    expect(iso(occurrence?.start)).toBe('2026-07-01T05:30:00.000Z')
    expect(iso(occurrence?.end)).toBe('2026-07-01T08:00:00.000Z')
  })

  it('runs through midnight when from is after to, and days names the day it starts', () => {
    const night = rule('22:00', '02:00', { days: ['fri'] })

    const friday = occurrenceOn(night, TZ, day(2026, 10, 30))
    expect(iso(friday?.start)).toBe('2026-10-30T22:00:00.000Z')
    expect(iso(friday?.end)).toBe('2026-10-31T02:00:00.000Z')
    // Saturday morning is the end of Friday's window, not a window of its own.
    expect(occurrenceOn(night, TZ, day(2026, 10, 31))).toBeNull()
  })

  it('carries the end into the next month and year', () => {
    expect(iso(occurrenceOn(rule('23:00', '01:00'), TZ, day(2026, 12, 31))?.end)).toBe('2027-01-01T01:00:00.000Z')
  })

  it('does not run on a day it is not listed for', () => {
    const weekdays = rule('10:00', '16:00', { days: [...WEEKDAYS] })

    expect(occurrenceOn(weekdays, TZ, day(2026, 10, 28))).not.toBeNull() // Wednesday
    expect(occurrenceOn(weekdays, TZ, day(2026, 10, 31))).toBeNull() // Saturday
    expect(occurrenceOn(weekdays, TZ, day(2026, 11, 1))).toBeNull() // Sunday
  })

  describe('on the day the clocks go forward (Sunday 29 March 2026, 01:00 becomes 02:00)', () => {
    it('measures a window across the change by the clock on the wall', () => {
      const occurrence = occurrenceOn(rule('00:30', '03:00'), TZ, day(2026, 3, 29))

      expect(iso(occurrence?.start)).toBe('2026-03-29T00:30:00.000Z')
      expect(iso(occurrence?.end)).toBe('2026-03-29T02:00:00.000Z') // 03:00 BST
    })

    it('moves a time the clocks skip forward by the gap, and skips a window that ends no later than it starts', () => {
      // 01:30 does not exist, so it is 02:30 BST, which is also where the end falls.
      expect(occurrenceOn(rule('01:30', '02:30'), TZ, day(2026, 3, 29))).toBeNull()

      const occurrence = occurrenceOn(rule('01:30', '04:00'), TZ, day(2026, 3, 29))
      expect(iso(occurrence?.start)).toBe('2026-03-29T01:30:00.000Z') // 02:30 BST
      expect(iso(occurrence?.end)).toBe('2026-03-29T03:00:00.000Z')
    })

    it('makes the night before a short one', () => {
      const occurrence = occurrenceOn(rule('22:00', '06:00'), TZ, day(2026, 3, 28))

      expect(iso(occurrence?.start)).toBe('2026-03-28T22:00:00.000Z')
      expect(iso(occurrence?.end)).toBe('2026-03-29T05:00:00.000Z') // 06:00 BST
    })
  })

  describe('on the day the clocks go back (Sunday 25 October 2026, 02:00 becomes 01:00)', () => {
    it('takes the first of a time shown twice', () => {
      const occurrence = occurrenceOn(rule('01:30', '02:30'), TZ, day(2026, 10, 25))

      expect(iso(occurrence?.start)).toBe('2026-10-25T00:30:00.000Z') // 01:30 BST
      expect(iso(occurrence?.end)).toBe('2026-10-25T02:30:00.000Z') // 02:30 GMT
    })

    it('makes the night before a long one', () => {
      const occurrence = occurrenceOn(rule('22:00', '06:00'), TZ, day(2026, 10, 24))

      expect(iso(occurrence?.start)).toBe('2026-10-24T21:00:00.000Z') // 22:00 BST
      expect(iso(occurrence?.end)).toBe('2026-10-25T06:00:00.000Z')
    })
  })
})

describe('ruleInProgress', () => {
  const morning = rule('06:30', '09:00')

  it('includes the start and excludes the end', () => {
    expect(ruleInProgress(morning, TZ, new Date('2026-10-28T06:29:59Z'))).toBe(false)
    expect(ruleInProgress(morning, TZ, new Date('2026-10-28T06:30:00Z'))).toBe(true)
    expect(ruleInProgress(morning, TZ, new Date('2026-10-28T08:59:59Z'))).toBe(true)
    expect(ruleInProgress(morning, TZ, new Date('2026-10-28T09:00:00Z'))).toBe(false)
  })

  it('knows a window that began yesterday', () => {
    const night = rule('22:00', '02:00', { days: ['tue'] })

    expect(ruleInProgress(night, TZ, new Date('2026-10-28T00:30:00Z'))).toBe(true) // Wednesday, half past midnight
    expect(ruleInProgress(night, TZ, new Date('2026-10-28T02:00:00Z'))).toBe(false)
    expect(ruleInProgress(night, TZ, new Date('2026-10-29T00:30:00Z'))).toBe(false) // Wednesday's window was never listed
  })

  it('reads the date on the wall of the zone, not in UTC', () => {
    const lateEvening = rule('23:30', '23:45', { days: ['wed'] })

    expect(ruleInProgress(lateEvening, TZ, new Date('2026-07-01T22:40:00Z'))).toBe(true) // 23:40 BST on Wednesday 1 July
    expect(ruleInProgress(lateEvening, TZ, new Date('2026-07-01T23:40:00Z'))).toBe(false)
  })
})

describe('boundariesBetween', () => {
  const instants = (found: ReturnType<typeof boundariesBetween>) => found.map(b => `${b.kind} ${b.scheduleIndex}.${b.ruleIndex} ${iso(b.at)}`)

  it('lists starts and ends in the interval by instant', () => {
    const found = boundariesBetween(
      [schedule('a', [rule('06:30', '09:00')]), schedule('b', [rule('08:00', '08:30')])],
      TZ,
      new Date('2026-10-28T00:00:00Z'),
      new Date('2026-10-28T23:59:59Z'),
    )

    expect(instants(found)).toEqual([
      'start 0.0 2026-10-28T06:30:00.000Z',
      'start 1.0 2026-10-28T08:00:00.000Z',
      'end 1.0 2026-10-28T08:30:00.000Z',
      'end 0.0 2026-10-28T09:00:00.000Z',
    ])
  })

  it('is half open: the end of the interval counts, its start does not', () => {
    const schedules = [schedule('a', [rule('06:30', '09:00')])]
    const found = boundariesBetween(schedules, TZ, new Date('2026-10-28T06:30:00Z'), new Date('2026-10-28T09:00:00Z'))

    expect(instants(found)).toEqual(['end 0.0 2026-10-28T09:00:00.000Z'])
    expect(boundariesBetween(schedules, TZ, new Date('2026-10-28T09:00:00Z'), new Date('2026-10-28T09:00:00Z'))).toEqual([])
    expect(boundariesBetween(schedules, TZ, new Date('2026-10-28T10:00:00Z'), new Date('2026-10-28T09:00:00Z'))).toEqual([])
  })

  it('puts starts before ends at the same instant, then config order', () => {
    const found = boundariesBetween(
      [
        schedule('a', [rule('06:30', '09:00')]),
        schedule('b', [rule('09:00', '16:00', { view: 'photo' }), rule('09:00', '10:00')]),
        schedule('c', [rule('08:00', '09:00')]),
      ],
      TZ,
      new Date('2026-10-28T08:30:00Z'),
      new Date('2026-10-28T09:00:00Z'),
    )

    expect(instants(found)).toEqual([
      'start 1.0 2026-10-28T09:00:00.000Z',
      'start 1.1 2026-10-28T09:00:00.000Z',
      'end 0.0 2026-10-28T09:00:00.000Z',
      'end 2.0 2026-10-28T09:00:00.000Z',
    ])
  })

  it('includes the end of a window that began before the interval, and not its start', () => {
    const found = boundariesBetween([schedule('a', [rule('22:00', '02:00')])], TZ, new Date('2026-10-28T01:00:00Z'), new Date('2026-10-28T03:00:00Z'))

    expect(instants(found)).toEqual(['end 0.0 2026-10-28T02:00:00.000Z'])
  })

  it('has no boundary for a window skipped on a clock change day', () => {
    const found = boundariesBetween([schedule('a', [rule('01:30', '02:30')])], TZ, new Date('2026-03-29T00:00:00Z'), new Date('2026-03-29T23:00:00Z'))

    expect(found).toEqual([])
  })

  it('keeps wall-clock times across a clock change', () => {
    const found = boundariesBetween([schedule('a', [rule('07:00', '08:00')])], TZ, new Date('2026-03-27T12:00:00Z'), new Date('2026-03-30T12:00:00Z'))

    expect(found.filter(b => b.kind === 'start').map(b => iso(b.at))).toEqual([
      '2026-03-28T07:00:00.000Z',
      '2026-03-29T06:00:00.000Z', // BST from here on
      '2026-03-30T06:00:00.000Z',
    ])
  })

  it('only has the days listed', () => {
    const found = boundariesBetween([schedule('a', [rule('10:00', '16:00', { days: [...WEEKDAYS] })])], TZ, new Date('2026-10-30T00:00:00Z'), new Date('2026-11-02T00:00:00Z'))

    expect(found.filter(b => b.kind === 'start').map(b => iso(b.at))).toEqual(['2026-10-30T10:00:00.000Z'])
  })
})

describe('nextBoundaryAfter', () => {
  it('finds the next boundary after an instant, not at it', () => {
    const schedules = [schedule('a', [rule('06:30', '09:00')])]

    expect(iso(nextBoundaryAfter(schedules, TZ, new Date('2026-10-28T05:00:00Z'))?.at)).toBe('2026-10-28T06:30:00.000Z')
    expect(iso(nextBoundaryAfter(schedules, TZ, new Date('2026-10-28T06:30:00Z'))?.at)).toBe('2026-10-28T09:00:00.000Z')
    expect(iso(nextBoundaryAfter(schedules, TZ, new Date('2026-10-28T09:00:00Z'))?.at)).toBe('2026-10-29T06:30:00.000Z')
  })

  it('looks across a weekend, or a whole week', () => {
    const weekdays = [schedule('a', [rule('10:00', '16:00', { days: [...WEEKDAYS] })])]
    const mondayOnly = [schedule('a', [rule('10:00', '16:00', { days: ['mon'] })])]

    expect(iso(nextBoundaryAfter(weekdays, TZ, new Date('2026-10-30T16:00:00Z'))?.at)).toBe('2026-11-02T10:00:00.000Z')
    expect(iso(nextBoundaryAfter(mondayOnly, TZ, new Date('2026-10-26T16:00:00Z'))?.at)).toBe('2026-11-02T10:00:00.000Z')
  })

  it('is null when there are no schedules or no rules', () => {
    expect(nextBoundaryAfter([], TZ, new Date('2026-10-28T05:00:00Z'))).toBeNull()
    expect(nextBoundaryAfter([schedule('a', [])], TZ, new Date('2026-10-28T05:00:00Z'))).toBeNull()
  })
})

// --- The policy ---

/** Wed 28 Oct 2026, 05:00 in London (GMT). */
const START = new Date('2026-10-28T05:00:00Z')

interface Setup {
  schedules?: PolicySchedule[]
  displays?: { id: string, schedules: PolicySchedule[] }[]
  state?: Partial<DisplayState>
  /** The custom layouts there are (PR 5.17). Default: none. */
  layouts?: { id: string, name: string, components: LayoutComponent[] }[]
  /** Whether the policy is told which layouts exist, so it can skip a rule for one that does not. Default: yes. */
  checkLayouts?: boolean
  /** The clock the policy reads, if it should differ from the timers' (a delayed timer). */
  now?: () => Date
}

function setup(options: Setup = {}) {
  const displays = options.displays ?? [{ id: 'hallway', schedules: options.schedules ?? [] }]
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const states = new Map(displays.map(display => [display.id, { ...defaultDisplayState(), ...options.state }]))
  const applied: { displayId: string, command: ControlCommand }[] = []
  const failures = new Set<string>()

  const control = {
    getState: vi.fn((displayId: string): DisplayState => states.get(displayId)!),
    applyCommand: vi.fn((displayId: string, command: ControlCommand): DisplayState => {
      applied.push({ displayId, command })
      if (failures.has(command.type)) throw new Error('disk full')
      const next = reduceCommand(states.get(displayId)!, command, { now: new Date(), timeZone: TZ, monthReturnMinutes: 15, weekStart: 'monday', photosConfigured: true, layouts: options.layouts ?? [] })
      states.set(displayId, next)
      return next
    }),
  }
  const policy = createSchedulePolicy({ displays, timeZone: TZ, control, log, ...(options.checkLayouts === false ? {} : { layoutIds: () => (options.layouts ?? []).map(layout => layout.id) }), ...(options.now ? { now: options.now } : {}) })
  policies.push(policy)

  const view = (displayId = 'hallway') => states.get(displayId)!.view
  /** Someone else changes the display (HA, the button, the remote). */
  const change = (command: ControlCommand, displayId = 'hallway') => control.applyCommand(displayId, command)
  /** The schedule commands the policy sent, as `start id` / `end id`. */
  const sent = () => applied.filter(({ command }) => command.type.startsWith('schedule_')).map(({ displayId, command }) =>
    `${displayId} ${command.type === 'schedule_start' ? 'start' : 'end'} ${'schedule' in command ? command.schedule : ''}`)
  return { policy, control, log, view, change, sent, states, failures, applied }
}

const policies: SchedulePolicy[] = []

/** Moves the fake clock to an instant, running every timer due on the way. */
function advanceTo(instant: string) {
  vi.advanceTimersByTime(Date.parse(instant) - Date.now())
}

beforeEach(() => {
  vi.useFakeTimers({ now: START })
})

afterEach(() => {
  for (const policy of policies.splice(0)) policy.stop()
  vi.useRealTimers()
})

const mornings = schedule('mornings', [rule('06:30', '09:00')], 'Morning agenda')
const daytime = schedule('daytime-photos', [rule('10:00', '16:00', { view: 'photo', days: [...WEEKDAYS] })], 'Daytime photos')

describe('a window', () => {
  it('shows the view at the start and goes back to the one before at the end', () => {
    const { view, log } = setup({ schedules: [mornings], state: { view: 'week' } })

    advanceTo('2026-10-28T06:29:59Z')
    expect(view()).toBe('week')
    advanceTo('2026-10-28T06:30:00Z')
    expect(view()).toBe('agenda')
    advanceTo('2026-10-28T08:59:59Z')
    expect(view()).toBe('agenda')
    advanceTo('2026-10-28T09:00:00Z')
    expect(view()).toBe('week')

    expect(log.info.mock.calls.map(call => call[0])).toEqual([
      '[schedule] hallway: Morning agenda (06:30–09:00) starts, so the wall shows agenda',
      '[schedule] hallway: Morning agenda (06:30–09:00) ends, so the wall goes back to week',
    ])
  })

  it('comes round again the next day, and keeps to the wall clock when the clocks change', () => {
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'))
    const { view } = setup({ schedules: [schedule('early', [rule('06:30', '09:00')])] })

    // The clocks go back at 02:00 on Sunday 25 October; 06:30 is then 06:30 GMT, an hour later in UTC.
    advanceTo('2026-10-25T05:31:00Z')
    expect(view()).toBe('month')
    advanceTo('2026-10-25T06:31:00Z')
    expect(view()).toBe('agenda')
  })

  it('does not touch the wall when it is already on the rule\'s view, so the end does not move it', () => {
    const { view, log } = setup({ schedules: [mornings], state: { view: 'agenda' } })

    advanceTo('2026-10-28T06:30:00Z')
    advanceTo('2026-10-28T09:00:00Z')

    expect(view()).toBe('agenda')
    expect(log.info).not.toHaveBeenCalled()
  })

  it('leaves a manual change alone until the next boundary, which then applies again', () => {
    const { view, change } = setup({ schedules: [mornings] })

    advanceTo('2026-10-28T06:30:00Z')
    expect(view()).toBe('agenda')
    change({ type: 'set_view', view: 'week' })
    advanceTo('2026-10-28T09:00:00Z')
    expect(view()).toBe('week') // the end did nothing

    advanceTo('2026-10-29T06:30:00Z')
    expect(view()).toBe('agenda') // tomorrow's start applies again
    advanceTo('2026-10-29T09:00:00Z')
    expect(view()).toBe('week') // back to the view from before it
  })

  it('does not log when someone had already chosen the view', () => {
    const { log, change } = setup({ schedules: [mornings] })
    change({ type: 'set_view', view: 'agenda' })

    advanceTo('2026-10-28T06:30:00Z')

    expect(log.info).not.toHaveBeenCalled()
  })

  it('runs a window past midnight, on the day it starts', () => {
    const night = schedule('night', [rule('22:00', '02:00', { view: 'photo', days: ['wed'] })])
    const { view } = setup({ schedules: [night] })

    advanceTo('2026-10-28T22:00:00Z')
    expect(view()).toBe('photo')
    advanceTo('2026-10-29T02:00:00Z')
    expect(view()).toBe('month')
    // Thursday's window was never listed.
    advanceTo('2026-10-29T22:00:00Z')
    expect(view()).toBe('month')
  })

  it('does not run on days it is not listed for', () => {
    vi.setSystemTime(new Date('2026-10-30T05:00:00Z')) // Friday
    const { view } = setup({ schedules: [daytime] })

    advanceTo('2026-10-30T10:00:00Z')
    expect(view()).toBe('photo')
    advanceTo('2026-10-30T16:00:00Z')
    expect(view()).toBe('month')
    advanceTo('2026-10-31T10:00:00Z') // Saturday
    expect(view()).toBe('month')
    advanceTo('2026-11-02T10:00:00Z') // Monday
    expect(view()).toBe('photo')
  })
})

describe('windows that meet', () => {
  it('goes straight from one to the next at the same instant, and back to the view before the first', () => {
    const photos = schedule('daytime', [rule('09:00', '16:00', { view: 'photo' })], 'Daytime')
    const { view, applied, log } = setup({ schedules: [mornings, photos], state: { view: 'week' } })

    advanceTo('2026-10-28T09:00:00Z')

    expect(view()).toBe('photo')
    // The second start comes first, so the wall never shows the view in between.
    expect(applied.map(({ command }) => command.type)).toEqual(['schedule_start', 'schedule_start', 'schedule_end'])
    expect(applied.map(({ command }) => 'schedule' in command ? command.schedule : '')).toEqual(['mornings', 'daytime', 'mornings'])
    expect(log.info.mock.calls.map(call => call[0])).toEqual([
      '[schedule] hallway: Morning agenda (06:30–09:00) starts, so the wall shows agenda',
      '[schedule] hallway: Daytime (09:00–16:00) starts, so the wall shows photo',
    ])

    advanceTo('2026-10-28T16:00:00Z')
    expect(view()).toBe('week')
  })

  it('chains overlapping windows, whichever ends first', () => {
    const wide = schedule('wide', [rule('06:00', '10:00')])
    const inside = schedule('inside', [rule('08:00', '09:00', { view: 'photo' })])
    const { view } = setup({ schedules: [wide, inside], state: { view: 'week' } })

    advanceTo('2026-10-28T06:00:00Z')
    expect(view()).toBe('agenda')
    advanceTo('2026-10-28T08:00:00Z')
    expect(view()).toBe('photo')
    advanceTo('2026-10-28T09:00:00Z')
    expect(view()).toBe('week')
    advanceTo('2026-10-28T10:00:00Z')
    expect(view()).toBe('week')
  })
})

describe('turning a schedule off', () => {
  it('skips its boundaries, and the next start after it is turned on applies', () => {
    const { view, sent, change } = setup({ schedules: [mornings], state: { schedules_off: ['mornings'] } })

    advanceTo('2026-10-28T09:00:00Z')
    expect(view()).toBe('month')
    expect(sent()).toEqual([])

    change({ type: 'set_schedule', schedule: 'mornings', on: true })
    advanceTo('2026-10-29T06:30:00Z')
    expect(view()).toBe('agenda')
  })

  it('does not undo a window by turning it off, and does not end it afterwards', () => {
    const { view, sent, change } = setup({ schedules: [mornings] })

    advanceTo('2026-10-28T06:30:00Z')
    change({ type: 'set_schedule', schedule: 'mornings', on: false })
    advanceTo('2026-10-28T09:00:00Z')

    expect(view()).toBe('agenda')
    expect(sent()).toEqual(['hallway start mornings'])
  })

  it('only skips the schedule that is off', () => {
    const { view } = setup({ schedules: [mornings, daytime], state: { schedules_off: ['mornings'], view: 'week' } })

    advanceTo('2026-10-28T06:30:00Z')
    expect(view()).toBe('week')
    advanceTo('2026-10-28T10:00:00Z')
    expect(view()).toBe('photo')
  })
})

describe('the timer', () => {
  it('is one for every display, set for the next boundary of any of them', () => {
    setup({
      displays: [
        { id: 'hallway', schedules: [mornings] },
        { id: 'kitchen', schedules: [schedule('early', [rule('06:00', '07:00', { view: 'photo' })])] },
        { id: 'garage', schedules: [] },
      ],
    })

    expect(vi.getTimerCount()).toBe(1)
    advanceTo('2026-10-28T06:00:00Z')
    expect(vi.getTimerCount()).toBe(1)
  })

  it('applies each display\'s own schedules', () => {
    const { states } = setup({
      displays: [
        { id: 'hallway', schedules: [mornings] },
        { id: 'kitchen', schedules: [schedule('early', [rule('06:00', '07:00', { view: 'photo' })])] },
        { id: 'garage', schedules: [] },
      ],
    })

    advanceTo('2026-10-28T06:30:00Z')

    expect([...states].map(([id, state]) => `${id} ${state.view}`)).toEqual(['hallway agenda', 'kitchen photo', 'garage month'])
  })

  it('does not exist when no display has a schedule', () => {
    const { control } = setup({ displays: [{ id: 'hallway', schedules: [] }, { id: 'kitchen', schedules: [] }] })

    expect(vi.getTimerCount()).toBe(0)
    expect(control.getState).toHaveBeenCalled() // stale windows are still checked, once
  })

  it('does not wait longer than the control\'s timers, and looks again when it ends', () => {
    const mondays = schedule('mondays', [rule('10:00', '16:00', { days: ['mon'] })])
    const { view, control } = setup({ schedules: [mondays] })
    control.applyCommand.mockClear()

    advanceTo(new Date(START.getTime() + MAX_TIMER_MS - 1).toISOString())
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1)
    expect(control.applyCommand).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)

    advanceTo('2026-11-02T10:00:00Z')
    expect(view()).toBe('agenda')
  })

  it('is cancelled by stop, which also stops it applying anything', () => {
    const { policy, view } = setup({ schedules: [mornings] })

    policy.stop()

    expect(vi.getTimerCount()).toBe(0)
    advanceTo('2026-10-28T07:00:00Z')
    expect(view()).toBe('month')
  })
})

describe('a timer that is early or late', () => {
  it('processes the boundaries a delayed timer missed, once, in order', () => {
    // The timers run on time, but the policy's clock says it is 09:30 when the first one fires.
    let skew = 0
    const { view, sent, log } = setup({ schedules: [mornings], now: () => new Date(Date.now() + skew), state: { view: 'week' } })
    skew = 2 * 60 * 60_000 + 59 * 60_000 // 09:29 by the policy's clock when the 06:30 timer fires
    advanceTo('2026-10-28T06:30:00Z')

    expect(sent()).toEqual(['hallway start mornings', 'hallway end mornings'])
    expect(view()).toBe('week')
    expect(log.info).toHaveBeenCalledTimes(2)

    // Nothing is repeated when the next timer fires.
    advanceTo('2026-10-28T09:00:00Z')
    expect(sent()).toHaveLength(2)
  })

  it('does nothing for a timer that fires a moment before its boundary, and then waits for it', () => {
    let skew = 0
    const { sent, view } = setup({ schedules: [mornings], now: () => new Date(Date.now() + skew) })
    skew = -5

    advanceTo('2026-10-28T06:30:00Z')
    expect(sent()).toEqual([])
    expect(vi.getTimerCount()).toBe(1)

    skew = 0
    vi.advanceTimersByTime(5)
    expect(sent()).toEqual(['hallway start mornings'])
    expect(view()).toBe('agenda')
  })
})

describe('a failing command', () => {
  it('is logged, and the boundaries after it still apply', () => {
    const other = schedule('other', [rule('06:30', '07:00', { view: 'photo' })])
    const { failures, sent, log, view } = setup({ schedules: [mornings, other] })
    failures.add('schedule_end')

    advanceTo('2026-10-28T07:00:00Z') // other ends and fails
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0]![0]).toContain('disk full')
    expect(log.error.mock.calls[0]![0]).toContain('hallway')

    failures.clear()
    advanceTo('2026-10-28T09:00:00Z')
    expect(sent().at(-1)).toBe('hallway end mornings')
    expect(view()).not.toBe('agenda')
  })
})

describe('at start', () => {
  const held = { schedule: 'mornings', rule: 0, view: 'agenda' as View, return_view: 'week' as View }

  it('leaves a window that is still in progress', () => {
    vi.setSystemTime(new Date('2026-10-28T07:00:00Z'))
    const { view, sent } = setup({ schedules: [mornings], state: { view: 'agenda', schedule: held } })

    expect(view()).toBe('agenda')
    expect(sent()).toEqual([])
  })

  it('ends a window whose end passed while the app was down', () => {
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'))
    const { view, log, states } = setup({ schedules: [mornings], state: { view: 'agenda', schedule: held } })

    expect(view()).toBe('week')
    expect(states.get('hallway')!.schedule).toBeNull()
    expect(log.info).toHaveBeenCalledWith('[schedule] hallway: Morning agenda (06:30–09:00) ends, so the wall goes back to week')
  })

  it('ends a window whose schedule has gone from the config, even on a display with no schedules', () => {
    vi.setSystemTime(new Date('2026-10-28T07:00:00Z'))
    const { view, log } = setup({ schedules: [], state: { view: 'agenda', schedule: held } })

    expect(view()).toBe('week')
    expect(log.info).toHaveBeenCalledWith('[schedule] hallway: mornings ends, so the wall goes back to week')
  })

  it('ends a window whose rule index no longer exists, or whose view differs from the rule now', () => {
    vi.setSystemTime(new Date('2026-10-28T07:00:00Z'))

    expect(setup({ schedules: [mornings], state: { view: 'agenda', schedule: { ...held, rule: 3 } } }).view()).toBe('week')
    expect(setup({ schedules: [schedule('mornings', [rule('06:30', '09:00', { view: 'photo' })])], state: { view: 'agenda', schedule: held } }).view()).toBe('week')
  })

  it('does not catch up a start it missed, so a choice made before the restart stays', () => {
    vi.setSystemTime(new Date('2026-10-28T07:00:00Z'))
    const { view, sent } = setup({ schedules: [mornings], state: { view: 'week' } })

    expect(view()).toBe('week')
    expect(sent()).toEqual([])
    advanceTo('2026-10-28T09:00:00Z') // the end finds no window to end
    expect(view()).toBe('week')
    expect(sent()).toEqual(['hallway end mornings'])
  })

  it('counts boundaries only after it started, so one exactly then is not applied', () => {
    vi.setSystemTime(new Date('2026-10-28T06:30:00Z'))
    const { view } = setup({ schedules: [mornings] })

    advanceTo('2026-10-28T06:30:00Z')
    expect(view()).toBe('month')
  })
})

// PR 5.17: rules that show a custom layout.
describe('a window on a custom layout', () => {
  const kitchen = { id: 'kitchen', name: 'Kitchen', components: ['week', 'agenda'] as LayoutComponent[] }
  const evenings = schedule('evenings', [rule('17:00', '21:00', { view: 'custom', layout: 'kitchen' })], 'Kitchen board')

  it('shows the layout at the start and goes back to the view and layout from before at the end', () => {
    const { view, states, log } = setup({ schedules: [evenings], layouts: [kitchen], state: { view: 'week' } })

    advanceTo('2026-10-28T17:00:00Z')
    expect(view()).toBe('custom')
    expect(states.get('hallway')).toMatchObject({ layout: 'kitchen', schedule: { layout: 'kitchen', return_view: 'week', return_layout: null } })
    advanceTo('2026-10-28T21:00:00Z')
    expect(states.get('hallway')).toMatchObject({ view: 'week', layout: null, schedule: null })

    expect(log.info.mock.calls.map(call => call[0])).toEqual([
      '[schedule] hallway: Kitchen board (17:00–21:00) starts, so the wall shows custom layout kitchen',
      '[schedule] hallway: Kitchen board (17:00–21:00) ends, so the wall goes back to week',
    ])
  })

  it('sends the layout with the start', () => {
    const { applied } = setup({ schedules: [evenings], layouts: [kitchen] })

    advanceTo('2026-10-28T17:00:00Z')

    expect(applied[0]!.command).toEqual({ type: 'schedule_start', schedule: 'evenings', rule: 0, view: 'custom', layout: 'kitchen' })
  })

  it('sends the rule\'s photo feed with the start, and none when the rule names none', () => {
    const feed = schedule('daytime', [rule('10:00', '16:00', { view: 'photo', photo_feed: 'mountains' })])
    const { applied, states } = setup({ schedules: [feed], state: { view: 'month' } })

    advanceTo('2026-10-28T10:00:00Z')

    expect(applied[0]!.command).toEqual({ type: 'schedule_start', schedule: 'daytime', rule: 0, view: 'photo', photo_feed: 'mountains' })
    expect(states.get('hallway')).toMatchObject({ view: 'photo', schedule: { photo_feed: 'mountains' } })
  })

  it('skips a rule whose layout does not exist, with a warning, and does not touch the wall', () => {
    const { view, applied, log } = setup({ schedules: [evenings], layouts: [], state: { view: 'week' } })

    advanceTo('2026-10-28T17:00:00Z')

    expect(view()).toBe('week')
    expect(applied).toEqual([])
    expect(log.warn).toHaveBeenCalledWith('[schedule] hallway: Kitchen board (17:00–21:00) shows layout "kitchen", which does not exist, so it is skipped')
  })

  it('still lets the control refuse a layout that has gone when the policy is not told the layouts', () => {
    const { view } = setup({ schedules: [evenings], layouts: [], checkLayouts: false, state: { view: 'week' } })

    advanceTo('2026-10-28T17:00:00Z')

    expect(view()).toBe('week')
  })

  it('ends a window the app left behind when its rule now names another layout', () => {
    vi.setSystemTime(new Date('2026-10-28T18:00:00Z'))
    const held = { schedule: 'evenings', rule: 0, view: 'custom' as View, return_view: 'week' as View, layout: 'board', return_layout: null }
    const { states } = setup({ schedules: [evenings], layouts: [kitchen], state: { view: 'custom', layout: 'board', schedule: held } })

    expect(states.get('hallway')).toMatchObject({ view: 'week', schedule: null })
  })

  it('leaves a window in progress that names the same layout', () => {
    vi.setSystemTime(new Date('2026-10-28T18:00:00Z'))
    const held = { schedule: 'evenings', rule: 0, view: 'custom' as View, return_view: 'week' as View, layout: 'kitchen', return_layout: null }
    const { states } = setup({ schedules: [evenings], layouts: [kitchen], state: { view: 'custom', layout: 'kitchen', schedule: held } })

    expect(states.get('hallway')).toMatchObject({ view: 'custom', layout: 'kitchen' })
  })
})
