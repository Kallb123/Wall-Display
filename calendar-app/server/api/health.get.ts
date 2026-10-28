import { checkDb } from '../db/health'

export default defineEventHandler((event) => {
  const dbError = checkDb(useDb())
  if (dbError !== null) {
    // Details stay in the log. The response says nothing about paths or internals.
    console.error(`[health] database check failed: ${dbError}`)
    setResponseStatus(event, 503)
    return { status: 'error', db: 'error' }
  }

  return {
    status: 'ok',
    uptime: process.uptime(),
    db: 'ok',
  }
})
