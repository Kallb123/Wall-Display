import { DEFAULT_POOL_UNSPLASH_COUNT, MAX_POOL_SOURCES, photoPoolInputSchema } from '../../shared/photoPools'
import type { PhotoPool, PhotoPoolInput, PhotoPoolSource, PhotoPoolSourceKind, PhotoPoolSourceStatus, PhotoPoolsResponse , UNSPLASH_ORIENTATIONS} from '../../shared/photoPools'
import type { ChipStatus } from './settings'
import { photoCount } from './settings'

// What the photo pool editor does to the pool it is editing (Settings → Photos):
// a draft of the form, with one flat row per source so each field is a plain
// string the inputs can hold; adding, removing and moving sources; turning the
// draft into what the server accepts; the problems with it, found with the
// server's own schema; and what to say about how a source is doing. Pure: no
// I/O, and no function changes the draft it is given.

/** One source as the form holds it: every field a string, `text` being the one the kind is about (query, collection id, topic slug, album id or feed id). */
export interface DraftSource {
  /** Identifies the row while it is being moved or removed; never sent. */
  key: number
  kind: PhotoPoolSourceKind
  text: string
  /** One of `UNSPLASH_ORIENTATIONS`, or '' for any. Only Unsplash kinds use it. */
  orientation: string
  /** A whole number, or '' for the default. Only Unsplash kinds use it. A number input holds a number once it has one, so either is read. */
  count: string | number
}

/** The form's state. */
export interface PoolDraft {
  name: string
  sources: DraftSource[]
}

/** The kinds that take an orientation and a count. */
export const UNSPLASH_KINDS: readonly PhotoPoolSourceKind[] = ['unsplash_search', 'unsplash_collection', 'unsplash_topic']

/** The kinds a person can choose from, in the order the "Add source" control lists them. */
export const ADDABLE_KINDS: readonly PhotoPoolSourceKind[] = ['unsplash_search', 'unsplash_collection', 'unsplash_topic', 'immich_album', 'feed']

/** Whether a kind of source is an Unsplash one (and so takes an orientation and a count). */
export const isUnsplashKind = (kind: PhotoPoolSourceKind): boolean => UNSPLASH_KINDS.includes(kind)

/** The count input's placeholder: what a source lists if no count is given. */
export const COUNT_PLACEHOLDER = String(DEFAULT_POOL_UNSPLASH_COUNT)

let nextKey = 1

/** A source of this kind with nothing filled in. A feed starts on `feed`, if given (the first feed on offer). */
export function newSource(kind: PhotoPoolSourceKind, feed = ''): DraftSource {
  return { key: nextKey++, kind, text: kind === 'feed' ? feed : '', orientation: '', count: '' }
}

/** A form for a pool not yet made: no name, no sources. */
export function emptyDraft(): PoolDraft {
  return { name: '', sources: [] }
}

/** The form for a saved pool, to change it. */
export function poolDraftOf(pool: PhotoPool): PoolDraft {
  return {
    name: pool.name,
    sources: pool.sources.map((source): DraftSource => {
      const base = { key: nextKey++, orientation: '', count: '' }
      switch (source.kind) {
        case 'unsplash_search':
          return { ...base, kind: source.kind, text: source.query, orientation: source.orientation ?? '', count: source.count === undefined ? '' : String(source.count) }
        case 'unsplash_collection':
          return { ...base, kind: source.kind, text: source.collection, orientation: source.orientation ?? '', count: source.count === undefined ? '' : String(source.count) }
        case 'unsplash_topic':
          return { ...base, kind: source.kind, text: source.topic, orientation: source.orientation ?? '', count: source.count === undefined ? '' : String(source.count) }
        case 'immich_album':
          return { ...base, kind: source.kind, text: source.album_id }
        case 'feed':
          return { ...base, kind: source.kind, text: source.feed }
      }
    }),
  }
}

/** The draft with a source added at the end. */
export function addSource(draft: PoolDraft, source: DraftSource): PoolDraft {
  return { ...draft, sources: [...draft.sources, source] }
}

/** The draft without the source at `index`. */
export function removeSource(draft: PoolDraft, index: number): PoolDraft {
  return { ...draft, sources: draft.sources.filter((_, at) => at !== index) }
}

/** The draft with the source at `index` moved one place (-1 up, 1 down). One that can't move leaves the very same draft. */
export function moveSource(draft: PoolDraft, index: number, by: -1 | 1): PoolDraft {
  const to = index + by
  if (index < 0 || index >= draft.sources.length || to < 0 || to >= draft.sources.length) return draft
  const sources = [...draft.sources]
  const [moved] = sources.splice(index, 1)
  sources.splice(to, 0, moved!)
  return { ...draft, sources }
}

/** What the form holds as the server takes it: names and ids trimmed, and an orientation or count left empty left out. */
export function inputOfDraft(draft: PoolDraft): PhotoPoolInput {
  return {
    name: draft.name.trim(),
    sources: draft.sources.map((source): PhotoPoolSource => {
      const text = source.text.trim()
      const extras = {
        ...(source.orientation ? { orientation: source.orientation as (typeof UNSPLASH_ORIENTATIONS)[number] } : {}),
        ...(String(source.count).trim() ? { count: Number(source.count) } : {}),
      }
      switch (source.kind) {
        case 'unsplash_search':
          return { kind: 'unsplash_search', query: text, ...extras }
        case 'unsplash_collection':
          return { kind: 'unsplash_collection', collection: text, ...extras }
        case 'unsplash_topic':
          return { kind: 'unsplash_topic', topic: text, ...extras }
        case 'immich_album':
          return { kind: 'immich_album', album_id: text }
        case 'feed':
          return { kind: 'feed', feed: text }
      }
    }),
  }
}

/** The key a field's errors are listed under, such as `sources.0.query`. */
export function sourceFieldPath(index: number, kind: PhotoPoolSourceKind, field: 'text' | 'orientation' | 'count'): string {
  if (field !== 'text') return `sources.${index}.${field}`
  const names: Record<PhotoPoolSourceKind, string> = { unsplash_search: 'query', unsplash_collection: 'collection', unsplash_topic: 'topic', immich_album: 'album_id', feed: 'feed' }
  return `sources.${index}.${names[kind]}`
}

/**
 * What is wrong with the draft, as the server would find it, by dotted path
 * (`name`, `sources`, `sources.1.query`), the first message for each. Empty
 * when it can be saved. A message reads on after the field's name ("must not be empty").
 */
export function poolErrors(draft: PoolDraft): Record<string, string> {
  const parsed = photoPoolInputSchema.safeParse(inputOfDraft(draft))
  const errors: Record<string, string> = {}
  if (parsed.success) return errors
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.')
    errors[path] ??= issue.message
  }
  return errors
}

/** Whether two forms hold the same thing, so the editor can tell if there is anything to save. */
export function sameDraft(a: PoolDraft, b: PoolDraft): boolean {
  const flat = (draft: PoolDraft) => JSON.stringify([draft.name.trim(), draft.sources.map(({ kind, text, orientation, count }) => [kind, text.trim(), orientation, String(count).trim()])])
  return flat(a) === flat(b)
}

/** The kinds of source that can be added now: Unsplash ones need the config's Unsplash block, an Immich album the Immich block, a feed at least one feed; and a pool holds at most `MAX_POOL_SOURCES`. */
export function availableKinds(response: Pick<PhotoPoolsResponse, 'unsplash_available' | 'immich_available' | 'feeds'>, count: number): PhotoPoolSourceKind[] {
  if (count >= MAX_POOL_SOURCES) return []
  return ADDABLE_KINDS.filter((kind) => {
    if (isUnsplashKind(kind)) return response.unsplash_available
    if (kind === 'immich_album') return response.immich_available
    return response.feeds.length > 0
  })
}

/** What is said about one source of a saved pool: a chip, and a line under it. */
export interface SourceStatusLine {
  chip: ChipStatus
  /** "Can't run: …", the last error, "N photos" or "Not listed yet". */
  text: string
}

/** How a source is doing, in words, from the server's status for it. */
export function sourceStatusLine(status: PhotoPoolSourceStatus | undefined): SourceStatusLine {
  if (status?.problem) return { chip: { label: 'Can\'t run', tone: 'bad', detail: null }, text: `Can't run: ${status.problem}` }
  if (status?.last_error) return { chip: { label: status.last_success_at ? 'Out of reach' : 'Not working', tone: 'bad', detail: null }, text: status.last_error }
  if (status?.last_success_at) return { chip: { label: 'Working', tone: 'ok', detail: null }, text: photoCount(status.photos) }
  return { chip: { label: 'Not listed yet', tone: 'warn', detail: null }, text: 'Not listed yet' }
}
