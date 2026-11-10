import type { StarChart } from '../../../shared/stars'

// The star chart: the people who have one, in config order, and their stars for
// the last two weeks. Reading is open, like the rest of the reads.
export default defineEventHandler((): StarChart => {
  return useStars().get()
})
