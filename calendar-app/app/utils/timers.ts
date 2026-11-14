import type { WallTimer } from '../../shared/display'

// What a kitchen timer on the wall draws (the TimerStack component), worked out
// from the timer the server sent and the time now. The server sends a timer
// only when it changes and the wall counts down by itself, so everything here
// takes `now` rather than reading the clock. Pure: no Nuxt or Vue imports.

/** What a card is doing: counting down, held, or over (ringing, or run out). */
export type TimerPhase = 'running' | 'paused' | 'finished'

export interface TimerView {
  /** The timer's own name, or "Timer" when it has none. */
  label: string
  /** The countdown, such as `4:07` or `1:02:03`, or "Done" for a finished timer. */
  text: string
  /** The share of its length still to go, from 0 to 1, or null when the length isn't known. */
  progress: number | null
  phase: TimerPhase
}

/** The most cards shown at once. More than this would cover the view; the rest are counted instead. */
export const MAX_TIMER_CARDS = 3

/** The name a timer without one is given. */
export const FALLBACK_TIMER_LABEL = 'Timer'

/** Whole seconds as `m:ss`, or `h:mm:ss` from an hour. Never negative. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

/** A share of `duration` seconds, kept between 0 and 1, or null when there is no length to share. */
function share(seconds: number, duration: number | null): number | null {
  if (duration === null) return null
  return Math.min(1, Math.max(0, seconds / duration))
}

/**
 * What to draw for `timer` at `now` (milliseconds). A running timer shows its
 * time left rounded up, so it reads 0:01 until it ends and not 0:00 a moment
 * early. One whose end has passed counts as finished at once: the source can
 * take a few seconds to say it is ringing, and the wall shouldn't sit at 0:00
 * meanwhile. A running timer with no usable end can't be counted down, so it is
 * treated the same way.
 */
export function timerView(timer: WallTimer, now: number): TimerView {
  const label = timer.label?.trim() || FALLBACK_TIMER_LABEL
  const finished: TimerView = { label, text: 'Done', progress: share(0, timer.duration_seconds), phase: 'finished' }

  if (timer.status === 'ringing' || timer.status === 'done') return finished

  if (timer.status === 'paused') {
    const seconds = timer.remaining_seconds ?? 0
    return { label, text: formatCountdown(seconds), progress: share(seconds, timer.duration_seconds), phase: 'paused' }
  }

  const ends = timer.ends_at === null ? Number.NaN : Date.parse(timer.ends_at)
  if (Number.isNaN(ends) || ends <= now) return finished
  const seconds = Math.ceil((ends - now) / 1000)
  // The bar goes by the exact time left, not the rounded text, so it moves smoothly between ticks.
  return { label, text: formatCountdown(seconds), progress: share((ends - now) / 1000, timer.duration_seconds), phase: 'running' }
}

/** The cards to draw, in the order the server gave them, and how many more there are than fit. */
export function visibleTimers(timers: readonly WallTimer[], max = MAX_TIMER_CARDS): { shown: WallTimer[], more: number } {
  return { shown: timers.slice(0, max), more: Math.max(0, timers.length - max) }
}

/** The milliseconds until the next whole second of the wall clock, for a tick that lands as the countdown changes. */
export function msToNextSecond(now: number): number {
  return 1000 - (now % 1000)
}
