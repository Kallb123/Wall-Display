import type { CustomLayout } from '../../../shared/layouts'
import { listLayouts } from '../../layouts/store'

// Every custom layout, by name, for the editors and the remote. Reading is
// open, like the rest of the reads.
export default defineEventHandler((): CustomLayout[] => {
  return listLayouts(useDb())
})
