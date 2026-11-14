import type { DisplayState } from '../../shared/display'
import { viewShowsPhotos } from '../../shared/layouts'
import type { LayoutSummary } from '../../shared/layouts'

// Which photo feed a display shows (architecture §5), most specific first: the
// schedule window in charge, then the custom layout on the wall, then the
// display's own `photo_source` (the remote, Home Assistant). The photo service
// takes this list and uses the first of them that is set up, else its own
// fallback, so a reference to a feed that has since left the config (or a layout
// edited to name one) costs nothing: it is skipped. Pure, so the route that
// serves photos and the control service that notices a change share it.

type FeedState = Pick<DisplayState, 'view' | 'layout' | 'schedule' | 'photo_source'>

/**
 * The feeds `state` asks for, in the order to try them, without repeats. A
 * layout only counts while the view is `custom`, because `layout` is sticky and
 * stays on the state when the view changes away from it, and a layout that is no
 * longer in the library names nothing.
 */
export function photoFeedPreferences(state: FeedState, layouts: readonly LayoutSummary[]): string[] {
  const layout = state.view === 'custom' && state.layout !== null ? layouts.find(known => known.id === state.layout) : undefined
  const asked = [state.schedule?.photo_feed, layout?.photo_feed, state.photo_source]
  return [...new Set(asked.filter((feed): feed is string => typeof feed === 'string' && feed !== ''))]
}

/**
 * Whether the display is on a view with photos both before and after, and asks
 * for different feeds. Then the photo on the wall belongs to the old feed and
 * should move on at once rather than at the end of its interval. Changing to a
 * photo view from another needs no nudge: the wall fetches a photo on arriving.
 */
export function photoFeedChanged(before: FeedState, beforeLayouts: readonly LayoutSummary[], after: FeedState, afterLayouts: readonly LayoutSummary[]): boolean {
  const shows = (state: FeedState, layouts: readonly LayoutSummary[]) =>
    viewShowsPhotos(state.view, state.layout === null ? null : layouts.find(layout => layout.id === state.layout))
  if (!shows(before, beforeLayouts) || !shows(after, afterLayouts)) return false
  const was = photoFeedPreferences(before, beforeLayouts)
  const now = photoFeedPreferences(after, afterLayouts)
  return was.length !== now.length || was.some((feed, index) => feed !== now[index])
}
