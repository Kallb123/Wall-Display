import { commandSchema, currentMonth } from '../../shared/display'
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
  'screen/state',
  'photo_source/state',
  'brightness/state',
  'auto_presence/state',
  'auto_brightness/state',
] as const
export type StateTopic = (typeof STATE_TOPICS)[number]

/** When the last calendar sync finished. Retained, but not one of `STATE_TOPICS`: those are the display's settings, each paired with a command topic, and this is a fact about the app. */
export const LAST_SYNC_TOPIC = 'last_sync/state'

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

/** `ON` or `OFF`, as the auto_presence and auto_brightness topics carry a setting. */
export const onOffPayload = (value: boolean): string => value ? 'ON' : 'OFF'

/** Every state topic's payload for `state`. `month/state` is the month the month view shows, so it is the current month in `timeZone` at `now` when nothing is pinned. */
export function statePayloads(state: DisplayState, now: Date, timeZone: string): Record<StateTopic, string> {
  return {
    'view/state': state.view,
    'month/state': state.month ?? currentMonth(now, timeZone),
    'screen/state': state.screen,
    'photo_source/state': state.photo_source,
    'brightness/state': String(state.brightness),
    'auto_presence/state': onOffPayload(state.auto_presence),
    'auto_brightness/state': onOffPayload(state.auto_brightness),
  }
}

/** What `last_sync/state` carries: an ISO 8601 UTC instant, such as `2026-10-28T12:00:00.000Z`. */
export function lastSyncPayload(at: Date): string {
  return at.toISOString()
}
