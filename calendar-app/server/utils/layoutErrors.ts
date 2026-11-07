import { LayoutError } from '../layouts/errors'

/** Runs a layout write and answers a `LayoutError` it throws as the HTTP error it stands for. Anything else passes through. */
export function answeringLayoutErrors<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (!(error instanceof LayoutError)) throw error
    throw createError({ statusCode: error.statusCode, statusMessage: 'Conflict', message: error.message })
  }
}
