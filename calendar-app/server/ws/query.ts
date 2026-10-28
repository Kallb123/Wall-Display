import { SOCKET_ROLES } from '../../shared/display'
import type { SocketRole } from '../../shared/display'

// Reads `/_ws?display=<id>&role=display|remote`. Pure, so the handler can
// refuse a bad connection before the upgrade and a test needs no socket.

export type SocketQuery =
  | { ok: true, displayId: string, role: SocketRole }
  /** `status` is the HTTP status to refuse the upgrade with. */
  | { ok: false, status: 400 | 404, message: string }

export function parseSocketQuery(url: string, hasDisplay: (displayId: string) => boolean): SocketQuery {
  const { searchParams } = new URL(url, 'http://localhost')
  const displayId = searchParams.get('display')
  const role = searchParams.get('role')

  if (!displayId) return { ok: false, status: 400, message: 'display is required' }
  if (!SOCKET_ROLES.includes(role as SocketRole)) return { ok: false, status: 400, message: `role must be ${SOCKET_ROLES.join(' or ')}` }
  if (!hasDisplay(displayId)) return { ok: false, status: 404, message: `Unknown display "${displayId}"` }
  return { ok: true, displayId, role: role as SocketRole }
}
