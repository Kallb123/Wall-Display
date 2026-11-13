import { MONTH_RANGE, WEEK_RANGE, currentMonth, currentWeek, monthDiff, weekDiff } from '../../shared/display'
import type { CommandInput, DisplaySettings, DisplayState } from '../../shared/display'
import { monthCommandFor, monthOptions, weekCommandFor, weekOptions } from '~/utils/remote'

/**
 * What the remote's "Month shown" and "Week shown" sections need: the options
 * on offer, the one on the wall (or the current one, if none is pinned), how far
 * that is from now, and what a pick or a step asks of the wall. Nothing here
 * decides anything: it turns the state into what the pickers show, and a tap into a command.
 */
export function useRemotePickers(
  settings: Ref<DisplaySettings | null>,
  state: Ref<DisplayState | null>,
  now: Ref<Date>,
  send: (command: CommandInput) => Promise<boolean>,
) {
  const pinnedMonth = computed(() => state.value?.month ?? null)
  const currentMonthKey = computed(() => settings.value ? currentMonth(now.value, settings.value.timezone) : null)
  const shownMonth = computed(() => pinnedMonth.value ?? currentMonthKey.value)
  const monthChoices = computed(() => currentMonthKey.value ? monthOptions(currentMonthKey.value) : [])
  const monthOffset = computed(() => currentMonthKey.value && shownMonth.value ? monthDiff(currentMonthKey.value, shownMonth.value) : 0)

  function pickMonth(event: Event) {
    if (!currentMonthKey.value) return
    const target = (event.target as HTMLSelectElement).value
    void send({ type: 'set_month', month: monthCommandFor(target, currentMonthKey.value) })
  }

  const pinnedWeek = computed(() => state.value?.week ?? null)
  const currentWeekKey = computed(() => settings.value ? currentWeek(now.value, settings.value.timezone, settings.value.week_start) : null)
  const shownWeek = computed(() => pinnedWeek.value ?? currentWeekKey.value)
  const weekChoices = computed(() => currentWeekKey.value ? weekOptions(currentWeekKey.value) : [])
  const weekOffset = computed(() => currentWeekKey.value && shownWeek.value ? weekDiff(currentWeekKey.value, shownWeek.value) : 0)

  function pickWeek(event: Event) {
    if (!currentWeekKey.value) return
    const target = (event.target as HTMLSelectElement).value
    void send({ type: 'set_week', week: weekCommandFor(target, currentWeekKey.value) })
  }

  return {
    month: {
      options: monthChoices,
      shown: shownMonth,
      pinned: computed(() => pinnedMonth.value !== null),
      atStart: computed(() => monthOffset.value <= -MONTH_RANGE),
      atEnd: computed(() => monthOffset.value >= MONTH_RANGE),
      pick: pickMonth,
      step: (to: 'prev' | 'next' | 'current') => void send({ type: 'set_month', month: to }),
    },
    week: {
      options: weekChoices,
      shown: shownWeek,
      pinned: computed(() => pinnedWeek.value !== null),
      atStart: computed(() => weekOffset.value <= -WEEK_RANGE),
      atEnd: computed(() => weekOffset.value >= WEEK_RANGE),
      pick: pickWeek,
      step: (to: 'prev' | 'next' | 'current') => void send({ type: 'set_week', week: to }),
    },
  }
}
