import { describe, expect, it, vi } from 'vitest'
import { createEventBus, getEventBus } from '../../../server/events/bus'

describe('the event bus', () => {
  it('calls every handler for an event, in the order they subscribed, with its payload', () => {
    const bus = createEventBus()
    const calls: string[] = []
    bus.on('events.updated', ({ calendarIds }) => calls.push(`first ${calendarIds.join(',')}`))
    bus.on('events.updated', ({ calendarIds }) => calls.push(`second ${calendarIds.join(',')}`))

    bus.emit('events.updated', { calendarIds: ['family', 'work'] })

    expect(calls).toEqual(['first family,work', 'second family,work'])
  })

  it('does nothing when nobody is listening', () => {
    expect(() => createEventBus().emit('events.updated', { calendarIds: [] })).not.toThrow()
  })

  it('stops calling a handler once it has unsubscribed, and leaves the others', () => {
    const bus = createEventBus()
    const kept = vi.fn()
    const dropped = vi.fn()
    bus.on('events.updated', kept)
    const unsubscribe = bus.on('events.updated', dropped)

    unsubscribe()
    unsubscribe()
    bus.emit('events.updated', { calendarIds: ['family'] })

    expect(kept).toHaveBeenCalledTimes(1)
    expect(dropped).not.toHaveBeenCalled()
  })

  it('lets a handler unsubscribe itself while it is being called', () => {
    const bus = createEventBus()
    const later = vi.fn()
    const unsubscribe = bus.on('events.updated', () => unsubscribe())
    bus.on('events.updated', later)

    bus.emit('events.updated', { calendarIds: ['a'] })
    bus.emit('events.updated', { calendarIds: ['b'] })

    expect(later).toHaveBeenCalledTimes(2)
  })

  it('logs a handler that throws and still calls the others and returns to the emitter', () => {
    const log = { error: vi.fn() }
    const bus = createEventBus(log)
    const after = vi.fn()
    bus.on('events.updated', () => { throw new Error('socket closed') })
    bus.on('events.updated', after)

    expect(() => bus.emit('events.updated', { calendarIds: ['family'] })).not.toThrow()

    expect(after).toHaveBeenCalledWith({ calendarIds: ['family'] })
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0]![0]).toContain('events.updated')
    expect(log.error.mock.calls[0]![0]).toContain('socket closed')
  })

  it('has one shared instance for the server', () => {
    const handler = vi.fn()
    const unsubscribe = getEventBus().on('events.updated', handler)

    getEventBus().emit('events.updated', { calendarIds: ['family'] })
    unsubscribe()

    expect(getEventBus()).toBe(getEventBus())
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
