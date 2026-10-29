import { describe, expect, it } from 'vitest'
import { SourceError, safeErrorMessage } from '../../../server/sources/errors'
import { HomeAssistantSourceError } from '../../../server/sources/homeassistant/errors'
import { IcsSourceError } from '../../../server/sources/ics/errors'

describe('safeErrorMessage', () => {
  it.each([
    ['a SourceError', new SourceError('fetch', 'could not connect (ECONNREFUSED)'), 'could not connect (ECONNREFUSED)'],
    ['an IcsSourceError', new IcsSourceError('parse', 'the response is not an iCalendar file'), 'the response is not an iCalendar file'],
    ['a HomeAssistantSourceError', new HomeAssistantSourceError('fetch', 'timed out after 30 s'), 'timed out after 30 s'],
  ])('passes the message of %s through', (_name, error, message) => {
    expect(safeErrorMessage(error)).toBe(message)
  })

  it('reports any other error by its name only', () => {
    expect(safeErrorMessage(new TypeError('Failed to parse URL from https://x.example/secret'))).toBe('unexpected error (TypeError)')
    expect(safeErrorMessage(new Error('boom'))).toBe('unexpected error (Error)')
  })

  it('reports a thrown value that is not an error as unknown', () => {
    expect(safeErrorMessage('https://x.example/secret')).toBe('unexpected error (unknown)')
    expect(safeErrorMessage(undefined)).toBe('unexpected error (unknown)')
  })
})

describe('the source errors', () => {
  it('are SourceErrors with a kind and their own name', () => {
    const ics = new IcsSourceError('fetch', 'x')
    const ha = new HomeAssistantSourceError('parse', 'y')

    expect(ics).toBeInstanceOf(SourceError)
    expect(ics).toBeInstanceOf(Error)
    expect([ics.name, ics.kind]).toEqual(['IcsSourceError', 'fetch'])
    expect(ha).toBeInstanceOf(SourceError)
    expect([ha.name, ha.kind]).toEqual(['HomeAssistantSourceError', 'parse'])
  })
})
