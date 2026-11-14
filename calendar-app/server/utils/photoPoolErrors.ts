import { PhotoPoolError } from '../photoPools/errors'

/** Runs a photo pool write and answers a `PhotoPoolError` it throws as the HTTP error it stands for. Anything else passes through. */
export function answeringPhotoPoolErrors<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (!(error instanceof PhotoPoolError)) throw error
    throw createError({ statusCode: error.statusCode, statusMessage: 'Conflict', message: error.message })
  }
}
