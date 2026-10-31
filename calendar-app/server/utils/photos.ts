import { join } from 'node:path'
import { resolveDataDir } from '../db/paths'
import { PHOTO_DIR_NAME } from '../photos/cache'
import { getPhotos } from '../photos/state'
import type { PhotoService } from '../photos/service'

/**
 * The photo service, or undefined when the config has no `photos` block.
 * Started at boot by `server/plugins/07.photos.ts`. Server code only. Call it
 * inside a handler, not at import time.
 */
export function usePhotos(): PhotoService | undefined {
  return getPhotos()
}

/** The folder the rendered photos are kept in, under the data directory. Server code only. */
export function usePhotoDir(): string {
  return join(resolveDataDir({ env: process.env, dev: import.meta.dev, rootDir: process.cwd() }), PHOTO_DIR_NAME)
}
