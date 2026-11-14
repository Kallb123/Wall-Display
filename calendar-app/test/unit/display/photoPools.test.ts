import { describe, expect, it } from 'vitest'
import { MAX_POOL_SOURCES } from '../../../shared/photoPools'
import type { PhotoPool } from '../../../shared/photoPools'
import { addSource, availableKinds, poolDraftOf, emptyDraft, inputOfDraft, moveSource, newSource, poolErrors, removeSource, sameDraft, sourceFieldPath, sourceStatusLine } from '../../../app/utils/photoPools'

const feeds = [{ id: 'local', name: 'Local folder', source: 'local' as const }]

describe('the draft', () => {
  it('starts empty, and a new source of each kind starts blank', () => {
    expect(emptyDraft()).toEqual({ name: '', sources: [] })
    expect(newSource('unsplash_search')).toMatchObject({ kind: 'unsplash_search', text: '', orientation: '', count: '' })
    expect(newSource('feed', 'local').text).toBe('local')
    expect(newSource('immich_album', 'local').text).toBe('')
    expect(newSource('feed').key).not.toBe(newSource('feed').key)
  })

  it('adds, removes and moves sources without changing the draft it is given', () => {
    const a = newSource('unsplash_search')
    const b = newSource('unsplash_topic')
    const c = newSource('feed', 'local')
    const draft = addSource(addSource(addSource(emptyDraft(), a), b), c)

    expect(draft.sources.map(source => source.kind)).toEqual(['unsplash_search', 'unsplash_topic', 'feed'])
    expect(moveSource(draft, 2, -1).sources.map(source => source.key)).toEqual([a.key, c.key, b.key])
    expect(moveSource(draft, 0, 1).sources[0]).toBe(b)
    expect(moveSource(draft, 0, -1)).toBe(draft)
    expect(moveSource(draft, 2, 1)).toBe(draft)
    expect(removeSource(draft, 1).sources).toEqual([a, c])
    expect(draft.sources).toHaveLength(3)
  })

  it('becomes what the server takes: trimmed, leaving out an empty shape or count', () => {
    const search = { ...newSource('unsplash_search'), text: '  mountain lake ', orientation: 'landscape', count: '60' }
    const topic = { ...newSource('unsplash_topic'), text: 'nature ' }
    const album = { ...newSource('immich_album'), text: ' abc-123' }
    const feed = { ...newSource('feed'), text: 'local' }

    expect(inputOfDraft({ name: ' Mix ', sources: [search, topic, album, feed] })).toEqual({
      name: 'Mix',
      sources: [
        { kind: 'unsplash_search', query: 'mountain lake', orientation: 'landscape', count: 60 },
        { kind: 'unsplash_topic', topic: 'nature' },
        { kind: 'immich_album', album_id: 'abc-123' },
        { kind: 'feed', feed: 'local' },
      ],
    })
  })

  it('reads a saved pool back into the form, and into the same input', () => {
    const pool: PhotoPool = {
      id: 'mix',
      name: 'Mix',
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-01T10:00:00.000Z',
      sources: [{ kind: 'unsplash_collection', collection: '317099', count: 90 }, { kind: 'feed', feed: 'local' }],
    }

    expect(inputOfDraft(poolDraftOf(pool))).toEqual({ name: 'Mix', sources: pool.sources })
    expect(sameDraft(poolDraftOf(pool), poolDraftOf(pool))).toBe(true)
  })
})

describe('poolErrors', () => {
  it('is empty for a pool that can be saved', () => {
    expect(poolErrors({ name: 'Mix', sources: [{ ...newSource('feed'), text: 'local' }] })).toEqual({})
  })

  it('finds each problem by its dotted path', () => {
    const errors = poolErrors({
      name: ' ',
      sources: [{ ...newSource('unsplash_search'), text: '', count: '999' }, { ...newSource('unsplash_topic'), text: 'Not A Slug' }],
    })

    expect(errors.name).toBe('must not be empty')
    expect(errors[sourceFieldPath(0, 'unsplash_search', 'text')]).toBe('must not be empty')
    expect(errors[sourceFieldPath(0, 'unsplash_search', 'count')]).toContain('at most')
    expect(errors['sources.1.topic']).toContain('slug')
  })

  it('wants a source, and refuses the same one twice', () => {
    expect(poolErrors({ name: 'Mix', sources: [] }).sources).toBe('needs at least one source')
    const twice = { name: 'Mix', sources: [{ ...newSource('unsplash_search'), text: 'Cats' }, { ...newSource('unsplash_search'), text: 'cats ' }] }
    expect(poolErrors(twice)['sources.1']).toContain('same as another')
  })
})

describe('availableKinds', () => {
  const all = { unsplash_available: true, immich_available: true, feeds }

  it('offers every kind when the config can run them', () => {
    expect(availableKinds(all, 0)).toEqual(['unsplash_search', 'unsplash_collection', 'unsplash_topic', 'immich_album', 'feed'])
  })

  it('leaves out what the config lacks', () => {
    expect(availableKinds({ ...all, unsplash_available: false }, 0)).toEqual(['immich_album', 'feed'])
    expect(availableKinds({ ...all, immich_available: false }, 0)).toEqual(['unsplash_search', 'unsplash_collection', 'unsplash_topic', 'feed'])
    expect(availableKinds({ ...all, feeds: [] }, 0)).not.toContain('feed')
  })

  it('offers nothing once the pool is full', () => {
    expect(availableKinds(all, MAX_POOL_SOURCES)).toEqual([])
  })
})

describe('sourceStatusLine', () => {
  const status = { photos: 42, cached: 10, last_success_at: '2026-11-14T09:00:00Z', last_error: null, problem: null }

  it('says what is wrong before anything else', () => {
    expect(sourceStatusLine({ ...status, problem: 'the config has no Unsplash block', last_error: 'x' }).text).toBe('Can\'t run: the config has no Unsplash block')
  })

  it('gives the last error, then the photo count, then that it is not listed', () => {
    expect(sourceStatusLine({ ...status, last_error: 'Unsplash said no (HTTP 403)' })).toMatchObject({ text: 'Unsplash said no (HTTP 403)', chip: { tone: 'bad', label: 'Out of reach' } })
    expect(sourceStatusLine(status)).toMatchObject({ text: '42 photos', chip: { tone: 'ok' } })
    expect(sourceStatusLine({ ...status, photos: 1 }).text).toBe('1 photo')
    expect(sourceStatusLine({ ...status, last_success_at: null, photos: 0 })).toMatchObject({ text: 'Not listed yet', chip: { tone: 'warn' } })
    expect(sourceStatusLine(undefined).text).toBe('Not listed yet')
  })
})
