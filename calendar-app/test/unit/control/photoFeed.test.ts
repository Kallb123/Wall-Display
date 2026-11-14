import { describe, expect, it } from 'vitest'
import { displayStateSchema } from '../../../shared/display'
import type { DisplayState } from '../../../shared/display'
import type { LayoutSummary } from '../../../shared/layouts'
import { photoFeedChanged, photoFeedPreferences } from '../../../server/control/photoFeed'

// Which photo feeds a display asks for, and when a change of them should move
// the photo on.

const layouts: LayoutSummary[] = [
  { id: 'kitchen', name: 'Kitchen', components: ['week', 'photo'], photo_feed: 'mountains' },
  { id: 'plain', name: 'Plain', components: ['photo'], photo_feed: null },
  { id: 'board', name: 'Board', components: ['month'], photo_feed: null },
]

const window = { schedule: 'daytime', rule: 0, view: 'photo', return_view: 'month', layout: null, return_layout: null, photo_feed: null } as const

function state(overrides: Partial<DisplayState> = {}): DisplayState {
  return displayStateSchema.parse({ photo_source: 'immich', ...overrides })
}

describe('photoFeedPreferences', () => {
  it('is the display\'s own choice when nothing more specific asks', () => {
    expect(photoFeedPreferences(state({ view: 'photo', photo_source: 'local' }), layouts)).toEqual(['local'])
  })

  it('puts the schedule window first, then the layout, then the display\'s choice', () => {
    const shown = state({ view: 'custom', layout: 'kitchen', schedule: { ...window, view: 'custom', layout: 'kitchen', photo_feed: 'garden' } })

    expect(photoFeedPreferences(shown, layouts)).toEqual(['garden', 'mountains', 'immich'])
  })

  it('leaves out a layout that names no feed, or is not on the wall', () => {
    expect(photoFeedPreferences(state({ view: 'custom', layout: 'plain' }), layouts)).toEqual(['immich'])
    // The layout is sticky: it stays on the state when the view changes away from it.
    expect(photoFeedPreferences(state({ view: 'photo', layout: 'kitchen' }), layouts)).toEqual(['immich'])
    expect(photoFeedPreferences(state({ view: 'custom', layout: 'deleted' }), layouts)).toEqual(['immich'])
  })

  it('has no repeats, keeping the first place a feed is asked for', () => {
    const shown = state({ view: 'custom', layout: 'kitchen', photo_source: 'immich', schedule: { ...window, photo_feed: 'immich' } })

    expect(photoFeedPreferences(shown, layouts)).toEqual(['immich', 'mountains'])
  })
})

describe('photoFeedChanged', () => {
  it('is true when a window with a feed begins on a photo view', () => {
    const before = state({ view: 'photo' })
    const after = state({ view: 'photo', schedule: { ...window, photo_feed: 'garden' } })

    expect(photoFeedChanged(before, layouts, after, layouts)).toBe(true)
  })

  it('is true when the layout on the wall is edited to another feed', () => {
    const shown = state({ view: 'custom', layout: 'kitchen' })
    const edited = layouts.map(layout => layout.id === 'kitchen' ? { ...layout, photo_feed: 'garden' } : layout)

    expect(photoFeedChanged(shown, layouts, shown, edited)).toBe(true)
    expect(photoFeedChanged(shown, layouts, shown, layouts)).toBe(false)
  })

  it('is false when the view arrives at or leaves the photos, which fetch on their own', () => {
    const photo = state({ view: 'photo', schedule: { ...window, photo_feed: 'garden' } })

    expect(photoFeedChanged(state({ view: 'month' }), layouts, photo, layouts)).toBe(false)
    expect(photoFeedChanged(photo, layouts, state({ view: 'month' }), layouts)).toBe(false)
  })
})
