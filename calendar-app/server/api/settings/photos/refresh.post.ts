import type { PhotosSettingsStatus } from '../../../../shared/settings'
import { photosStatus } from '../../../settings/status'

// Lists every photo source again now, which is "Refresh now" on the Photos tab,
// and answers with the status that results. The service starts a listing at
// boot and every 10 minutes; this is for after something was fixed or added. It
// answers 409 when the config has no `photos` block. A write, so the PIN
// middleware guards it.
export default defineEventHandler(async (): Promise<PhotosSettingsStatus> => {
  const photos = usePhotos()
  const config = useConfig().photos
  if (!photos || !config) throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Photos are not set up: add a photos block to the config' })

  await photos.refresh()
  return photosStatus({ config, status: photos.status() })
})
