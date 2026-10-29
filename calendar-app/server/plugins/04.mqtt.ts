import { createMqttBridge } from '../mqtt/client'
import { getMqttBridge, setMqttBridge } from '../mqtt/state'
import { lastSyncAt } from '../sources/store'

// Runs after the control plugin (the 04 prefix). With an `mqtt` block in the
// config it connects each display to the broker: state out, commands in, and
// Home Assistant's discovery configs. It never waits for the broker, so a
// broker that is down doesn't delay the boot, and without the block it does
// nothing.
export default defineNitroPlugin(async (nitroApp) => {
  // A hot reload runs this again in the same process, so close the old connections first.
  await getMqttBridge()?.stop()
  setMqttBridge(undefined)

  const config = useConfig()
  if (!config.mqtt) {
    console.info('[mqtt] off: no mqtt block in the config')
    return
  }

  const bridge = createMqttBridge({
    config: config.mqtt,
    displays: config.displays,
    timeZone: config.timezone,
    control: useDisplayControl(),
    bus: useEventBus(),
    lastSync: () => lastSyncAt(useDb()),
  })
  setMqttBridge(bridge)

  // Publishes `offline` first, so Home Assistant sees the display go rather than wait for a timeout.
  nitroApp.hooks.hook('close', async () => {
    await bridge.stop()
    if (getMqttBridge() === bridge) setMqttBridge(undefined)
  })
})
