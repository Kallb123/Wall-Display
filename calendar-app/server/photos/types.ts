import type { PhotoSource } from '../../shared/display'

// What a source of photos has to offer (architecture §5.1). The service lists a
// provider's pool now and then and asks it for the bytes of one photo when it
// is due to be shown; everything else (rendering, the cache, the playlist) is
// the same for every provider.

/** One photo in a provider's pool. */
export interface PhotoListing {
  /** The provider's own id for it. The local provider uses the path inside its folder. */
  providerAssetId: string
  /** The size as the photo should be shown, if the provider knows it without downloading. It is read from the image when rendered. */
  width?: number
  height?: number
  takenAt?: Date | null
}

export interface PhotoProvider {
  readonly id: PhotoSource
  /** The current pool. Throws a `PhotoProviderError` if it can't be reached. */
  list: () => Promise<PhotoListing[]>
  /** The image bytes to render. Throws a `PhotoProviderError` if they can't be had. */
  fetch: (providerAssetId: string) => Promise<Buffer>
}

/**
 * A provider that can't be reached or can't give a photo. The message is short
 * and safe to log and show on the settings page: never a URL with credentials
 * (an API key may be in one), never a token.
 */
export class PhotoProviderError extends Error {
  constructor(readonly provider: PhotoSource, message: string) {
    super(message)
    this.name = 'PhotoProviderError'
  }
}

/** The message to log for any error: ours as written, anything else by name only. */
export function safePhotoError(error: unknown): string {
  if (error instanceof PhotoProviderError) return error.message
  return `unexpected error (${error instanceof Error ? error.name : 'unknown'})`
}
