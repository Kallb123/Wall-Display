import type { SpecialDay } from '../../../shared/special-days'
import { listSpecialDays } from '../../special-days/store'

// Every special day, for the settings page's editor, in calendar order.
// Reading is open, like the rest of the reads.
export default defineEventHandler((): SpecialDay[] => {
  return listSpecialDays(useDb())
})
