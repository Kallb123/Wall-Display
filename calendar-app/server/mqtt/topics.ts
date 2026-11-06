import { commandSchema, currentMonth, currentWeek, scheduleIdSchema } from '../../shared/display'
import type { Command, DisplayState } from '../../shared/display'

// The topics the app uses and what their payloads mean (architecture §7.3).
// Pure: no I/O. contracts/mqtt.json is the same table for other programs, and
// test/unit/mqtt/contract.test.ts holds the two together. Every payload is
// UTF-8 text.

export const TOPIC_ROOT = 'wallcal'

/** Topics the app subscribes to, under `wallcal/<display_id>/`. */
export const COMMAND_TOPICS = [
  'view/set',
  'month/set',
  'week/set',
  'screen/set',
  'photo_source/set',
  'brightness/set',
  'auto_presence/set',
  'auto_brightness/set',
  'overlay/set',
  'photo/next',
  'refresh',
] as const
export type CommandTopic = (typeof COMMAND_TOPICS)[number]

/** Topics the app publishes the state on, retained. */
export const STATE_TOPICS = [
  'view/state',
  'month/state',
  'week/state',
  'screen/state',
  'photo_source/state',
  'brightness/state',
  'auto_presence/state',
  'auto_brightness/state',
  'overlay/state',
] as const
export type StateTopic = (typeof STATE_TOPICS)[number]

/** When the last calendar sync finished. Retained, but not one of `STATE_TOPICS`: those are the display's settings, each paired with a command topic, and this is a fact about the app. */
export const LAST_SYNC_TOPIC = 'last_sync/state'

/** Today's special day name, or empty when there is none. Retained, and a fact about the app like `LAST_SYNC_TOPIC`, so not one of `STATE_TOPICS`. */
export const SPECIAL_DAY_TOPIC = 'special_day/state'

/** What the Pi agent should make the panel: `on` or `off`. It is for the agent, so it is under `pi/` (the topic the agent subscribes to), and retained so an agent that starts later still gets the last request. Not one of `STATE_TOPICS`: those are the display's settings, each paired with a command topic, and this is the same `screen` setting told to the panel. */
export const PI_SCREEN_TOPIC = 'pi/screen/set'

/** A press of the physical button, as the Pi agent classifies it. The app subscribes to it (it is under `pi/`, like `pi/screen/set`), but it is not a command topic: the payload is a gesture, and the `button:` config decides what it does. Not retained, so a press is never replayed. */
export const PI_BUTTON_TOPIC = 'pi/button'

/** What `pi/button` can carry. */
export const BUTTON_GESTURES = ['single', 'double', 'long'] as const
export type ButtonGesture = (typeof BUTTON_GESTURES)[number]

/** Whether the Pi agent's mmWave sensor sees someone: `ON` or `OFF`. Under `pi/` like the button, and not a command topic: the `policies.auto_presence` rules decide what it does. Unlike a button press it is a state, so it is retained, and the retained value is how the app learns the current one when it connects. */
export const PI_PRESENCE_TOPIC = 'pi/presence'

/** How bright the room is, in lux, from the Pi agent's light sensor: a non-negative number as text, such as `12.5`. Under `pi/` like the button and presence, and not a command topic: the `policies.auto_brightness` rules decide what it does. A reading is a measurement, so it is not retained: one replayed to a late subscriber is stale, and worse than none. The agent sends one when the light changes and at least every 30 seconds. */
export const PI_ILLUMINANCE_TOPIC = 'pi/illuminance'

/** The topic name of a schedule's switch command, as contracts/mqtt.json writes it. There is one per schedule in the display's config, so it is a template and not one of `COMMAND_TOPICS`. The payload is `ON` or `OFF`, and `set_schedule` is the command it becomes. */
export const SCHEDULE_SET_TEMPLATE = 'schedule/{schedule_id}/set'

/** The topic name of a schedule's state, as contracts/mqtt.json writes it. Retained, and a template like `SCHEDULE_SET_TEMPLATE`, so not one of `STATE_TOPICS`. */
export const SCHEDULE_STATE_TEMPLATE = 'schedule/{schedule_id}/state'

/** `online` while connected. The broker publishes `offline` if the app dies (the last will). */
export const AVAILABILITY_TOPIC = 'availability'
export const ONLINE = 'online'
export const OFFLINE = 'offline'

/** `wallcal/hallway` */
export function displayBase(displayId: string): string {
  return `${TOPIC_ROOT}/${displayId}`
}

/** `wallcal/hallway/view/set` */
export function topicFor(displayId: string, suffix: string): string {
  return `${displayBase(displayId)}/${suffix}`
}

/** The display id and command suffix of a full topic, or null if it isn't one of the app's command topics. */
export function parseCommandTopic(topic: string): { displayId: string, suffix: CommandTopic } | null {
  const [root, displayId, ...rest] = topic.split('/')
  if (root !== TOPIC_ROOT || !displayId) return null
  const suffix = rest.join('/')
  return isCommandTopic(suffix) ? { displayId, suffix } : null
}

/** A schedule topic's suffix, such as `schedule/mornings/set`. */
export type ScheduleSuffix = `schedule/${string}/${'set' | 'state'}`

/** What stands for the schedule id in a template topic name. */
const SCHEDULE_ID_PLACEHOLDER = '{schedule_id}'

/** The topic suffix of one of the two schedule templates, filled in: `scheduleTopic('mornings', 'set')` is `schedule/mornings/set`. Goes in `topicFor` like any other suffix. */
export function scheduleTopic(scheduleId: string, kind: 'set' | 'state'): ScheduleSuffix {
  return (kind === 'set' ? SCHEDULE_SET_TEMPLATE : SCHEDULE_STATE_TEMPLATE).replace(SCHEDULE_ID_PLACEHOLDER, scheduleId) as ScheduleSuffix
}

/** The display id and schedule id of a full `wallcal/<display id>/schedule/<schedule id>/set` topic, or null if it isn't one. An id that is not a schedule id (upper case, say) is not one either, so it is never looked up. */
export function parseScheduleTopic(topic: string): { displayId: string, scheduleId: string } | null {
  const parts = topic.split('/')
  if (parts.length !== 5) return null
  const [root, displayId, kind, scheduleId = '', verb] = parts
  if (root !== TOPIC_ROOT || !displayId || kind !== 'schedule' || verb !== 'set') return null
  return scheduleIdSchema.safeParse(scheduleId).success ? { displayId, scheduleId } : null
}

function isCommandTopic(suffix: string): suffix is CommandTopic {
  return (COMMAND_TOPICS as readonly string[]).includes(suffix)
}

export type ParsedMessage = { ok: true, command: Command } | { ok: false, reason: string }

const QUOTE_LIMIT = 60
const ISSUE_LIMIT = 100

/** The payload as a short JSON string, so a stray newline or control character can't spread over the log. */
function quote(payload: string): string {
  const clipped = payload.length > QUOTE_LIMIT ? `${payload.slice(0, QUOTE_LIMIT)}…` : payload
  return JSON.stringify(clipped)
}

/** A schema message can repeat the payload (an unknown key, say), so it is cut short too. */
function clip(message: string): string {
  return message.length > ISSUE_LIMIT ? `${message.slice(0, ISSUE_LIMIT)}…` : message
}

/** A whole number as a command carries it: no sign, no leading zeros, and `.0` allowed because HA number entities send `50.0`. */
const WHOLE_NUMBER = /^(0|[1-9]\d*)(\.0+)?$/

type Candidate = { command: unknown } | { error: string }

const ON_OFF = { ON: true, OFF: false } as const

function onOff(payload: string, field: 'auto_presence' | 'auto_brightness'): Candidate {
  if (payload !== 'ON' && payload !== 'OFF') return { error: 'must be ON or OFF' }
  return { command: { type: `set_${field}`, [field]: ON_OFF[payload] } }
}

/** What the payload asks for, before `commandSchema` checks it. Values are passed on as they are, so the schema's own message names what is wrong. */
function candidateFor(suffix: CommandTopic, payload: string): Candidate {
  switch (suffix) {
    case 'view/set': return { command: payload === 'next' ? { type: 'next_view' } : { type: 'set_view', view: payload } }
    case 'month/set': return { command: { type: 'set_month', month: payload } }
    case 'week/set': return { command: { type: 'set_week', week: payload } }
    case 'screen/set': return { command: { type: 'set_screen', screen: payload } }
    case 'photo_source/set': return { command: { type: 'set_photo_source', photo_source: payload } }
    case 'brightness/set':
      return WHOLE_NUMBER.test(payload)
        ? { command: { type: 'set_brightness', brightness: Number(payload) } }
        : { error: 'must be a whole number from 0 to 100' }
    case 'auto_presence/set': return onOff(payload, 'auto_presence')
    case 'auto_brightness/set': return onOff(payload, 'auto_brightness')
    case 'overlay/set': return overlayCandidate(payload)
    case 'photo/next': return { command: { type: 'photo_next' } }
    case 'refresh': return { command: { type: 'refresh' } }
  }
}

function overlayCandidate(payload: string): Candidate {
  // Empty clears the overlay, so a retained message can be wiped by publishing nothing.
  if (payload.trim() === '') return { command: { type: 'set_overlay', overlay: null } }
  let json: unknown
  try {
    json = JSON.parse(payload)
  } catch {
    return { error: 'must be JSON like {"text":"Bins out tonight"}, or empty to clear' }
  }
  // `null` is valid JSON but not what the contract allows. Clearing is the empty payload.
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { error: 'must be a JSON object, or empty to clear' }
  return { command: { type: 'set_overlay', overlay: json } }
}

/** The warning reason for a `pi/button` payload that is not a gesture: names the topic and quotes at most 60 characters of the payload, like `parseCommandPayload`'s. */
export function buttonPayloadReason(payload: string): string {
  return `${PI_BUTTON_TOPIC}: must be single, double or long (got ${quote(payload)})`
}

/** The warning reason for a `pi/presence` payload that is not `ON` or `OFF`: names the topic and quotes at most 60 characters of the payload, like the button's. */
export function presencePayloadReason(payload: string): string {
  return `${PI_PRESENCE_TOPIC}: must be ON or OFF (got ${quote(payload)})`
}

/** The warning reason for a `pi/illuminance` payload that is not a number of lux: names the topic and quotes at most 60 characters of the payload, like the button's. */
export function illuminancePayloadReason(payload: string): string {
  return `${PI_ILLUMINANCE_TOPIC}: must be a number of lux such as 12.5 (got ${quote(payload)})`
}

/** Turns a command topic's payload into a Command, validated with commandSchema. `reason` is safe to log: it names the topic and the fault, and quotes at most 60 characters of the payload. */
export function parseCommandPayload(suffix: CommandTopic, payload: string): ParsedMessage {
  const candidate = candidateFor(suffix, payload)
  if ('error' in candidate) return { ok: false, reason: `${suffix}: ${candidate.error} (got ${quote(payload)})` }

  const parsed = commandSchema.safeParse(candidate.command)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    // The first path segment is the command's own field, which the topic already names.
    const where = issue.path.slice(1).join('.')
    return { ok: false, reason: `${suffix}: ${where ? `${where} ` : ''}${clip(issue.message)} (got ${quote(payload)})` }
  }
  return { ok: true, command: parsed.data }
}

/** Turns a schedule's `set` payload into a `set_schedule` command: `ON` turns the schedule on and `OFF` off, exactly, like the policies' switches. `reason` is safe to log, like `parseCommandPayload`'s: it names the topic as the contract does and quotes at most 60 characters of the payload. */
export function parseSchedulePayload(scheduleId: string, payload: string): ParsedMessage {
  if (payload !== 'ON' && payload !== 'OFF') return { ok: false, reason: `${scheduleTopic(scheduleId, 'set')}: must be ON or OFF (got ${quote(payload)})` }
  return { ok: true, command: { type: 'set_schedule', schedule: scheduleId, on: ON_OFF[payload] } }
}

/** The gesture a `pi/button` payload names, or null for anything else. An exact match, like the contract: `Single` and `single ` are not gestures. */
export function parseButtonPayload(payload: string): ButtonGesture | null {
  return (BUTTON_GESTURES as readonly string[]).includes(payload) ? payload as ButtonGesture : null
}

/** Whether a `pi/presence` payload says someone is there (`ON`) or nobody is (`OFF`), or null for anything else. An exact match, like the contract: `on` and `OFF ` are not presences. */
export function parsePresencePayload(payload: string): boolean | null {
  if (payload === 'ON') return true
  if (payload === 'OFF') return false
  return null
}

/** A `pi/illuminance` payload as the contract allows it: a plain decimal number, with no sign, no exponent, no leading zeros and no comma. */
const LUX = /^(0|[1-9]\d*)(\.\d+)?$/

/** The lux a `pi/illuminance` payload carries, or null for anything else. An exact match, like the contract: `-1`, `.5`, `1e3`, `12,5` and ` 5` are not readings. A number too big to be one (it overflows to infinity) is not either. */
export function parseIlluminancePayload(payload: string): number | null {
  if (!LUX.test(payload)) return null
  const lux = Number(payload)
  return Number.isFinite(lux) ? lux : null
}

/** `ON` or `OFF`, as the auto_presence and auto_brightness topics carry a setting. */
export const onOffPayload = (value: boolean): string => value ? 'ON' : 'OFF'

/** Every state topic's payload for `state`. `month/state` is the month the month view shows, so it is the current month in `timeZone` at `now` when nothing is pinned. `week/state` is the first day of the week the week view shows, the current week by the display's `weekStart` when nothing is pinned. `overlay/state` is the overlay's text, or empty when none is shown (it has expired, or been cleared), so Home Assistant's message box empties with it. */
export function statePayloads(state: DisplayState, now: Date, timeZone: string, weekStart: 'monday' | 'sunday'): Record<StateTopic, string> {
  return {
    'view/state': state.view,
    'month/state': state.month ?? currentMonth(now, timeZone),
    'week/state': state.week ?? currentWeek(now, timeZone, weekStart),
    'screen/state': state.screen,
    'photo_source/state': state.photo_source,
    'brightness/state': String(state.brightness),
    'auto_presence/state': onOffPayload(state.auto_presence),
    'auto_brightness/state': onOffPayload(state.auto_brightness),
    'overlay/state': state.overlay?.text ?? '',
  }
}

/** The payload of each schedule's `schedule/<id>/state`, keyed by that topic's suffix: `ON` unless the id is in `state.schedules_off`. `scheduleIds` are the schedules in the display's config, so an id left in `schedules_off` after it was removed from the config is not published. */
export function schedulePayloads(state: DisplayState, scheduleIds: readonly string[]): Record<string, string> {
  return Object.fromEntries(scheduleIds.map(id => [scheduleTopic(id, 'state'), onOffPayload(!state.schedules_off.includes(id))]))
}

/** What `last_sync/state` carries: an ISO 8601 UTC instant, such as `2026-10-28T12:00:00.000Z`. */
export function lastSyncPayload(at: Date): string {
  return at.toISOString()
}

/** What `special_day/state` carries: today's special day name, or empty when there is none. */
export function specialDayPayload(name: string | null): string {
  return name ?? ''
}

/** What `pi/screen/set` carries: `state.screen` as it is, `on` or `off`. */
export function piScreenPayload(state: DisplayState): string {
  return state.screen
}
