import { todayIn } from '../../shared/dates'
import { createStarsService } from '../stars/service'
import { setStars } from '../stars/state'
import { buildStarChart } from '../stars/store'
import { getSocketHub } from '../ws/hub'

// Runs right after the database opens (the 02 prefix). The chart is the
// config's people who have it switched on, their settings and their counts for
// the last two weeks, as of today in the config's time zone. After every write
// the routes call `changed()`, and each change goes to the displays and
// remotes over the WebSocket hub.
export default defineNitroPlugin((nitroApp) => {
  setStars(undefined)

  const bus = useEventBus()
  const service = createStarsService({
    load: () => {
      const config = useConfig()
      return buildStarChart(useDb(), config.people, todayIn(new Date(), config.timezone))
    },
    onChange: stars => bus.emit('stars.updated', { stars }),
  })
  setStars(service)

  const unsubscribe = bus.on('stars.updated', ({ stars }) => {
    getSocketHub().sendToAll({ type: 'stars.updated', stars })
  })
  service.start()
  console.info(`[stars] ${service.get().people.length} ${service.get().people.length === 1 ? 'person has' : 'people have'} a star chart`)

  nitroApp.hooks.hook('close', () => {
    unsubscribe()
    setStars(undefined)
  })
})
