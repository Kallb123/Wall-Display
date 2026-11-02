import { createPresencePolicy } from '../control/presence'
import { createMqttBridge } from '../mqtt/client'
import { getMqttBridge, getPresencePolicy, setMqttBridge, setPresencePolicy } from '../mqtt/state'
import { lastSyncAt } from '../sources/store'

// Runs after the control plugin (the 04 prefix). With an `mqtt` block in the
// config it connects each display to the broker: state out, commands, the Pi
// agent's button presses and its presence sensor in, and Home Assistant's
// discovery configs. The presence policy lives here because the sensor's
// reading arrives over MQTT, and without the block it has nothing to act on.
// It never waits for the broker, so a broker that is down doesn't delay the boot,
// and without the block it does nothing.
export default defineNitroPlugin(async (nitroApp) => {
  // A hot reload runs this again in the same process, so close the old connections first.
  getPresencePolicy()?.stop()
  setPresencePolicy(undefined)
  await getMqttBridge()?.stop()
  setMqttBridge(undefined)

  const config = useConfig()
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
  const bridge = createMqttBridge({
    config: config.mqtt,
    displays: config.displays,
    timeZone: config.timezone,
    button: config.button,
    presence,
    control: useDisplayControl(),
    bus: useEventBus(),
    lastSync: () => lastSyncAt(useDb()),
    // Looked up each time: the special days plugin starts after this one.
    specialDay: () => {
      const resolution = useSpecialDays()?.get()
      return resolution === null || resolution === undefined ? undefined : (resolution.current?.name ?? null)
    },
  })
  setMqttBridge(bridge)

  // Publishes `offline` first, so Home Assistant sees the display go rather than wait for a timeout.
  nitroApp.hooks.hook('close', async () => {
    presence.stop()
    if (getPresencePolicy() === presence) setPresencePolicy(undefined)
    await bridge.stop()
    if (getMqttBridge() === bridge) setMqttBridge(undefined)
  })
})
