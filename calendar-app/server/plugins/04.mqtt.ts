import { createBrightnessPolicy } from '../control/brightness'
import { createPresencePolicy } from '../control/presence'
import { createMqttBridge } from '../mqtt/client'
import { getBrightnessPolicy, getMqttBridge, getPresencePolicy, setBrightnessPolicy, setMqttBridge, setPresencePolicy } from '../mqtt/state'
import { lastSyncAt } from '../sources/store'

// Runs after the control plugin (the 04 prefix). With an `mqtt` block in the
// config it connects each display to the broker: state out, commands, the Pi
// agent's button presses, its presence sensor and its light sensor in, and
// Home Assistant's discovery configs. The presence and brightness policies
// live here because the sensors' readings arrive over MQTT, and without the
// block they have nothing to act on. They are made from the effective config
// (the YAML with the settings page's preferences on top), and take up a saved
// change to the shared preferences at once.
// It never waits for the broker, so a broker that is down doesn't delay the boot,
// and without the block it does nothing.
export default defineNitroPlugin(async (nitroApp) => {
  // A hot reload runs this again in the same process, so close the old connections first.
  getPresencePolicy()?.stop()
  setPresencePolicy(undefined)
  getBrightnessPolicy()?.stop()
  setBrightnessPolicy(undefined)
  await getMqttBridge()?.stop()
  setMqttBridge(undefined)

  const settings = useSettings()
  const config = settings.config()
  if (!config.mqtt) {
    console.info('[mqtt] off: no mqtt block in the config')
    return
  }

  const presence = createPresencePolicy({
    config: config.policies.auto_presence,
    displays: config.displays.map(display => display.id),
    timeZone: config.timezone,
    control: useDisplayControl(),
    bus: useEventBus(),
  })
  setPresencePolicy(presence)
  const brightness = createBrightnessPolicy({
    config: config.policies.auto_brightness,
    displays: config.displays.map(display => display.id),
    control: useDisplayControl(),
    bus: useEventBus(),
  })
  setBrightnessPolicy(brightness)
  const unsubscribe = useEventBus().on('settings.updated', ({ shared }) => {
    if (!shared) return
    const { policies } = settings.config()
    presence.setConfig(policies.auto_presence)
    brightness.setConfig(policies.auto_brightness)
  })
  const bridge = createMqttBridge({
    config: config.mqtt,
    displays: config.displays,
    timeZone: config.timezone,
    button: config.button,
    presence,
    brightness,
    control: useDisplayControl(),
    bus: useEventBus(),
    lastSync: () => lastSyncAt(useDb()),
    layouts: () => useLayouts().summaries(),
    // Looked up each time: the special days plugin starts after this one.
    specialDay: () => {
      const resolution = useSpecialDays()?.get()
      return resolution === null || resolution === undefined ? undefined : (resolution.current?.name ?? null)
    },
  })
  setMqttBridge(bridge)

  // Publishes `offline` first, so Home Assistant sees the display go rather than wait for a timeout.
  nitroApp.hooks.hook('close', async () => {
    unsubscribe()
    presence.stop()
    if (getPresencePolicy() === presence) setPresencePolicy(undefined)
    brightness.stop()
    if (getBrightnessPolicy() === brightness) setBrightnessPolicy(undefined)
    await bridge.stop()
    if (getMqttBridge() === bridge) setMqttBridge(undefined)
  })
})
