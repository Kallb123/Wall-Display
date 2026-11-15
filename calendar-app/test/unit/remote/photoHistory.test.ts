import { describe, expect, it } from 'vitest'
import type { PhotoHistoryEntry } from '../../../shared/photoHistory'
import { detailRows, durationLabel, historySubtitle, historyTitle, onDisplayLabel, takenLabel } from '../../../app/utils/photoHistory'

// A Wednesday afternoon in London, in summer time (BST, UTC+1): 14:30 local.
const NOW = new Date('2026-06-10T13:30:00Z')
const TZ = 'Europe/London'

function entry(changes: Partial<PhotoHistoryEntry> = {}, details: PhotoHistoryEntry['details'] = {}): PhotoHistoryEntry {
  return {
    id: 7,
    photo_id: 'immich:abc',
    feed: 'immich',
    feed_name: null,
    provider: 'immich',
    rendition: 'landscape',
    shown_at: '2026-06-10T13:02:00Z',
    ended_at: '2026-06-10T13:07:00Z',
    image_url: null,
    width: 4000,
    height: 3000,
    orientation: 'landscape',
    taken_at: null,
    credit: null,
    ...changes,
    details,
  }
}

describe('historyTitle', () => {
  it('prefers the description, then the location, the photographer and the file name', () => {
    const all = { description: 'Sunset over the lake', location: 'Keswick, Cumbria', photographer: 'Jane Doe', file_name: 'trips/2025/IMG_1.jpg' }
    expect(historyTitle(entry({}, all))).toBe('Sunset over the lake')
    expect(historyTitle(entry({}, { ...all, description: null }))).toBe('Keswick, Cumbria')
    expect(historyTitle(entry({}, { ...all, description: undefined, location: '  ' }))).toBe('Jane Doe')
    expect(historyTitle(entry({}, { file_name: 'trips/2025/IMG_1.jpg' }))).toBe('IMG_1.jpg')
    expect(historyTitle(entry({}, { file_name: 'C:\\photos\\IMG_2.jpg' }))).toBe('IMG_2.jpg')
  })

  it('falls back to the source name for a photo about which nothing is known', () => {
    expect(historyTitle(entry({ provider: 'immich' }))).toBe('Photo from Immich')
    expect(historyTitle(entry({ provider: 'unsplash' }))).toBe('Photo from Unsplash')
    expect(historyTitle(entry({ provider: 'local' }))).toBe('Photo from Local folder')
    expect(historyTitle(entry({ provider: 'google' }))).toBe('Photo from Google Photos')
  })
})

describe('historySubtitle', () => {
  it('gives the location and the source, unless the location is the title', () => {
    expect(historySubtitle(entry({}, { description: 'Lake', location: 'Keswick' }))).toBe('Keswick \u00B7 Immich')
    expect(historySubtitle(entry({}, { location: 'Keswick' }))).toBe('Immich')
    expect(historySubtitle(entry({ provider: 'unsplash' }))).toBe('Unsplash')
  })
})

describe('onDisplayLabel', () => {
  it('is the two times for a photo shown today, in the display\'s zone', () => {
    expect(onDisplayLabel(entry(), NOW, TZ)).toBe('14:02 \u2013 14:07')
  })

  it('says "now" while it is still on', () => {
    expect(onDisplayLabel(entry({ ended_at: null }), NOW, TZ)).toBe('14:02 \u2013 now')
  })

  it('names yesterday and other days', () => {
    expect(onDisplayLabel(entry({ shown_at: '2026-06-09T13:02:00Z', ended_at: '2026-06-09T13:07:00Z' }), NOW, TZ)).toBe('Yesterday 14:02 \u2013 14:07')
    expect(onDisplayLabel(entry({ shown_at: '2026-06-01T13:02:00Z', ended_at: '2026-06-01T13:07:00Z' }), NOW, TZ)).toBe('Mon 1 Jun 14:02 \u2013 14:07')
  })

  it('adds the year for a day in another year', () => {
    expect(onDisplayLabel(entry({ shown_at: '2025-11-03T14:02:00Z', ended_at: '2025-11-03T14:07:00Z' }), NOW, TZ)).toBe('Mon 3 Nov 2025 14:02 \u2013 14:07')
  })

  it('reads the day in the display\'s zone, not UTC', () => {
    // 23:30 UTC on the 9th is 00:30 on the 10th in London.
    expect(onDisplayLabel(entry({ shown_at: '2026-06-09T23:30:00Z', ended_at: '2026-06-09T23:40:00Z' }), NOW, TZ)).toBe('00:30 \u2013 00:40')
  })

  it('names both days for a photo that was up over midnight', () => {
    const spanning = entry({ shown_at: '2026-06-09T22:58:00Z', ended_at: '2026-06-09T23:03:00Z' })
    expect(onDisplayLabel(spanning, NOW, TZ)).toBe('Yesterday 23:58 \u2013 Today 00:03')
    const older = entry({ shown_at: '2026-06-01T22:58:00Z', ended_at: '2026-06-01T23:03:00Z' })
    expect(onDisplayLabel(older, NOW, TZ)).toBe('Mon 1 Jun 23:58 \u2013 Tue 2 Jun 00:03')
  })

  it('names the day of a photo still on from yesterday', () => {
    expect(onDisplayLabel(entry({ shown_at: '2026-06-09T20:00:00Z', ended_at: null }), NOW, TZ)).toBe('Yesterday 21:00 \u2013 now')
  })
})

describe('durationLabel', () => {
  const lasted = (seconds: number) => durationLabel(entry({ ended_at: new Date(new Date('2026-06-10T13:02:00Z').getTime() + seconds * 1000).toISOString() }), NOW)

  it('counts seconds, minutes, and hours with minutes', () => {
    expect(lasted(0)).toBe('0 s')
    expect(lasted(45)).toBe('45 s')
    expect(lasted(60)).toBe('1 min')
    expect(lasted(300)).toBe('5 min')
    expect(lasted(3599)).toBe('59 min')
    expect(lasted(3600)).toBe('1 h')
    expect(lasted(4800)).toBe('1 h 20 min')
  })

  it('runs to now while the photo is still on, and never goes negative', () => {
    expect(durationLabel(entry({ ended_at: null }), NOW)).toBe('28 min')
    expect(durationLabel(entry({ shown_at: '2026-06-10T13:31:00Z', ended_at: null }), NOW)).toBe('0 s')
  })
})

describe('takenLabel', () => {
  it('is the long date and the time in the display\'s zone', () => {
    expect(takenLabel(entry({ taken_at: '2025-06-14T15:41:00Z' }), TZ)).toBe('Saturday 14 June 2025, 16:41')
    expect(takenLabel(entry({ taken_at: '2025-06-14T15:41:00Z' }), 'America/New_York')).toBe('Saturday 14 June 2025, 11:41')
  })

  it('is empty when the source doesn\'t know, or says something that isn\'t a date', () => {
    expect(takenLabel(entry({ taken_at: null }), TZ)).toBe('')
    expect(takenLabel(entry({ taken_at: 'yesterday-ish' }), TZ)).toBe('')
  })
})

describe('detailRows', () => {
  it('gives the rows of an Immich photo in order, with its link', () => {
    const rows = detailRows(entry({ taken_at: '2025-06-14T15:41:00Z', feed: 'immich', feed_name: 'Family album' }, {
      description: 'Sunset',
      location: 'Keswick, Cumbria, United Kingdom',
      camera: 'FUJIFILM X-T5',
      file_name: 'IMG_0001.jpg',
      people: ['Isla', 'Theo'],
      source_url: 'https://immich.example/photos/abc',
    }), NOW, TZ)

    expect(rows).toEqual([
      { label: 'Taken', value: 'Saturday 14 June 2025, 16:41' },
      { label: 'Location', value: 'Keswick, Cumbria, United Kingdom' },
      { label: 'Description', value: 'Sunset' },
      { label: 'People', value: 'Isla, Theo' },
      { label: 'Camera', value: 'FUJIFILM X-T5' },
      { label: 'File', value: 'IMG_0001.jpg' },
      { label: 'From', value: 'Family album' },
      { label: 'On display', value: '14:02 \u2013 14:07 (5 min)' },
      { label: 'Open', value: 'Open in Immich', href: 'https://immich.example/photos/abc' },
    ])
  })

  it('links the photographer and the page of an Unsplash photo', () => {
    const rows = detailRows(entry({ provider: 'unsplash', feed: 'pool1', ended_at: null }, {
      photographer: 'Jane Doe',
      photographer_url: 'https://unsplash.com/@jane?utm_source=wall_display',
      source_url: 'https://unsplash.com/photos/xyz?utm_source=wall_display',
    }), NOW, TZ)

    expect(rows).toEqual([
      { label: 'Photographer', value: 'Jane Doe', href: 'https://unsplash.com/@jane?utm_source=wall_display' },
      { label: 'From', value: 'pool1' },
      { label: 'On display', value: '14:02 \u2013 now (28 min)' },
      { label: 'Open', value: 'View on Unsplash', href: 'https://unsplash.com/photos/xyz?utm_source=wall_display' },
    ])
  })

  it('gives the path and the capture time of a local photo, and no link', () => {
    const rows = detailRows(entry({ provider: 'local', feed: 'local', taken_at: '2024-12-25T09:00:00Z' }, { file_name: 'christmas/IMG_9.jpg' }), NOW, TZ)

    expect(rows.map(row => row.label)).toEqual(['Taken', 'File', 'From', 'On display'])
    expect(rows[1]).toEqual({ label: 'File', value: 'christmas/IMG_9.jpg' })
  })

  it('leaves out empty values, and links that aren\'t web addresses', () => {
    const rows = detailRows(entry({}, { description: '  ', people: [' ', ''], location: null, photographer: 'Jane', photographer_url: 'javascript:alert(1)', source_url: 'not a url' }), NOW, TZ)

    expect(rows.map(row => row.label)).toEqual(['Photographer', 'From', 'On display'])
    expect(rows[0]).toEqual({ label: 'Photographer', value: 'Jane' })
  })
})
