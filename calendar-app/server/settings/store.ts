import { eq } from 'drizzle-orm'
import { DISPLAY_PREFERENCE_KEYS, SHARED_PREFERENCE_KEYS } from '../../shared/settings'
import type { DisplayPreferences, PreferencesStatus, SharedPreferences } from '../../shared/settings'
import type { AppConfig } from '../config/schema'
import type { Db } from '../db/client'
import { preferenceOverrides } from '../db/schema'
import type { EventBus } from '../events/bus'
import {
  applyDisplayOverrides,
  applySharedOverrides,
  capabilitiesOf,
  inKeyOrder,
  keepDisplayOverridesThatFit,
  keepSharedOverridesThatFit,
  mergeOverrides,
  parseDisplayUpdate,
  parseSharedUpdate,
  readDisplayPreferences,
  readSharedPreferences,
  refusalMessage,
  sameValues,
  validateDisplayOverrides,
  validateSharedOverrides,
} from './preferences'
import type { DisplayOverrides, Fields, Overrides, SharedOverrides } from './preferences'

// The saved preferences (PR 5.6): changes made on the settings page, kept in
// SQLite on top of config.yaml, which is never written. The store holds the
// effective config (the YAML with those changes merged in) and hands it out
// through `config()`, so the services that care read it again when the bus says
// `settings.updated`. Everything it knows is in memory after the first read,
// and each save writes the one row it changes before the memory is touched, so
// a failed write changes nothing.

const SHARED_SCOPE = 'shared'
const displayScope = (id: string) => `display:${id}`

/** A save the preferences' rules refuse. Nothing was saved. The route answers 400 with `fields` as `data`. */
export class PreferencesRefusedError extends Error {
  readonly fields: Fields

  constructor(fields: Fields) {
    super(refusalMessage(fields))
    this.name = 'PreferencesRefusedError'
    this.fields = fields
  }
}

/** A save for a display that is not in the config. The route answers 404. */
export class UnknownDisplayError extends Error {
  readonly displayId: string

  constructor(displayId: string) {
    super(`Unknown display "${displayId}"`)
    this.name = 'UnknownDisplayError'
    this.displayId = displayId
  }
}

export interface SettingsStore {
  /** The config in force: the YAML with the saved preferences on top. A new object after each save that changed something, so hold on to the store, not the result. */
  config: () => AppConfig
  /** The config as config.yaml has it. */
  yamlConfig: () => AppConfig
  /** What is in force, what the YAML says and which keys have a saved change. */
  status: () => PreferencesStatus
  /** Saves or resets a display's preferences. Throws `UnknownDisplayError` or `PreferencesRefusedError`. `update` is the request body as it came, so it is checked here. */
  updateDisplay: (displayId: string, update: unknown) => PreferencesStatus
  /** The same for the preferences every display shares. */
  updateShared: (update: unknown) => PreferencesStatus
}

export interface SettingsStoreOptions {
  db: Db
  /** The config as loaded from the YAML. */
  config: AppConfig
  bus: EventBus
  log?: Pick<Console, 'warn'>
}

export function createSettingsStore({ db, config: yaml, bus, log = console }: SettingsStoreOptions): SettingsStore {
  const capabilities = capabilitiesOf(yaml)
  const yamlDisplays = new Map(yaml.displays.map(display => [display.id, display]))
  const yamlDisplayValues = new Map(yaml.displays.map(display => [display.id, readDisplayPreferences(display)]))
  const yamlShared = readSharedPreferences(yaml)

  const displayOverrides = new Map<string, DisplayOverrides>()
  let sharedOverrides: SharedOverrides = {}
  load()

  let effective = build()

  /** Reads the saved rows, keeping each key that still fits the config. A row for a display that is no longer there is left alone. */
  function load(): void {
    for (const row of db.select().from(preferenceOverrides).all()) {
      const isShared = row.scope === SHARED_SCOPE
      const displayId = row.scope.startsWith('display:') ? row.scope.slice('display:'.length) : undefined
      if (!isShared && (displayId === undefined || !yamlDisplays.has(displayId))) continue

      const stored = row.values
      if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
        log.warn(`[settings] ignoring the saved preferences for ${row.scope}: they are not an object`)
        continue
      }
      const { kept, ignored } = isShared
        ? keepSharedOverridesThatFit(stored, yaml)
        : keepDisplayOverridesThatFit(stored, yamlDisplays.get(displayId!)!, capabilities)
      for (const { key, reason } of ignored) {
        log.warn(`[settings] ignoring the saved ${key} of ${row.scope} (${reason})`)
      }
      if (isShared) sharedOverrides = kept as SharedOverrides
      else displayOverrides.set(displayId!, kept as DisplayOverrides)
    }
  }

  function build(): AppConfig {
    return mergeOverrides(yaml, { displays: Object.fromEntries(displayOverrides), shared: sharedOverrides } satisfies Overrides)
  }

  /** Writes a scope's row, or removes it when nothing is overridden. */
  function save(scope: string, values: Record<string, unknown>): void {
    if (Object.keys(values).length === 0) {
      db.delete(preferenceOverrides).where(eq(preferenceOverrides.scope, scope)).run()
      return
    }
    const now = new Date()
    db.insert(preferenceOverrides)
      .values({ scope, values, updatedAt: now })
      .onConflictDoUpdate({ target: preferenceOverrides.scope, set: { values, updatedAt: now } })
      .run()
  }

  function valuesOfDisplay(id: string): DisplayPreferences {
    return applyDisplayOverrides(yamlDisplayValues.get(id)!, displayOverrides.get(id) ?? {})
  }

  function valuesOfShared(): SharedPreferences {
    return applySharedOverrides(yamlShared, sharedOverrides)
  }

  function emitIfChanged(before: { displays: Map<string, DisplayPreferences>, shared: SharedPreferences }): void {
    const displayIds = yaml.displays.map(display => display.id).filter(id => !sameValues(before.displays.get(id), valuesOfDisplay(id)))
    const shared = !sameValues(before.shared, valuesOfShared())
    if (displayIds.length > 0 || shared) bus.emit('settings.updated', { displayIds, shared })
  }

  function snapshot() {
    return { displays: new Map(yaml.displays.map(display => [display.id, valuesOfDisplay(display.id)])), shared: valuesOfShared() }
  }

  function status(): PreferencesStatus {
    return {
      displays: yaml.displays.map(display => ({
        id: display.id,
        name: display.name,
        values: valuesOfDisplay(display.id),
        config: yamlDisplayValues.get(display.id)!,
        changed: DISPLAY_PREFERENCE_KEYS.filter(key => key in (displayOverrides.get(display.id) ?? {})),
      })),
      shared: {
        values: valuesOfShared(),
        config: yamlShared,
        changed: SHARED_PREFERENCE_KEYS.filter(key => key in sharedOverrides),
      },
      photos_configured: capabilities.photos,
      alarm_configured: capabilities.alarm,
      mqtt_configured: yaml.mqtt !== undefined,
    }
  }

  return {
    config: () => effective,
    status,
    yamlConfig: () => yaml,

    updateDisplay(displayId, update) {
      const display = yamlDisplays.get(displayId)
      if (!display) throw new UnknownDisplayError(displayId)

      const parsed = parseDisplayUpdate(update)
      if (!parsed.ok) throw new PreferencesRefusedError(parsed.fields)

      const next = { ...displayOverrides.get(displayId), ...parsed.set }
      const overrides = inKeyOrder(next, DISPLAY_PREFERENCE_KEYS.filter(key => !parsed.reset.includes(key)))
      const problems = validateDisplayOverrides(display, overrides, capabilities)
      if (Object.keys(problems).length > 0) throw new PreferencesRefusedError(problems)

      const before = snapshot()
      save(displayScope(displayId), overrides)
      if (Object.keys(overrides).length === 0) displayOverrides.delete(displayId)
      else displayOverrides.set(displayId, overrides)
      effective = build()
      emitIfChanged(before)
      return status()
    },

    updateShared(update) {
      const parsed = parseSharedUpdate(update)
      if (!parsed.ok) throw new PreferencesRefusedError(parsed.fields)

      const next = { ...sharedOverrides, ...parsed.set }
      const overrides = inKeyOrder(next, SHARED_PREFERENCE_KEYS.filter(key => !parsed.reset.includes(key)))
      const problems = validateSharedOverrides(yaml, overrides)
      if (Object.keys(problems).length > 0) throw new PreferencesRefusedError(problems)

      const before = snapshot()
      save(SHARED_SCOPE, overrides)
      sharedOverrides = overrides
      effective = build()
      emitIfChanged(before)
      return status()
    },
  }
}
