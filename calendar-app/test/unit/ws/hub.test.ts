import { describe, expect, it, vi } from 'vitest'
import type { ServerMessage } from '../../../shared/display'
import { createSocketHub, getSocketHub } from '../../../server/ws/hub'
import type { HubPeer } from '../../../server/ws/hub'

let nextId = 0

function peer(): HubPeer & { send: ReturnType<typeof vi.fn> } {
  return { id: `peer-${nextId++}`, send: vi.fn() }
}

const photoNext: ServerMessage = { type: 'photo.next', display_id: 'hallway' }
const eventsUpdated: ServerMessage = { type: 'events.updated', calendar_ids: ['family'] }

describe('the socket hub', () => {
  it('sends to the peers of one display only', () => {
    const hub = createSocketHub()
    const hallway = peer()
    const kitchen = peer()
    hub.add(hallway, { displayId: 'hallway', role: 'display' })
    hub.add(kitchen, { displayId: 'kitchen', role: 'display' })

    hub.sendToDisplay('hallway', photoNext)

    expect(hallway.send).toHaveBeenCalledWith(JSON.stringify(photoNext))
    expect(kitchen.send).not.toHaveBeenCalled()
  })

  it('sends to both roles unless asked for one', () => {
    const hub = createSocketHub()
    const display = peer()
    const remote = peer()
    hub.add(display, { displayId: 'hallway', role: 'display' })
    hub.add(remote, { displayId: 'hallway', role: 'remote' })

    hub.sendToDisplay('hallway', photoNext)
    hub.sendToDisplay('hallway', photoNext, ['display'])

    expect(display.send).toHaveBeenCalledTimes(2)
    expect(remote.send).toHaveBeenCalledTimes(1)
  })

  it('sends to everyone with sendToAll', () => {
    const hub = createSocketHub()
    const peers = [peer(), peer(), peer()]
    hub.add(peers[0]!, { displayId: 'hallway', role: 'display' })
    hub.add(peers[1]!, { displayId: 'hallway', role: 'remote' })
    hub.add(peers[2]!, { displayId: 'kitchen', role: 'display' })

    hub.sendToAll(eventsUpdated)

    for (const each of peers) expect(each.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify(eventsUpdated))
  })

  it('sends nothing to a peer that has been removed, and counts the rest', () => {
    const hub = createSocketHub()
    const gone = peer()
    const kept = peer()
    hub.add(gone, { displayId: 'hallway', role: 'remote' })
    hub.add(kept, { displayId: 'hallway', role: 'remote' })
    expect(hub.size()).toBe(2)

    hub.remove(gone)
    hub.remove(gone)
    hub.sendToAll(eventsUpdated)

    expect(hub.size()).toBe(1)
    expect(gone.send).not.toHaveBeenCalled()
    expect(kept.send).toHaveBeenCalledTimes(1)
  })

  it('drops a peer that fails to send, logs it, and still reaches the others', () => {
    const log = { warn: vi.fn() }
    const hub = createSocketHub(log)
    const broken = peer()
    broken.send.mockImplementation(() => { throw new Error('socket closed') })
    const before = peer()
    const after = peer()
    hub.add(before, { displayId: 'hallway', role: 'display' })
    hub.add(broken, { displayId: 'hallway', role: 'remote' })
    hub.add(after, { displayId: 'hallway', role: 'remote' })

    expect(() => hub.sendToDisplay('hallway', photoNext)).not.toThrow()
    hub.sendToDisplay('hallway', photoNext)

    expect(before.send).toHaveBeenCalledTimes(2)
    expect(after.send).toHaveBeenCalledTimes(2)
    expect(broken.send).toHaveBeenCalledTimes(1)
    expect(hub.size()).toBe(2)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toContain('socket closed')
  })

  it('sends the same text to everyone, built once', () => {
    const hub = createSocketHub()
    const stringify = vi.spyOn(JSON, 'stringify')
    hub.add(peer(), { displayId: 'hallway', role: 'display' })
    hub.add(peer(), { displayId: 'hallway', role: 'remote' })

    hub.sendToDisplay('hallway', photoNext)

    expect(stringify).toHaveBeenCalledTimes(1)
    stringify.mockRestore()
  })

  it('counts the peers of a display by role', () => {
    const hub = createSocketHub()
    hub.add(peer(), { displayId: 'hallway', role: 'display' })
    hub.add(peer(), { displayId: 'hallway', role: 'remote' })
    hub.add(peer(), { displayId: 'hallway', role: 'remote' })
    hub.add(peer(), { displayId: 'kitchen', role: 'display' })

    expect(hub.counts('hallway')).toEqual({ display: 1, remote: 2 })
    expect(hub.counts('kitchen')).toEqual({ display: 1, remote: 0 })
  })

  it('counts zero of every role for a display nobody is connected to', () => {
    const hub = createSocketHub()
    hub.add(peer(), { displayId: 'hallway', role: 'display' })

    expect(hub.counts('garage')).toEqual({ display: 0, remote: 0 })
    expect(createSocketHub().counts('hallway')).toEqual({ display: 0, remote: 0 })
  })

  it('stops counting a peer that is removed or dropped for failing to send', () => {
    const hub = createSocketHub({ warn: vi.fn() })
    const gone = peer()
    const broken = peer()
    broken.send.mockImplementation(() => { throw new Error('socket closed') })
    hub.add(gone, { displayId: 'hallway', role: 'remote' })
    hub.add(broken, { displayId: 'hallway', role: 'remote' })
    hub.add(peer(), { displayId: 'hallway', role: 'remote' })

    hub.remove(gone)
    hub.sendToAll(eventsUpdated)

    expect(hub.counts('hallway')).toEqual({ display: 0, remote: 1 })
  })

  it('does nothing when nobody is connected', () => {
    expect(() => createSocketHub().sendToAll(eventsUpdated)).not.toThrow()
  })

  it('has one shared hub for the server', () => {
    expect(getSocketHub()).toBe(getSocketHub())
  })
})
