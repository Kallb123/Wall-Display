/**
 * Thrown by the photo pool store for a request that is well formed but not
 * allowed: a name another pool already has (409). `server/utils/photoPoolErrors.ts`
 * turns it into the HTTP error. Kept free of h3, so the store can be tested alone.
 */
export class PhotoPoolError extends Error {
  readonly statusCode: 409

  constructor(message: string) {
    super(message)
    this.name = 'PhotoPoolError'
    this.statusCode = 409
  }
}
