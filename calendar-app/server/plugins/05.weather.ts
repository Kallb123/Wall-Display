import { createWeatherService } from '../weather/service'
import { getWeather, setWeather } from '../weather/state'
import { fetchHaWeather } from '../weather/fetch'
import { mapWeather } from '../weather/map'
import { getSocketHub } from '../ws/hub'

// Runs after the MQTT plugin (the 05 prefix). With a `weather` block in the
// config it polls that Home Assistant entity in the background, so a slow or
// broken Home Assistant never delays the boot, and sends every change to the
// displays over the WebSocket hub. Without the block it does nothing, and the
// wall shows no weather.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so stop the old service first.
  getWeather()?.stop()
  setWeather(undefined)

  const config = useConfig()
  const { weather, homeassistant } = config
  // The config check makes sure there is a homeassistant block whenever there is a weather one.
  if (!weather || !homeassistant) {
    console.info('[weather] off: no weather block in the config')
    return
  }

  const bus = useEventBus()
  const service = createWeatherService({
    load: async () => mapWeather(await fetchHaWeather(homeassistant, weather.entity_id), { timeZone: config.timezone, now: new Date() }),
    intervalMs: weather.poll_seconds * 1000,
    onChange: snapshot => bus.emit('weather.updated', { weather: snapshot }),
  })
  setWeather(service)

  const unsubscribe = bus.on('weather.updated', ({ weather: snapshot }) => {
    getSocketHub().sendToAll({ type: 'weather.updated', weather: snapshot })
  })
  service.start()

  nitroApp.hooks.hook('close', () => {
    unsubscribe()
    service.stop()
    if (getWeather() === service) setWeather(undefined)
  })
})
