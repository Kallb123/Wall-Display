import type { SpecialDayScene } from '../../../shared/special-days'
import { listScenes } from '../../special-days/scenes'

// Every scene, by name, for the settings page's editor. Reading is open, like
// the rest of the reads.
export default defineEventHandler((): SpecialDayScene[] => {
  return listScenes(useDb())
})
