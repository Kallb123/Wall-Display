import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TimerStack from '~/components/TimerStack.vue'
import { formatCountdown, msToNextSecond, timerView, visibleTimers } from '~/utils/timers'
import type { WallTimer } from '../../shared/display'

// The kitchen timers: what a timer draws at a given moment (the pure helpers),
// and the stack of cards that counts down by itself. The page and the socket
// are covered in displayPage.test.ts and socket.test.ts.

const NOW = Date.parse('2026-10-28T09:41:00.000Z')
const at = (secondsFromNow: number) => new Date(NOW + secondsFromNow * 1000).toISOString()

const timer = (changes: Partial<WallTimer> = {}): WallTimer => ({
  id: 'timer.pasta',
  label: 'Pasta',
  status: 'running',
  ends_at: at(300),
  remaining_seconds: null,
  duration_seconds: 600,
  ...changes,
})

describe('formatCountdown', () => {
  it('is m:ss under an hour and h:mm:ss from one', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(7)).toBe('0:07')
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(3599)).toBe('59:59')
    expect(formatCountdown(3600)).toBe('1:00:00')
    expect(formatCountdown(3723)).toBe('1:02:03')
    expect(formatCountdown(36000)).toBe('10:00:00')
  })

  it('is never negative', () => {
    expect(formatCountdown(-5)).toBe('0:00')
  })
})

describe('timerView', () => {
  it('counts a running timer down to its end', () => {
    expect(timerView(timer(), NOW)).toEqual({ label: 'Pasta', text: '5:00', progress: 0.5, phase: 'running' })
  })

  it('rounds the time left up, so it reads 0:01 until it ends', () => {
    expect(timerView(timer({ ends_at: at(0.2) }), NOW).text).toBe('0:01')
    expect(timerView(timer({ ends_at: at(1) }), NOW).text).toBe('0:01')
    expect(timerView(timer({ ends_at: at(1.01) }), NOW).text).toBe('0:02')
    expect(timerView(timer({ ends_at: at(3600) }), NOW).text).toBe('1:00:00')
  })

  it('counts a running timer whose end has passed as finished, for a source that is slow to say so', () => {
    const view = timerView(timer({ ends_at: at(0) }), NOW)

    expect(view).toMatchObject({ text: 'Done', phase: 'finished' })
    expect(timerView(timer({ ends_at: at(-30) }), NOW).phase).toBe('finished')
  })

  it('treats a running timer with no usable end as finished rather than guessing', () => {
    expect(timerView(timer({ ends_at: null }), NOW).phase).toBe('finished')
  })

  it('shows a paused timer at its remaining seconds, whatever the time is', () => {
    const paused = timer({ status: 'paused', ends_at: null, remaining_seconds: 150 })

    expect(timerView(paused, NOW)).toEqual({ label: 'Pasta', text: '2:30', progress: 0.25, phase: 'paused' })
    expect(timerView(paused, NOW + 999_000).text).toBe('2:30')
  })

  it('says Done for a ringing timer and a done one', () => {
    expect(timerView(timer({ status: 'ringing' }), NOW)).toMatchObject({ text: 'Done', phase: 'finished' })
    expect(timerView(timer({ status: 'done', ends_at: at(-10) }), NOW)).toMatchObject({ text: 'Done', phase: 'finished' })
    expect(timerView(timer({ status: 'ringing', ends_at: null }), NOW).phase).toBe('finished')
  })

  it('has no progress without a duration', () => {
    expect(timerView(timer({ duration_seconds: null }), NOW).progress).toBeNull()
    expect(timerView(timer({ status: 'paused', ends_at: null, remaining_seconds: 60, duration_seconds: null }), NOW).progress).toBeNull()
    expect(timerView(timer({ status: 'ringing', duration_seconds: null }), NOW).progress).toBeNull()
  })

  it('keeps progress between 0 and 1', () => {
    expect(timerView(timer({ ends_at: at(900) }), NOW).progress).toBe(1)
    expect(timerView(timer({ status: 'paused', ends_at: null, remaining_seconds: 900 }), NOW).progress).toBe(1)
  })

  it('names a timer with no label, or a blank one, "Timer"', () => {
    expect(timerView(timer({ label: null }), NOW).label).toBe('Timer')
    expect(timerView(timer({ label: '  ' }), NOW).label).toBe('Timer')
    expect(timerView(timer({ label: ' Eggs ' }), NOW).label).toBe('Eggs')
  })
})

describe('visibleTimers', () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => timer({ id: `t${i}` }))

  it('shows up to three and counts the rest', () => {
    expect(visibleTimers(many(2))).toMatchObject({ more: 0, shown: [{ id: 't0' }, { id: 't1' }] })
    expect(visibleTimers(many(3)).more).toBe(0)
    const five = visibleTimers(many(5))
    expect(five.shown.map(t => t.id)).toEqual(['t0', 't1', 't2'])
    expect(five.more).toBe(2)
  })
})

describe('msToNextSecond', () => {
  it('is the wait until the clock reaches its next whole second', () => {
    expect(msToNextSecond(10_250)).toBe(750)
    expect(msToNextSecond(10_000)).toBe(1000)
  })
})

describe('TimerStack', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const mountStack = async (timers: WallTimer[]) => {
    const wrapper = await mountSuspended(TimerStack, { props: { timers } })
    await flushPromises()
    return wrapper
  }
  const times = (wrapper: Awaited<ReturnType<typeof mountStack>>) => wrapper.findAll('[data-testid="timer-time"]').map(el => el.text())

  it('draws nothing without timers', async () => {
    const wrapper = await mountStack([])

    expect(wrapper.find('[data-testid="timer-stack"]').exists()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('draws a running, a paused and a finished card', async () => {
    const wrapper = await mountStack([
      timer({ id: 'a', status: 'ringing', label: 'Eggs' }),
      timer({ id: 'b' }),
      timer({ id: 'c', status: 'paused', ends_at: null, remaining_seconds: 90, label: null }),
    ])

    const cards = wrapper.findAll('[data-testid="timer-card"]')
    expect(cards.map(card => card.attributes('data-phase'))).toEqual(['finished', 'running', 'paused'])
    expect(times(wrapper)).toEqual(['Done', '5:00', '1:30'])
    expect(wrapper.findAll('[data-testid="timer-label"]').map(el => el.text())).toEqual(['Eggs', 'Pasta', 'Timer'])
    expect(cards[2]!.text()).toContain('Paused')
    // The finished card has no bar left to show, the running one is at half and the paused one at 15%.
    expect(wrapper.findAll('[data-testid="timer-bar"]').map(el => el.attributes('style'))).toEqual(['width: 50%;', 'width: 15%;'])
  })

  it('leaves the bar out when the length is not known', async () => {
    const wrapper = await mountStack([timer({ duration_seconds: null })])

    expect(wrapper.find('[data-testid="timer-bar"]').exists()).toBe(false)
  })

  it('shows three cards and a chip for the rest', async () => {
    const wrapper = await mountStack(Array.from({ length: 5 }, (_, i) => timer({ id: `t${i}` })))

    expect(wrapper.findAll('[data-testid="timer-card"]')).toHaveLength(3)
    expect(wrapper.find('[data-testid="timer-more"]').text()).toBe('+2 more')
  })

  it('counts down on its own, on the second', async () => {
    const wrapper = await mountStack([timer({ ends_at: at(3) })])
    expect(times(wrapper)).toEqual(['0:03'])

    await vi.advanceTimersByTimeAsync(1100)
    expect(times(wrapper)).toEqual(['0:02'])

    await vi.advanceTimersByTimeAsync(1000)
    expect(times(wrapper)).toEqual(['0:01'])

    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.find('[data-testid="timer-card"]').attributes('data-phase')).toBe('finished')
    expect(times(wrapper)).toEqual(['Done'])
  })

  it('runs its tick only while there are timers, and stops when it is unmounted', async () => {
    const wrapper = await mountStack([timer()])
    expect(vi.getTimerCount()).toBe(1)

    await wrapper.setProps({ timers: [] })
    await flushPromises()
    expect(vi.getTimerCount()).toBe(0)

    await wrapper.setProps({ timers: [timer()] })
    await flushPromises()
    expect(vi.getTimerCount()).toBe(1)

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('goes quiet for the night view', async () => {
    const wrapper = await mountSuspended(TimerStack, { props: { timers: [timer()], quiet: true } })

    expect(wrapper.find('[data-testid="timer-stack"]').classes()).toContain('quiet')
  })
})
