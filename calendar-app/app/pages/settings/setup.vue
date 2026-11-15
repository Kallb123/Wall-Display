<script setup lang="ts">
import { Lock, WifiOff } from 'lucide-vue-next'
import type { SetupStatus } from '../../../shared/settings'
import {
  SERVER_UNREACHABLE,
  buttonActionLabel,
  cameraKindLabel,
  commandLabel,
  daysLabel,
  displayNames,
  lengthLabel,
  pollLabel,
  triggerWhenLabel,
  viewLabel,
} from '~/utils/settings'

// The Setup tab: everything else config.yaml sets up that the other tabs don't
// show (schedules, the button, kitchen timers, cameras, triggers, the
// connections and the rest), so the settings page lists every option. None of
// it can be changed here yet: it is read once from the config, and each card
// names the block to edit.

useHead({ title: 'Setup · Settings' })

const setup = ref<SetupStatus | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    setup.value = await $fetch<SetupStatus>('/api/settings/setup')
  } catch {
    failed.value = true
  }
})

const displayName = (id: string) => setup.value?.displays.find(display => display.id === id)?.name ?? id
const cameraName = (id: string) => setup.value?.cameras.find(camera => camera.id === id)?.name ?? id
const personName = (id: string) => setup.value?.people.find(person => person.id === id)?.name ?? id

const schedulesByDisplay = computed(() => (setup.value?.schedules ?? []).filter(entry => entry.schedules.length > 0))

const GESTURES = [
  { key: 'single', label: 'Single press' },
  { key: 'double', label: 'Double press' },
  { key: 'long', label: 'Long press' },
] as const
</script>

<template>
  <div class="setup">
    <div class="toolbar">
      <p class="intro">
        The rest of what <code>config.yaml</code> sets up. These can only be changed in the config for now; each card names the block to edit.
      </p>
      <p class="readonly">
        <AppIcon :icon="Lock" :size="18" />
        Read only
      </p>
    </div>

    <p v-if="failed" class="unreachable" role="status" data-testid="unreachable">
      <AppIcon :icon="WifiOff" :size="20" />
      {{ SERVER_UNREACHABLE }}
    </p>
    <p v-else-if="!setup" class="empty" data-testid="loading">
      Loading&hellip;
    </p>

    <template v-if="setup">
      <SettingsCard data-testid="setup-general">
        <header class="head">
          <h2 class="name">
            General
          </h2>
          <p class="where">
            <code>timezone</code>, <code>sync</code>, <code>remote</code>, <code>homeassistant</code> and <code>mqtt</code>
          </p>
        </header>
        <dl class="rows">
          <div class="row">
            <dt>Time zone</dt>
            <dd data-testid="setup-timezone">
              {{ setup.timezone }}
            </dd>
          </div>
          <div class="row">
            <dt>Events kept</dt>
            <dd data-testid="setup-sync">
              {{ setup.sync.months_back }} months back, {{ setup.sync.months_ahead }} ahead
            </dd>
          </div>
          <div class="row">
            <dt>PIN for changes</dt>
            <dd data-testid="setup-pin">
              {{ setup.remote_pin ? 'Set' : 'Not set' }}
            </dd>
          </div>
          <div class="row">
            <dt>Home Assistant</dt>
            <dd data-testid="setup-homeassistant">
              {{ setup.homeassistant ? setup.homeassistant.host ?? 'Set up' : 'Not set up' }}
            </dd>
          </div>
          <div class="row">
            <dt>MQTT broker</dt>
            <dd data-testid="setup-mqtt">
              <template v-if="setup.mqtt">
                {{ setup.mqtt.broker }}
                <span class="sub">
                  Client {{ setup.mqtt.client_id }} · {{ setup.mqtt.signs_in ? 'Signs in' : 'No sign-in' }} ·
                  {{ setup.mqtt.discovery ? `Discovery under ${setup.mqtt.discovery_prefix}` : 'Discovery off' }}
                </span>
              </template>
              <template v-else>
                Not set up
              </template>
            </dd>
          </div>
        </dl>
      </SettingsCard>

      <SettingsCard data-testid="setup-people">
        <header class="head">
          <h2 class="name">
            People and groups
          </h2>
          <p class="where">
            <code>people</code> and <code>groups</code>
          </p>
        </header>
        <ul class="list">
          <li v-for="person in setup.people" :key="person.id" class="item" data-testid="setup-person">
            <SettingsPersonBadge :person="person" :size="36" />
            <div class="item-text">
              <span class="item-title">{{ person.name }} <code class="id">{{ person.id }}</code></span>
              <span v-if="person.aliases.length" class="sub">Also {{ person.aliases.join(', ') }}</span>
            </div>
          </li>
          <li v-for="group in setup.groups" :key="group.id" class="item" data-testid="setup-group">
            <div class="item-text">
              <span class="item-title">{{ group.name }} <code class="id">{{ group.id }}</code></span>
              <span class="sub">Group of {{ group.people.map(personName).join(', ') }}<template v-if="group.aliases.length"> · also {{ group.aliases.join(', ') }}</template></span>
            </div>
          </li>
        </ul>
      </SettingsCard>

      <SettingsCard data-testid="setup-schedules">
        <header class="head">
          <h2 class="name">
            Schedules
          </h2>
          <p class="where">
            <code>schedules</code> under each display
          </p>
        </header>
        <p v-if="schedulesByDisplay.length === 0" class="none" data-testid="setup-no-schedules">
          No display has a schedule.
        </p>
        <section v-for="entry in schedulesByDisplay" :key="entry.display_id" class="panel" :data-display="entry.display_id">
          <h3 class="subhead">
            {{ displayName(entry.display_id) }}
          </h3>
          <div v-for="schedule in entry.schedules" :key="schedule.id" class="schedule" data-testid="setup-schedule">
            <p class="item-title">
              {{ schedule.name }} <code class="id">{{ schedule.id }}</code>
            </p>
            <dl class="rows">
              <div v-for="(rule, index) in schedule.rules" :key="index" class="row" data-testid="setup-schedule-rule">
                <dt>{{ rule.from }}–{{ rule.to }} · {{ daysLabel(rule.days) }}</dt>
                <dd>
                  {{ viewLabel(rule.view) }}<template v-if="rule.layout">
                    ({{ rule.layout }})
                  </template>
                  <span v-if="rule.photo_feed" class="sub">Photos from {{ rule.photo_feed }}</span>
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </SettingsCard>

      <div class="pair">
        <SettingsCard data-testid="setup-button">
          <header class="head">
            <h2 class="name">
              Button
            </h2>
            <p class="where">
              <code>button</code>
            </p>
          </header>
          <dl class="rows">
            <div v-for="gesture in GESTURES" :key="gesture.key" class="row">
              <dt>{{ gesture.label }}</dt>
              <dd :data-testid="`setup-button-${gesture.key}`">
                {{ buttonActionLabel(setup.button[gesture.key]) }}
              </dd>
            </div>
          </dl>
        </SettingsCard>

        <SettingsCard data-testid="setup-curve">
          <header class="head">
            <h2 class="name">
              Brightness curve
            </h2>
            <p class="where">
              <code>policies.auto_brightness.curve</code>
            </p>
          </header>
          <dl class="rows">
            <div v-for="point in setup.brightness_curve" :key="point.lux" class="row" data-testid="setup-curve-point">
              <dt>{{ point.lux }} lux</dt>
              <dd>{{ point.brightness }}%</dd>
            </div>
          </dl>
        </SettingsCard>
      </div>

      <div class="pair">
        <SettingsCard data-testid="setup-weather">
          <header class="head">
            <h2 class="name">
              Weather
            </h2>
            <p class="where">
              <code>weather</code>
            </p>
          </header>
          <dl v-if="setup.weather" class="rows">
            <div class="row">
              <dt>Entity</dt>
              <dd><code>{{ setup.weather.entity_id }}</code></dd>
            </div>
            <div class="row">
              <dt>Checked</dt>
              <dd>{{ pollLabel(setup.weather.poll_seconds) }}</dd>
            </div>
          </dl>
          <p v-else class="none">
            Not set up: the wall shows no weather.
          </p>
        </SettingsCard>

        <SettingsCard data-testid="setup-alarm">
          <header class="head">
            <h2 class="name">
              Next alarm
            </h2>
            <p class="where">
              <code>alarm</code>
            </p>
          </header>
          <dl v-if="setup.alarm" class="rows">
            <div class="row">
              <dt>Entity</dt>
              <dd><code>{{ setup.alarm.entity_id }}</code></dd>
            </div>
            <div class="row">
              <dt>Checked</dt>
              <dd>{{ pollLabel(setup.alarm.poll_seconds) }}</dd>
            </div>
          </dl>
          <p v-else class="none">
            Not set up: the night view can't show the next alarm.
          </p>
        </SettingsCard>
      </div>

      <SettingsCard data-testid="setup-timers">
        <header class="head">
          <h2 class="name">
            Kitchen timers
          </h2>
          <p class="where">
            <code>timers</code>
          </p>
        </header>
        <template v-if="setup.timers">
          <dl class="rows">
            <div class="row">
              <dt>Checked</dt>
              <dd data-testid="setup-timers-poll">
                {{ pollLabel(setup.timers.poll_seconds) }}
              </dd>
            </div>
            <div class="row">
              <dt>A finished timer stays up for</dt>
              <dd data-testid="setup-timers-done">
                {{ setup.timers.done_seconds === 0 ? 'No time' : lengthLabel(setup.timers.done_seconds) }}
              </dd>
            </div>
            <div v-for="entity in setup.timers.entities" :key="entity.entity_id" class="row" data-testid="setup-timer">
              <dt><code>{{ entity.entity_id }}</code></dt>
              <dd>{{ displayNames(entity.displays, setup.displays) }}</dd>
            </div>
          </dl>
        </template>
        <p v-else class="none" data-testid="setup-no-timers">
          Not set up: no timers show on the wall.
        </p>
      </SettingsCard>

      <SettingsCard data-testid="setup-cameras">
        <header class="head">
          <h2 class="name">
            Cameras
          </h2>
          <p class="where">
            <code>cameras</code>
          </p>
        </header>
        <ul v-if="setup.cameras.length" class="list">
          <li v-for="camera in setup.cameras" :key="camera.id" class="item" data-testid="setup-camera">
            <div class="item-text">
              <span class="item-title">{{ camera.name }} <code class="id">{{ camera.id }}</code></span>
              <span class="sub">{{ cameraKindLabel(camera.kind) }}<template v-if="camera.where"> · {{ camera.where }}</template></span>
            </div>
          </li>
        </ul>
        <p v-else class="none" data-testid="setup-no-cameras">
          No cameras are set up.
        </p>
      </SettingsCard>

      <SettingsCard data-testid="setup-triggers">
        <header class="head">
          <h2 class="name">
            Triggers
          </h2>
          <p class="where">
            <code>triggers</code>
          </p>
        </header>
        <template v-if="setup.triggers.length">
          <section v-for="trigger in setup.triggers" :key="trigger.id" class="panel" data-testid="setup-trigger">
            <h3 class="subhead">
              <code class="id">{{ trigger.id }}</code>
            </h3>
            <dl class="rows">
              <div class="row">
                <dt>When</dt>
                <dd data-testid="setup-trigger-when">
                  {{ triggerWhenLabel(trigger.when) }}
                </dd>
              </div>
              <div class="row">
                <dt>On</dt>
                <dd data-testid="setup-trigger-displays">
                  {{ displayNames(trigger.displays, setup.displays) }}
                </dd>
              </div>
              <div class="row">
                <dt>Does</dt>
                <dd>
                  <ol class="actions">
                    <li v-for="(action, index) in trigger.actions" :key="index" data-testid="setup-trigger-action">
                      {{ commandLabel(action, cameraName) }}
                    </li>
                  </ol>
                </dd>
              </div>
            </dl>
          </section>
        </template>
        <p v-else class="none" data-testid="setup-no-triggers">
          No triggers are set up.
        </p>
      </SettingsCard>
    </template>
  </div>
</template>

<style scoped>
.setup {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 20px;
}

.intro {
  flex: 1;
  min-width: 260px;
  margin: 0;
  color: var(--muted);
  font-size: 17px;
  font-weight: 500;
}

.readonly {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 8px 16px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.unreachable {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.empty {
  margin: 0;
  padding: 48px 0;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 28px;
  text-align: center;
}

.pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.name {
  margin: 0;
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 400;
  line-height: 1.1;
}

.where {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}

.id {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--bg);
  color: var(--muted);
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
}

.panel {
  padding: 16px 24px;
  border-radius: 24px;
  background: var(--bg);
}

.panel .id {
  background: var(--surface);
}

.subhead {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 400;
}

.schedule + .schedule {
  margin-top: 16px;
}

.rows {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 48px;
  padding: 6px 0;
  border-top: 2px solid var(--line);
}

dt {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: 15px;
  font-weight: 700;
}

dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 17px;
  font-weight: 700;
  text-align: right;
}

.sub {
  display: block;
  color: var(--muted);
  font-size: 14px;
  font-weight: 600;
}

.list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 52px;
  padding: 8px 0;
  border-top: 2px solid var(--line);
}

.item-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.item-title {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 17px;
  font-weight: 700;
}

.actions {
  margin: 0;
  padding: 0;
  list-style: none;
}

.actions li + li {
  margin-top: 4px;
}

.none {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
  font-weight: 600;
}

@media (max-width: 760px) {
  .pair {
    grid-template-columns: 1fr;
  }

  .row {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  dd {
    text-align: left;
  }
}
</style>
