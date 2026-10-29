import { SOCKET_ROLES } from '../../shared/display'
import type { ServerMessage, SocketRole } from '../../shared/display'

// Keeps track of who is connected over WebSocket, by display and role, and
// sends to them. All socket use goes through here, so the transport (crossws
// today) can change without touching the rest of the app. A peer is just an
// id and a `send`, so a test uses fakes.

export interface HubPeer {
  /** Unique for the connection. */
  id: string
  send: (data: string) => void
}

export interface SocketHub {
  add: (peer: HubPeer, where: { displayId: string, role: SocketRole }) => void
  remove: (peer: HubPeer) => void
  /** Sends to every peer of one display, or only those with one of `roles`. */
  sendToDisplay: (displayId: string, message: ServerMessage, roles?: readonly SocketRole[]) => void
  /** Sends to every peer of every display. */
  sendToAll: (message: ServerMessage) => void
  /** How many peers are connected. */
  size: () => number
  /** How many peers of one display are connected, by role. Every role is there, with 0 when none. */
  counts: (displayId: string) => Record<SocketRole, number>
}

interface Entry {
  peer: HubPeer
  displayId: string
  role: SocketRole
}

export function createSocketHub(log: Pick<Console, 'warn'> = console): SocketHub {
  const entries = new Map<string, Entry>()

  /** Sends `message` to the entries that pass `filter`. A peer that can't be written to is dropped; the others still get it. */
  function send(message: ServerMessage, filter: (entry: Entry) => boolean): void {
    // Stringified once, whoever is listening.
    const data = JSON.stringify(message)
    for (const entry of [...entries.values()]) {
      if (!filter(entry)) continue
      try {
        entry.peer.send(data)
      } catch (error) {
        log.warn(`[ws] dropping a ${entry.role} of ${entry.displayId}: sending failed: ${error instanceof Error ? error.message : String(error)}`)
        entries.delete(entry.peer.id)
      }
    }
  }

  return {
    add(peer, { displayId, role }) {
      entries.set(peer.id, { peer, displayId, role })
    },
    remove(peer) {
      entries.delete(peer.id)
    },
    sendToDisplay(displayId, message, roles) {
      send(message, entry => entry.displayId === displayId && (roles === undefined || roles.includes(entry.role)))
    },
    sendToAll(message) {
      send(message, () => true)
    },
    size: () => entries.size,
    counts(displayId) {
      const counts = Object.fromEntries(SOCKET_ROLES.map(role => [role, 0])) as Record<SocketRole, number>
      for (const entry of entries.values()) {
        if (entry.displayId === displayId) counts[entry.role]++
      }
      return counts
    },
  }
}

const shared = createSocketHub()

/** The server's one hub. */
export function getSocketHub(): SocketHub {
  return shared
}
