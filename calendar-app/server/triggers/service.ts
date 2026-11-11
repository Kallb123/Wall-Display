import type { Command } from '../../shared/display'
import type { TriggerConfig, TriggerWhen } from '../config/schema'
import type { DisplayControl } from '../control/service'
import type { HaTriggerSubscription } from './socket'

// The config's `triggers` (something happening in Home Assistant, such as a
// doorbell ringing) and what the wall does about them. Pure but for the control
// it is handed: `haTriggerFor` writes each trigger the way Home Assistant reads
// one, and `createTriggerRunner` applies a trigger's actions to its displays
// when the socket (socket.ts) says it fired.

/** The states a state trigger that names none ignores: an entity that goes away or comes back is not news. */
const NOT_NEWS = ['unavailable', 'unknown']

/**
 * The trigger as Home Assistant's `subscribe_trigger` takes it, written as in
 * an automation. A state trigger with neither `from` nor `to` fires on any
 * change of state (not of attributes) except to or from `unavailable` and to
 * `unknown`, so an `event.*` entity, whose state is the time of its last event,
 * fires once each time it happens, and a restart of Home Assistant doesn't.
 */
export function haTriggerFor(when: TriggerWhen): Record<string, unknown> {
  if (when.kind === 'event') {
    return when.event_data === null
      ? { platform: 'event', event_type: when.event_type }
      : { platform: 'event', event_type: when.event_type, event_data: when.event_data }
  }
  const trigger: Record<string, unknown> = { platform: 'state', entity_id: when.entity_ids }
  if (when.from !== null) trigger.from = when.from
  if (when.to !== null) trigger.to = when.to
  if (when.from === null && when.to === null) {
    trigger.not_from = ['unavailable']
    trigger.not_to = NOT_NEWS
  }
  return trigger
}

/** Every trigger in the config, as the socket subscribes to them. */
export function subscriptionsFor(triggers: readonly TriggerConfig[]): HaTriggerSubscription[] {
  return triggers.map(trigger => ({ id: trigger.id, trigger: haTriggerFor(trigger.when) }))
}

export interface TriggerRunnerOptions {
  triggers: readonly TriggerConfig[]
  /** The ids of the displays in the config: where a trigger with no `displays` acts. */
  displays: readonly string[]
  control: Pick<DisplayControl, 'applyCommand'>
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface TriggerRunner {
  /** Applies the actions of the trigger with this id, in order, to each of its displays. An action that is refused is logged and the rest still run. Unknown ids do nothing. */
  fire: (triggerId: string) => void
}

export function createTriggerRunner(options: TriggerRunnerOptions): TriggerRunner {
  const { control, log = console } = options
  const byId = new Map(options.triggers.map(trigger => [trigger.id, trigger]))

  return {
    fire(triggerId) {
      const trigger = byId.get(triggerId)
      if (!trigger) return
      const displays = trigger.displays ?? options.displays
      log.info(`[triggers] "${trigger.id}" fired: ${describe(trigger.actions)} on ${displays.join(', ')}`)
      for (const displayId of displays) {
        for (const action of trigger.actions) {
          try {
            control.applyCommand(displayId, action)
          } catch (error) {
            log.warn(`[triggers] "${trigger.id}": ${action.type} on ${displayId} failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    },
  }
}

function describe(actions: readonly Command[]): string {
  return actions.map(action => action.type).join(', ')
}
