import { describe, expect, it } from 'vitest'
import { eventLocation } from '../../../shared/location'

describe('eventLocation', () => {
  it('shows a plain place as it is', () => {
    expect(eventLocation('Home')).toBe('Home')
    expect(eventLocation('Room 4.2')).toBe('Room 4.2')
    expect(eventLocation("St.Mary's")).toBe("St.Mary's")
    expect(eventLocation('Kitchen')).toBe('Kitchen')
  })

  it('has nothing for no location or a blank one', () => {
    expect(eventLocation(null)).toBeNull()
    expect(eventLocation(undefined)).toBeNull()
    expect(eventLocation('')).toBeNull()
    expect(eventLocation('  \n ')).toBeNull()
  })

  it('has nothing for a link', () => {
    for (const link of [
      'https://meet.google.com/abc-defg-hij',
      'http://example.com',
      'HTTPS://Zoom.us/j/123',
      'tel:+441234567890',
      'mailto:a@example.com',
      'www.example.com',
      'meet.google.com/abc-defg-hij',
      'zoom.us/j/123?pwd=x',
      'teams.microsoft.com/l/meetup-join/19%3ameeting',
      'example.com',
      'example.com:8080',
      '  https://zoom.us/j/123  ',
      'https://example.com/a,b',
    ]) expect(eventLocation(link), link).toBeNull()
  })

  it('cuts a longer location to its first part', () => {
    expect(eventLocation('Leisure Centre, 12 High Street, Town')).toBe('Leisure Centre')
    expect(eventLocation('Leisure Centre\n12 High Street')).toBe('Leisure Centre')
    expect(eventLocation('Leisure Centre\r\n12 High Street')).toBe('Leisure Centre')
    expect(eventLocation('Leisure Centre\\n12 High Street')).toBe('Leisure Centre')
    expect(eventLocation('Leisure Centre\\, 12 High Street')).toBe('Leisure Centre')
  })

  it('uses the first part that has anything in it', () => {
    expect(eventLocation(', 12 High St')).toBe('12 High St')
    expect(eventLocation('\n\n Hall , Town')).toBe('Hall')
  })

  it('has nothing when the first part is a link', () => {
    expect(eventLocation('https://zoom.us/j/123, Room 4')).toBeNull()
    expect(eventLocation('meet.google.com/abc\nRoom 4')).toBeNull()
  })

  it('makes runs of white space one space', () => {
    expect(eventLocation('  Village \t  Hall  ,Town')).toBe('Village Hall')
  })
})
