<script setup lang="ts">
import { formatWeekday } from '~/utils/format'
import { todayIn } from '~/utils/eventRanges'
import { fitPanelDay } from '~/utils/monthPanel'
import { personFill } from '~/utils/themes'
import type { ViewProps } from '../../utils/views'
import { monthLayout } from '../../../shared/month-layout'
import type { DayCell, ItemPeople } from '../../../shared/month-layout'

// The month in the Soft style (mocks 1c and 1d, architecture §4.4): the month
// title above a sage panel for today and the next three days on the left, and
// five rows of rounded day tiles on the right. The layout (which event goes in
// which lane, where "+N more" and the veils go, what the panel lists) is worked
// out by `monthLayout`; this only draws it, and fits the panel's days to the
// room there is. The grid shows `month`, which the server can pin to another
// month; the panel always starts at today.
//
// Three slots are left for a special day (architecture §6.2, PR S.3), each drawn
// only when filled: `tile-art` in a tile's top-right corner (given its `cell`),
// `greeting` at the top of the panel and `panel-art` at the bottom of it.
const props = defineProps<ViewProps>()

const today = computed(() => todayIn(props.now, props.timezone))

const layout = computed(() => monthLayout({
  month: props.month,
  today: today.value,
  timeZone: props.timezone,
  weekStart: props.weekStart,
  events: props.events,
}))

/** The panel's days, each trimmed to the rows that fit. Only the first is today, so only it has events that are over. */
const panelDays = computed(() => layout.value.panel.map((day, index) => fitPanelDay(day, props.now, index === 0)))

/** `October`, from the month itself: the shown month is not always the one `now` is in. */
const monthName = computed(() => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' }).format(new Date(`${props.month}-01T00:00:00Z`)))
const year = computed(() => props.month.slice(0, 4))

const dayNumber = computed(() => Number(today.value.slice(8, 10)))
const weekday = computed(() => formatWeekday(props.now, props.timezone))

/** A tile's background: today's own, the month's, or the neighbouring months'. */
function tileBackground(cell: DayCell): string {
  return cell.today ? 'var(--today-cell)' : cell.inMonth ? 'var(--tile)' : 'var(--tile-out)'
}

function numberColours(cell: DayCell): { background: string, color: string } {
  if (cell.today) return { background: 'var(--today-num-bg)', color: 'var(--today-num-fg)' }
  return { background: 'transparent', color: cell.inMonth ? 'var(--text)' : 'var(--faint)' }
}

/** The badges an item gets: its first people, as many as the layout kept initials for. Keyed by person, as two can share an initial. */
function badgesOf(item: ItemPeople): { id: string, initial: string, colour: string }[] {
  return item.initials.map((initial, index) => ({ id: item.people[index]!.id, initial, colour: item.people[index]!.colour }))
}

/** A bar's fill. With nobody on it (no person matched) it is the surface colour and has no badge. */
const barFill = (colour: string | null): string => colour ? personFill(colour) : 'var(--surface)'

function barStyle(bar: { colour: string | null, column: number, span: number, lane: number, roundStart: boolean, roundEnd: boolean }) {
  const start = bar.roundStart ? '999px' : '8px'
  const end = bar.roundEnd ? '999px' : '8px'
  return {
    'gridColumn': `${bar.column + 1} / span ${bar.span}`,
    'gridRow': bar.lane + 2,
    // A round end sits in from the tile's edge; a square one runs on into its neighbour.
    'margin': `0 ${bar.roundEnd ? '8px' : '0'} 0 ${bar.roundStart ? '8px' : '0'}`,
    'borderRadius': `${start} ${end} ${end} ${start}`,
    'background': barFill(bar.colour),
    '--ring': barFill(bar.colour),
  }
}
</script>

<template>
  <section class="view" data-testid="month-view">
    <div class="side">
      <h1 class="title" data-testid="month-title">
        <!-- The space is for the text ("October 2026"); between flex items it takes no room. -->
        <span class="month">{{ monthName }}</span>{{ ' ' }}<span class="year">{{ year }}</span>
      </h1>

      <div class="panel" data-testid="panel">
        <div v-if="$slots.greeting" class="greeting">
          <slot name="greeting" />
        </div>

        <div class="now">
          <div class="big-date" data-testid="panel-date">
            {{ dayNumber }}
          </div>
          <div class="weekday">
            {{ weekday }}
            <!-- PR 2.7: the current conditions go here, an icon and "12° · Light showers", under the weekday. -->
          </div>
        </div>

        <div class="days">
          <section v-for="day in panelDays" :key="day.date" class="day" data-testid="panel-day" :data-date="day.date">
            <header class="day-head">
              <h2 class="day-label">
                {{ day.label }}
              </h2>
              <!-- PR 2.7: the day's weather icon and high / low go at the right of the heading. -->
            </header>

            <p v-if="!day.rows.length && !day.more" class="nothing">
              Nothing planned
            </p>

            <div v-else class="rows">
              <div
                v-for="row in day.rows"
                :key="row.item.event.id"
                class="row"
                :class="{ past: row.past }"
                data-kind="panel"
                data-testid="event"
              >
                <span class="badges">
                  <span
                    v-for="badge in badgesOf(row.item)"
                    :key="badge.id"
                    class="badge"
                    :style="{ background: badge.colour }"
                  >{{ badge.initial }}</span>
                </span>
                <span class="time">{{ row.item.time ?? 'All day' }}</span>
                <span class="name">{{ row.item.event.display_title }}</span>
              </div>
              <div v-if="day.more" class="row more-row" data-testid="panel-more">
                <span class="badges" />
                <span class="time">+{{ day.more }} more</span>
              </div>
            </div>
          </section>
        </div>

        <div v-if="$slots['panel-art']" class="panel-art">
          <slot name="panel-art" />
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="weekdays">
        <div v-for="name in layout.weekdays" :key="name" class="weekday-name">
          {{ name }}
        </div>
      </div>

      <div class="weeks">
        <div v-for="(week, weekIndex) in layout.rows" :key="weekIndex" class="week">
          <template v-for="cell in week.cells" :key="cell.date">
            <div
              class="tile"
              :style="{ gridColumn: cell.column + 1, background: tileBackground(cell) }"
              data-testid="day-tile"
              :data-date="cell.date"
              :data-today="cell.today"
            />
            <div v-if="$slots['tile-art']" class="tile-art" :style="{ gridColumn: cell.column + 1 }">
              <slot name="tile-art" :cell="cell" />
            </div>
            <div class="date" :style="{ gridColumn: cell.column + 1 }">
              <span class="number" :style="numberColours(cell)" :data-testid="cell.today ? 'today-number' : undefined">{{ cell.day }}</span>
            </div>
          </template>

          <div
            v-for="bar in week.bars"
            :key="`${bar.event.id}-${bar.column}`"
            class="bar"
            :style="barStyle(bar)"
            data-testid="event"
            data-kind="bar"
          >
            <span v-if="bar.initials.length" class="badges">
              <span
                v-for="badge in badgesOf(bar)"
                :key="badge.id"
                class="badge"
                :style="{ background: badge.colour }"
              >{{ badge.initial }}</span>
            </span>
            <span class="name">{{ bar.event.display_title }}</span>
          </div>

          <div
            v-for="row in week.timed"
            :key="row.event.id"
            class="timed"
            data-kind="timed"
            :style="{ gridColumn: row.column + 1, gridRow: row.lane + 2, '--ring': tileBackground(week.cells[row.column]!) }"
            data-testid="event"
          >
            <span v-if="row.initials.length" class="badges">
              <span
                v-for="badge in badgesOf(row)"
                :key="badge.id"
                class="badge"
                :style="{ background: badge.colour }"
              >{{ badge.initial }}</span>
            </span>
            <span class="time">{{ row.time }}</span>
            <span class="name">{{ row.event.display_title }}</span>
          </div>

          <div
            v-for="more in week.more"
            :key="more.column"
            class="more"
            :style="{ gridColumn: more.column + 1, gridRow: more.lane + 2 }"
            data-testid="more"
          >
            +{{ more.count }} more
          </div>

          <!-- Last, so it is over the tiles and what is on them. -->
          <div
            v-for="veil in week.veils"
            :key="veil.column"
            class="veil"
            :style="{ gridColumn: `${veil.column + 1} / span ${veil.span}` }"
            data-testid="veil"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Sizes are px on the 2560×1440 stage, taken from the Soft mock. */
.view {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 640px minmax(0, 1fr);
  gap: 48px;
  padding: 48px;
  overflow: hidden;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 0;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 20px;
  margin: 0;
  padding-left: 12px;
  font-family: var(--font-display);
  font-weight: 400;
  line-height: 1;
}

.month {
  font-size: 88px;
  letter-spacing: -0.02em;
}

.year {
  color: var(--muted);
  font-size: 44px;
}

.panel {
  box-sizing: border-box;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 36px;
  min-height: 0;
  padding: 44px 48px;
  overflow: hidden;
  border-radius: 64px;
  background: var(--panel);
  color: var(--panel-text);
}

/* Pulled up a little: the display face's line box leaves a gap above the date. */
.greeting {
  margin-bottom: -12px;
  font-family: var(--font-display);
  font-size: 56px;
  line-height: 1;
}

.now {
  display: flex;
  align-items: center;
  gap: 28px;
}

.big-date {
  font-family: var(--font-display);
  font-size: 184px;
  letter-spacing: -0.03em;
  line-height: 0.85;
}

.weekday {
  font-family: var(--font-display);
  font-size: 44px;
  line-height: 1;
}

.days {
  display: flex;
  flex-direction: column;
  gap: 30px;
  min-height: 0;
}

.day {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.day-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.day-label {
  margin: 0;
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: 400;
  line-height: 1.1;
}

/* A day's rows share their columns (a subgrid), so the times line up even when an event has several badges or "Until 11:30" is wider than "09:00". */
.rows {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  row-gap: 10px;
}

.row {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  column-gap: 14px;
  font-size: 26px;
  line-height: 1.3;
  --ring: var(--panel);
}

.row.past {
  opacity: 0.45;
}

.row .time {
  min-width: 100px;
  color: var(--panel-muted);
  font-size: 23px;
  font-weight: 700;
}

.row .name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The badge column is at least one badge wide, so an event with nobody on it still lines up. */
.row .badges {
  min-width: 40px;
  min-height: 40px;
  align-items: center;
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--color-neutral-900);
  font-size: 19px;
  font-weight: 700;
}

.badges {
  display: flex;
  flex: none;
}

/* Overlapping circles for an event shared by several people, ringed in whatever they sit on. */
.badge + .badge {
  margin-left: -12px;
}

.badges:has(.badge + .badge) .badge {
  box-shadow: 0 0 0 3px var(--ring);
}

.nothing {
  margin: 0;
  color: var(--panel-muted);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.3;
}

/* Bleeds to the panel's edges, as the mock's does, so a scene can fill the bottom. */
.panel-art {
  flex: none;
  margin: auto -48px -44px;
  pointer-events: none;
}

.grid {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  column-gap: 14px;
  padding: 6px 0 12px;
  color: var(--muted);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.1em;
  /* The mock's text inherits the design system's 1.6, which is what puts the first row of tiles where it is. */
  line-height: 1.6;
  text-transform: uppercase;
}

.weekday-name {
  padding-left: 20px;
}

.weeks {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

/* The date, then four lanes for events, then whatever room is left. Everything in the week is placed on this one grid, so a bar can run across tiles. */
.week {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-template-rows: 52px repeat(4, 34px) 1fr;
  column-gap: 14px;
  row-gap: 5px;
}

.tile {
  grid-row: 1 / -1;
  border-radius: 32px;
}

/* Over the top-right of a tile, for a special day's art. It never takes a click or pushes anything. */
.tile-art {
  grid-row: 1 / 3;
  align-self: start;
  justify-self: end;
  padding: 8px 14px 0 0;
  pointer-events: none;
}

.date {
  display: flex;
  grid-row: 1;
  align-items: center;
  padding: 6px 0 0 10px;
}

.number {
  display: grid;
  place-items: center;
  min-width: 40px;
  height: 40px;
  border-radius: 999px;
  font-size: 27px;
  font-weight: 700;
}

.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0 14px 0 4px;
  overflow: hidden;
  color: var(--bar-text);
  font-size: 20px;
  font-weight: 700;
  white-space: nowrap;
}

.bar .badge,
.timed .badge {
  width: 24px;
  height: 24px;
  font-size: 14px;
}

.bar .badge + .badge,
.timed .badge + .badge {
  margin-left: -8px;
}

.bar .badges:has(.badge + .badge) .badge,
.timed .badges:has(.badge + .badge) .badge {
  box-shadow: 0 0 0 2px var(--ring);
}

.bar .name,
.timed .name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.timed {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 12px;
  overflow: hidden;
  font-size: 20px;
  white-space: nowrap;
}

.timed .time {
  flex: none;
  color: var(--muted);
  font-weight: 700;
}

.timed .name {
  font-weight: 600;
}

.more {
  display: flex;
  align-items: center;
  padding: 0 16px;
  color: var(--accent-ink);
  font-size: 20px;
  font-weight: 700;
}

.veil {
  grid-row: 1 / -1;
  border-radius: 32px;
  background: var(--veil);
  pointer-events: none;
}
</style>
