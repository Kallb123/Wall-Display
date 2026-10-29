import type { H3Event } from 'h3'
import { PIN_ERRORS, PIN_HEADER } from '../../shared/remote'
import { createPinGuard } from '../remote/pin'

// Kept for the life of the process, so wrong PINs are counted across requests.
const guard = createPinGuard()

/**
 * Lets a request through when `remote.pin` is unset or the request carries it
 * in the `x-wallcal-pin` header. Otherwise throws a 401, or a 429 for a client
 * that has sent too many wrong PINs. Call it first in a route, before anything
 * that would tell an unauthenticated caller something. The client is the
 * socket's address, not `X-Forwarded-For`, which a caller could set to dodge the
 * lockout. The PIN is never logged or echoed.
 */
export function requireRemotePin(event: H3Event): void {
  const result = guard.check(useConfig().remote?.pin, getRequestHeader(event, PIN_HEADER), getRequestIP(event) ?? 'unknown')
  if (result === 'ok') return
  if (result === 'locked') throw createError({ statusCode: 429, statusMessage: 'Too Many Requests', message: PIN_ERRORS.locked })
  throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: PIN_ERRORS[result] })
}
