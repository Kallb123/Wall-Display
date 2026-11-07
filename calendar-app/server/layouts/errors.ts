/**
 * Thrown by the layout store for a request that is well formed but not
 * allowed: a name another layout already has (409), or a layout a schedule in
 * the config still names (409). `server/utils/layoutErrors.ts` turns it into
 * the HTTP error. Kept free of h3, so the store can be tested alone.
 */
export class LayoutError extends Error {
  readonly statusCode: 409

  constructor(message: string) {
    super(message)
    this.name = 'LayoutError'
    this.statusCode = 409
  }
}
