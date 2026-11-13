<script setup lang="ts">
import { badgesOf } from '~/utils/monthPanel'
import type { LaneSpans } from '~/utils/monthPanel'
import { eventLabel } from '~/utils/eventLabel'
import { monthBarStyle, cellWeatherOf, numberColours, tileBackground, monthTimedStyle } from '~/utils/monthSoft'
import type { Decorations } from '~/utils/monthSoft'
import type { WeekRow } from '../../../../shared/month-layout'
import { specialDayArtUrl } from '../../../../shared/special-days'
import type { WeatherSnapshot } from '../../../../shared/weather'

// One week of the month grid. The date, then the lanes for events, then whatever
// room is left: everything in the week (the tiles, their art and date rows, the
// bars across them, the timed rows, "+N more" and the veils over the days that
// are out of reach) is placed on this one grid, so a bar can run across tiles.
// Which lane each is in is worked out by `monthLayout`; this draws it.
//
// The portrait rules below rely on the view's `.portrait` class on an ancestor.
const props = defineProps<{
  week: WeekRow
  /** This week's lane spans for wrapping titles, or null when the option is off. */
  spans: LaneSpans | null
  decorated: Decorations
  weather: WeatherSnapshot | null
  today: string
  portrait: boolean
  /** "Colour whole events": timed rows get the pill a bar has. */
  fillEvents: boolean
  /** Whether coloured events show their people's initials. */
  showInitials: boolean
  /** Whether a tile shows its forecast, and whether that is the icon alone. */
  cellWeather: boolean
  compactTiles: boolean
}>()

const weatherOf = (date: string) => cellWeatherOf(date, props.weather, props.today, {
  shown: props.cellWeather,
  compact: props.compactTiles,
  hasArt: !!props.decorated.get(date)?.art.length,
})
</script>

<template>
  <div class="week">
    <template v-for="cell in week.cells" :key="cell.date">
      <div
        class="tile"
        :style="{ gridColumn: cell.column + 1, background: tileBackground(cell, decorated) }"
        data-testid="day-tile"
        :data-date="cell.date"
        :data-today="cell.today"
        :data-special="decorated.get(cell.date)?.id"
      />
      <div v-if="decorated.get(cell.date)?.art.length" class="tile-art" :style="{ gridColumn: cell.column + 1 }">
        <img
          v-for="(name, index) in decorated.get(cell.date)!.art"
          :key="`${name}-${index}`"
          :src="specialDayArtUrl(name)"
          alt=""
          draggable="false"
          data-testid="tile-art"
        >
      </div>
      <div class="date" :style="{ gridColumn: cell.column + 1 }">
        <span class="number" :style="numberColours(cell)" :data-testid="cell.today ? 'today-number' : undefined">{{ cell.day }}</span>
        <span v-if="weatherOf(cell.date)" class="cell-weather" data-testid="cell-weather" :data-date="cell.date">
          <AppIcon v-if="weatherOf(cell.date)!.icon" :icon="weatherOf(cell.date)!.icon!" :size="30" />
          <span v-if="weatherOf(cell.date)!.text">{{ weatherOf(cell.date)!.text }}</span>
        </span>
      </div>
    </template>

    <div
      v-for="(bar, barIndex) in week.bars"
      :key="`${bar.event.id}-${bar.column}`"
      class="bar"
      :style="monthBarStyle(bar, spans?.bars[barIndex])"
      :class="{ tall: (spans?.bars[barIndex] ?? 1) > 1 }"
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
      <span class="name">{{ eventLabel(bar.event) }}</span>
    </div>

    <div
      v-for="(row, rowIndex) in week.timed"
      :key="row.event.id"
      class="timed"
      :class="{ tall: (spans?.timed[rowIndex] ?? 1) > 1, filled: fillEvents, bare: fillEvents && (!row.initials.length || !showInitials) }"
      data-kind="timed"
      :style="monthTimedStyle(row, tileBackground(week.cells[row.column]!, decorated), fillEvents, spans?.timed[rowIndex])"
      data-testid="event"
    >
      <span v-if="row.initials.length && showInitials" class="badges">
        <span
          v-for="badge in badgesOf(row)"
          :key="badge.id"
          class="badge"
          :style="{ background: badge.colour }"
        >{{ badge.initial }}</span>
      </span>
      <span v-if="!portrait" class="time">{{ row.time }}</span>
      <span class="name">{{ eventLabel(row.event) }}</span>
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
</template>

<style scoped>
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

/*
 * The top-right of a tile, beside the date number, for a special day's art. It
 * sits in the date's row, which is 52 px, and the 60 px art runs a few px into
 * the first lane: the bars and times come later in the grid so they paint over
 * it, and nothing is pushed. Art from several days sits side by side.
 */
.tile-art {
  display: flex;
  grid-row: 1;
  align-items: flex-start;
  align-self: start;
  justify-self: end;
  gap: 6px;
  padding: 0 14px 0 0;
  pointer-events: none;
}

.tile-art img {
  display: block;
  width: auto;
  max-width: 96px;
  height: 60px;
  object-fit: contain;
}

.date {
  display: flex;
  grid-row: 1;
  align-items: center;
  padding: 6px 0 0 10px;
}

.number {
  display: grid;
  flex: none;
  place-items: center;
  min-width: 40px;
  height: 40px;
  border-radius: 999px;
  font-size: 27px;
  font-weight: 700;
}

/* The forecast at the right end of the date row: it may shrink and clip itself, never the day number. */
.cell-weather {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-left: auto;
  padding-right: 16px;
  overflow: hidden;
  color: var(--muted);
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.cell-weather svg {
  flex: none;
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

/* "Colour whole events": a pill like a bar, text on the fill, the time a step quieter but still readable on it. */
.timed.filled {
  padding: 0 14px 0 4px;
  color: var(--bar-text);
}

.timed.filled.bare {
  padding-left: 12px;
}

.timed.filled .time {
  color: inherit;
  opacity: 0.8;
}

/*
 * "Wrap long titles" in the grid: an item that was given the free lanes below
 * its own is as tall as its title needs, from the top of its lane, up to the
 * lanes it has (--lines of them, which --lines of 26 px lines and 4 px above and
 * below fit). Its first line is where it always was: 4 px down, in a 26 px line
 * box, centres in a 34 px lane, and a one-line title is the 34 px it was.
 */
.bar.tall,
.timed.tall {
  align-self: start;
  align-items: flex-start;
  box-sizing: border-box;
  min-height: 34px;
  max-height: 100%;
  padding-top: 4px;
  padding-bottom: 4px;
}

.tall .badges {
  margin-top: 1px;
}

.tall .time,
.tall .name {
  line-height: 26px;
}

/* Broken only between words: a tile is narrow enough that breaking anywhere cut "Playgroup" into "Playgr" and "oup". A word too long for the tile is clipped, as it was before wrapping. */
.tall .name {
  display: -webkit-box;
  overflow-wrap: normal;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--lines);
  line-clamp: var(--lines);
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

/*
 * The portrait stage: six lanes where landscape has four. The lanes may be a
 * little under their 34 px when the band is tall (a takeover's greeting makes it
 * so), so that six still fit; at the mock's 290 px tiles they are the full 34.
 */
.portrait .week {
  min-height: 0;
  grid-template-rows: 52px repeat(6, minmax(28px, 34px)) 1fr;
}
</style>
