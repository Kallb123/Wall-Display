import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import NightView from '~/components/views/NightView.vue'
import { nightPosition } from '~/utils/night'
import { NO_SPECIAL_DAYS } from '~/utils/views'
import type { ViewProps } from '~/utils/views'
import type { CalendarEvent } from '../../shared/types/events'

// The night view on its own: its clock, the line under it and where it sits.
// The page's wiring of it is in displayPage.test.ts and the looks are in
// test/visual/night.spec.ts.

// Wed 28 Oct 2026, 22:30 in London (the clocks went back on the 25th, so that is 22:30Z).
const NOW = new Date('2026-10-28T22:30:00Z')

const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  view: 'night', events: [], now: NOW, timezone: 'Europe/London', month: '2026-10', weekStart: 'monday', weather: null, specialDays: NO_SPECIAL_DAYS, ...overrides,
})

function event(changes: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 1, calendar_id: 'family', title: 'Swimming', display_title: 'Swimming', location: null,
    start: '2026-10-29T08:30:00Z', end: '2026-10-29T09:30:00Z', all_day: false, start_date: null, end_date: null,
    people: [{ id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4' }], ...changes,
  }
}

const open = (overrides: Partial<ViewProps> = {}) => mountSuspended(NightView, { props: props(overrides) })
const text = (wrapper: Awaited<ReturnType<typeof open>>) => wrapper.find('[data-testid="night-text"]')

describe('the night view', () => {
  it('is the clock in the display\'s zone and nothing else by default', async () => {
    const wrapper = await open({ weather: { current: { condition: 'sunny', temperature: 9 }, daily: [], temperature_unit: '°C', updated_at: NOW.toISOString() }, events: [event()] })

    expect(wrapper.find('[data-testid="night-clock"]').text()).toBe('22:30')
    expect(text(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-testid="photo-weather"]').exists()).toBe(false)
  })

  it('shows the first event of the next 24 hours, with Tomorrow, when asked', async () => {
    const wrapper = await open({ nightText: 'first_event', events: [event({ id: 2, display_title: 'Later', start: '2026-10-29T15:00:00Z' }), event()] })

    expect(text(wrapper).text()).toBe('Tomorrow 08:30 · Swimming')
    expect(text(wrapper).find('svg').exists()).toBe(false)
  })

  it('leaves out Today for an event this evening', async () => {
    const wrapper = await open({ nightText: 'first_event', events: [event({ start: '2026-10-28T23:15:00Z' })] })

    expect(text(wrapper).text()).toBe('23:15 · Swimming')
  })

  it('shows nothing under the clock for no event, an all-day one or one too far off', async () => {
    const allDay = event({ all_day: true, start_date: '2026-10-29', end_date: '2026-10-30' })
    const far = event({ id: 3, start: '2026-10-30T08:30:00Z' })

    expect(text(await open({ nightText: 'first_event' })).exists()).toBe(false)
    expect(text(await open({ nightText: 'first_event', events: [allDay, far] })).exists()).toBe(false)
  })

  it('shows the alarm with an alarm clock icon when asked', async () => {
    const wrapper = await open({ nightText: 'next_alarm', alarm: '2026-10-29T06:45:00.000Z' })

    expect(text(wrapper).text()).toBe('Tomorrow 06:45')
    expect(text(wrapper).find('svg').classes()).toContain('lucide-alarm-clock-icon')
  })

  it('shows nothing for no alarm, one not heard, or one that has gone', async () => {
    expect(text(await open({ nightText: 'next_alarm', alarm: null })).exists()).toBe(false)
    expect(text(await open({ nightText: 'next_alarm' })).exists()).toBe(false)
    expect(text(await open({ nightText: 'next_alarm', alarm: '2026-10-28T21:00:00.000Z' })).exists()).toBe(false)
  })

  it('does not show the alarm on a display that asked for events, or the events on one that asked for the alarm', async () => {
    const events = [event()]
    const alarm = '2026-10-29T06:45:00.000Z'

    expect(text(await open({ nightText: 'first_event', events, alarm })).text()).toContain('Swimming')
    expect(text(await open({ nightText: 'next_alarm', events, alarm })).text()).toBe('Tomorrow 06:45')
    expect(text(await open({ nightText: 'none', events, alarm })).exists()).toBe(false)
  })

  it('sits where nightPosition says with burn-in on, and in the centre with it off', async () => {
    const spot = nightPosition(NOW)
    expect(spot).not.toEqual({ x: 0, y: 0 })
    const block = (wrapper: Awaited<ReturnType<typeof open>>) => wrapper.find('[data-testid="night-clock"]').element.parentElement!

    const shifted = await open({ burnIn: true })
    expect(block(shifted).style.transform).toBe(`translate(${spot.x}px, ${spot.y}px)`)

    const still = await open({ burnIn: false })
    expect(block(still).style.transform).toBe('translate(0px, 0px)')
    const unsaid = await open()
    expect(block(unsaid).style.transform).toBe('translate(0px, 0px)')
  })
})
