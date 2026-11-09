<script setup lang="ts">
import type { DisplaySettings } from '../../../shared/display'
import { todayIn } from '../../../shared/dates'
import type { StarChart, StarSettingsBody, StarSettingsEntry } from '../../../shared/stars'
import StarPersonSettings from '~/components/stars/StarPersonSettings.vue'
import StarWeekEditor from '~/components/stars/StarWeekEditor.vue'
import { SERVER_UNREACHABLE } from '~/utils/settings'
import { writeFailure } from '~/utils/specialDayEditor'

// The Stars tab: who has a star chart on the wall, how it counts (a day or a
// week) and what the goal is, and below that this week's stars for everyone
// who has one, with a minus and a plus on each day to put a miscount right.
// Stars are normally given from the phone remote; this is the place to fix
// yesterday. Every write asks for the remote's PIN when there is one.

useHead({ title: 'Stars · Settings' })

const now = useNow(60_000)
const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone)
const weekStart = ref<'monday' | 'sunday'>('monday')

const people = ref<StarSettingsEntry[]>([])
const chart = ref<StarChart>({ people: [], counts: {} })
const loaded = ref(false)
const unreachable = ref(false)
const failure = ref<string | null>(null)
const busy = ref(false)

const pin = usePinRequest(SERVER_UNREACHABLE)
const encode = encodeURIComponent

/** The wall's today and, from the first display, the week's first day. The settings API doesn't carry them, so they come from `/api/displays`. */
const today = computed(() => todayIn(now.value, timezone.value))

async function load() {
  try {
    const [entries, stars] = await Promise.all([
      $fetch<StarSettingsEntry[]>('/api/settings/stars'),
      $fetch<StarChart>('/api/stars'),
    ])
    people.value = entries
    chart.value = stars
    unreachable.value = false
  } catch {
    unreachable.value = true
  } finally {
    loaded.value = true
  }
}

onMounted(async () => {
  void load()
  try {
    const displays = await $fetch<DisplaySettings[]>('/api/displays')
    if (displays[0]) {
      timezone.value = displays[0].timezone
      weekStart.value = displays[0].week_start
    }
  } catch {
    // The browser's zone and a Monday will do.
  }
})

/** Runs one write behind the PIN, and words what goes wrong. `retry` runs once a PIN has been accepted. */
async function write<T>(request: (headers: Record<string, string>) => Promise<T>, done: (value: T) => Promise<void> | void, fallback: string, retry: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  failure.value = null
  try {
    const result = await pin.guard(request, retry)
    if (result) await done(result.value)
  } catch (caught) {
    failure.value = writeFailure(caught, fallback)
    // The lines go back to what the server last said.
    people.value = people.value.map(person => ({ ...person }))
  } finally {
    busy.value = false
  }
}

function saveSettings(personId: string, body: StarSettingsBody): Promise<void> {
  return write(
    headers => $fetch<StarSettingsEntry>(`/api/settings/stars/${encode(personId)}`, { method: 'PUT', headers, body }),
    async (entry) => {
      people.value = people.value.map(person => person.id === entry.id ? entry : person)
      // A chart switched on or off changes who is in the week below.
      chart.value = await $fetch<StarChart>('/api/stars')
    },
    'The server couldn\'t save that',
    () => saveSettings(personId, body),
  )
}

function adjust(personId: string, date: string, delta: 1 | -1): Promise<void> {
  return write(
    headers => $fetch<StarChart>(`/api/stars/${encode(personId)}`, { method: 'POST', headers, body: { delta, date } }),
    (next) => {
      chart.value = next
    },
    'The server couldn\'t change the stars',
    () => adjust(personId, date, delta),
  )
}
</script>

<template>
  <div class="stars-page" data-testid="stars-page">
    <p class="intro">
      A star chart rewards someone for their stars: switch it on for each person who wants one. It shows on the wall wherever a layout has the Stars component, and stars are given from the remote.
    </p>

    <SettingsNotice v-if="unreachable" tone="error" data-testid="stars-unreachable">
      {{ SERVER_UNREACHABLE }}
    </SettingsNotice>
    <SettingsNotice v-if="failure" tone="error" data-testid="stars-error">
      {{ failure }}
    </SettingsNotice>

    <SettingsCard v-if="people.length > 0" aria-labelledby="stars-people-title">
      <h2 id="stars-people-title" class="heading">
        People
      </h2>
      <ul class="people" data-testid="star-people">
        <StarPersonSettings v-for="entry in people" :key="entry.id" :entry="entry" :busy="busy" @save="saveSettings" />
      </ul>
    </SettingsCard>
    <SettingsCard v-else-if="loaded && !unreachable">
      <p class="empty" data-testid="stars-no-people">
        There is nobody to give stars to yet: add people under <code>people</code> in config.yaml.
      </p>
    </SettingsCard>

    <SettingsCard v-if="chart.people.length > 0" aria-labelledby="stars-week-title">
      <h2 id="stars-week-title" class="heading">
        This week
      </h2>
      <StarWeekEditor :chart="chart" :today="today" :week-start="weekStart" :busy="busy" @adjust="adjust" />
    </SettingsCard>

    <SettingsPinDialog
      v-if="pin.pinNeeded.value"
      :message="pin.pinMessage.value"
      :checking="pin.checkingPin.value"
      @submit="pin.submitPin"
      @cancel="pin.cancelPin"
    />
  </div>
</template>

<style scoped>
.stars-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.intro {
  margin: 0;
  color: var(--muted);
  font-size: 17px;
  font-weight: 500;
}

.heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 400;
}

.people {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
}

.empty {
  margin: 0;
  color: var(--muted);
  font-size: 17px;
}
</style>
