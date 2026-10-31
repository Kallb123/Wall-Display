import type { PhotosSettingsStatus } from '../../../shared/settings'
import { photosStatus } from '../../settings/status'

// The photo sources, the cache against its cap and the rotation settings, for
// the settings page's Photos tab. Reading is open. The shaping copies out named
// fields only, so the Immich API key and the rest of its address never appear.
export default defineEventHandler((): PhotosSettingsStatus => {
  return photosStatus({ config: useConfig().photos, status: usePhotos()?.status() })
})
