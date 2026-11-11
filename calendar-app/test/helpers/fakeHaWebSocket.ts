import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

// A Home Assistant WebSocket API (`/api/websocket`) small enough for a test: it
// asks for the token, answers `subscribe_trigger` and `ping`, and lets the test
// fire a trigger. The WebSocket framing is written out here (text frames, close
// and ping only), so the tests need no WebSocket server library.

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export interface FakeHomeAssistant {
  server: Server
  port: number
  /** Every message the app sent, in order. */
  received: Record<string, unknown>[]
  /** The triggers the app has subscribed to on the open connection, by message id. */
  subscriptions: Map<number, unknown>
  /** Sends an event to every subscription whose trigger names `entityId`. */
  fireState: (entityId: string, toState: string) => void
  /** Resolves once the app has subscribed to `count` triggers. */
  subscribed: (count: number) => Promise<void>
  close: () => Promise<void>
}

/** A frame from the server: unmasked, final, text unless `opcode` says otherwise. */
function frame(payload: Buffer, opcode = 0x1): Buffer {
  const length = payload.length
  const head = length < 126
    ? Buffer.from([0x80 | opcode, length])
    : Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
  return Buffer.concat([head, payload])
}

/** Reads whole frames off the front of `buffer`. Client frames are always masked. Payloads over 64 KiB are not expected. */
function readFrames(buffer: Buffer): { frames: { opcode: number, payload: Buffer }[], rest: Buffer } {
  const frames: { opcode: number, payload: Buffer }[] = []
  let offset = 0
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset]! & 0x0f
    let length = buffer[offset + 1]! & 0x7f
    let at = offset + 2
    if (length === 126) {
      if (buffer.length < at + 2) break
      length = buffer.readUInt16BE(at)
      at += 2
    }
    if (buffer.length < at + 4 + length) break
    const mask = buffer.subarray(at, at + 4)
    const payload = Buffer.from(buffer.subarray(at + 4, at + 4 + length))
    for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!
    frames.push({ opcode, payload })
    offset = at + 4 + length
  }
  return { frames, rest: buffer.subarray(offset) }
}

export async function startFakeHomeAssistant(token: string): Promise<FakeHomeAssistant> {
  const received: Record<string, unknown>[] = []
  const subscriptions = new Map<number, unknown>()
  const sockets = new Set<Socket>()
  let current: Socket | undefined
  const waiting: (() => void)[] = []

  const send = (socket: Socket, message: unknown) => socket.write(frame(Buffer.from(JSON.stringify(message))))

  const server = createServer((_request, response) => response.writeHead(404).end())
  server.on('upgrade', (request, socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    if (request.url !== '/api/websocket') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
      return
    }
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}${GUID}`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    current = socket
    subscriptions.clear()
    send(socket, { type: 'auth_required', ha_version: '2026.11.0' })

    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      const { frames, rest } = readFrames(Buffer.concat([buffered, chunk]))
      buffered = rest
      for (const { opcode, payload } of frames) {
        if (opcode === 0x8) {
          socket.end(frame(Buffer.alloc(0), 0x8))
          continue
        }
        if (opcode === 0x9) {
          socket.write(frame(payload, 0xa))
          continue
        }
        if (opcode !== 0x1) continue
        const message = JSON.parse(payload.toString('utf8')) as Record<string, unknown>
        received.push(message)
        if (message.type === 'auth') {
          send(socket, message.access_token === token ? { type: 'auth_ok', ha_version: '2026.11.0' } : { type: 'auth_invalid', message: 'Invalid access token or password' })
        } else if (message.type === 'subscribe_trigger') {
          subscriptions.set(message.id as number, message.trigger)
          send(socket, { id: message.id, type: 'result', success: true, result: null })
          for (const wake of waiting.splice(0)) wake()
        } else if (message.type === 'ping') {
          send(socket, { id: message.id, type: 'pong' })
        }
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  return {
    server,
    port: (server.address() as AddressInfo).port,
    received,
    subscriptions,
    fireState(entityId, toState) {
      if (!current) throw new Error('the app is not connected')
      for (const [id, trigger] of subscriptions) {
        const entities = (trigger as { entity_id?: string[] }).entity_id ?? []
        if (!entities.includes(entityId)) continue
        send(current, {
          id,
          type: 'event',
          event: { variables: { trigger: { platform: 'state', entity_id: entityId, to_state: { entity_id: entityId, state: toState } } }, context: null },
        })
      }
    },
    async subscribed(count) {
      const deadline = Date.now() + 30_000
      while (subscriptions.size < count) {
        if (Date.now() > deadline) throw new Error(`only ${subscriptions.size} of ${count} triggers were subscribed to`)
        await new Promise<void>((resolve) => {
          waiting.push(resolve)
          setTimeout(resolve, 200)
        })
      }
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise(resolve => server.close(resolve))
    },
  }
}
