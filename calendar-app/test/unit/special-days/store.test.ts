import { describe, expect, it } from 'vitest'
import type { SpecialDayInput } from '../../../shared/special-days'
import { specialDays } from '../../../server/db/schema'
import { createScene } from '../../../server/special-days/scenes'
import { createSpecialDay, deleteSpecialDay, duplicateSpecialDay, getSpecialDay, listSpecialDays, slugFor, updateSpecialDay } from '../../../server/special-days/store'
import { migratedMemoryDb } from '../db/helpers'

// The store against a migrated in-memory database. The input is what the
// schema in shared/special-days.ts produces, so it is written out in full.

const NOW = new Date('2026-10-28T12:00:00Z')
const LATER = new Date('2026-10-29T08:30:00Z')

function input(overrides: Partial<SpecialDayInput> = {}): SpecialDayInput {
  return { name: 'Christmas', month: 12, day: 25, year: null, repeat: 'yearly', scene_id: null, who: null, since_year: null, lead: 'month', lead_days: null, takeover: true, greeting: 'Merry Christmas', palette: 'warm', ...overrides }
}

/** A scene to point days at. */
function makeScene(db: Parameters<typeof createScene>[0]) {
  return createScene(db, { name: 'Birthday', lead: 'week', lead_days: null, takeover: true, greeting: 'Happy {nth} birthday, {who}!', palette: 'sage' }, NOW)
}

describe('createSpecialDay and getSpecialDay', () => {
  it('stores a days lead with its count', () => {
    const { db } = migratedMemoryDb()

    expect(createSpecialDay(db, input({ lead: 'days', lead_days: 10 }), NOW)).toMatchObject({ lead: 'days', lead_days: 10 })
  })

  it('stores no lead days for the other leads, whatever the input carries', () => {
    const { db } = migratedMemoryDb()

    expect(createSpecialDay(db, input({ lead: 'week', lead_days: 10 }), NOW).lead_days).toBeNull()
  })

  it('stores a day under a slug of its name, as the wire format', () => {
    const { db } = migratedMemoryDb()

    const created = createSpecialDay(db, input(), NOW)

    expect(created).toEqual({
      id: 'christmas',
      name: 'Christmas',
      month: 12,
      day: 25,
      year: null,
      repeat: 'yearly',
      scene_id: null,
      who: null,
      since_year: null,
      lead: 'month',
      lead_days: null,
      tile_art: null,
      takeover: true,
      full_art: null,
      greeting: 'Merry Christmas',
      palette: 'warm',
      extra_art: null,
      updated_at: '2026-10-28T12:00:00.000Z',
    })
    expect(getSpecialDay(db, 'christmas')).toEqual(created)
  })

  it('stores a one-off day with its year, and a blank greeting as null', () => {
    const { db } = migratedMemoryDb()

    const created = createSpecialDay(db, input({ name: 'Leaving party', month: 3, day: 14, year: 2027, repeat: 'once', takeover: false, greeting: null }), NOW)

    expect(created).toMatchObject({ year: 2027, repeat: 'once', takeover: false, greeting: null })
  })

  it('stores the scene, who and since_year, and a look that is all null to use the scene\'s', () => {
    const { db } = migratedMemoryDb()
    makeScene(db)

    const created = createSpecialDay(db, input({ name: 'Isla\'s birthday', scene_id: 'birthday', who: 'Isla', since_year: 2019, lead: null, takeover: null, greeting: null, palette: null }), NOW)

    expect(created).toMatchObject({ scene_id: 'birthday', who: 'Isla', since_year: 2019, lead: null, lead_days: null, takeover: null, greeting: null, palette: null, extra_art: null })
    expect(getSpecialDay(db, created.id)).toEqual(created)
  })

  it('stores a since_year only for a yearly day', () => {
    const { db } = migratedMemoryDb()

    const once = createSpecialDay(db, input({ name: 'Party', year: 2027, repeat: 'once', since_year: 2019 }), NOW)

    expect(once.since_year).toBeNull()
  })

  it('stores no lead days when the lead is left to the scene', () => {
    const { db } = migratedMemoryDb()

    expect(createSpecialDay(db, input({ lead: null, lead_days: 10 }), NOW)).toMatchObject({ lead: null, lead_days: null })
  })

  it('refuses a scene that is not there, as the table does', () => {
    const { db } = migratedMemoryDb()

    expect(() => createSpecialDay(db, input({ scene_id: 'nothing' }), NOW)).toThrow()
  })

  it('gives a second day with the same name the next free id', () => {
    const { db } = migratedMemoryDb()

    const ids = [input(), input({ day: 24 }), input({ day: 26 })].map(day => createSpecialDay(db, day, NOW).id)

    expect(ids).toEqual(['christmas', 'christmas-2', 'christmas-3'])
  })

  it('does not give a day the id of a route', () => {
    const { db } = migratedMemoryDb()

    expect(createSpecialDay(db, input({ name: 'Resolved' }), NOW).id).toBe('resolved-2')
  })

  it('is undefined for an id nobody has', () => {
    const { db } = migratedMemoryDb()

    expect(getSpecialDay(db, 'nothing')).toBeUndefined()
  })
})

describe('listSpecialDays', () => {
  it('is empty with nothing stored', () => {
    const { db } = migratedMemoryDb()

    expect(listSpecialDays(db)).toEqual([])
  })

  it('sorts by month, then day, then name', () => {
    const { db } = migratedMemoryDb()
    for (const [name, month, day] of [['New Year', 1, 1], ['Christmas', 12, 25], ['Zoe birthday', 6, 3], ['Alex birthday', 6, 3], ['Boxing Day', 12, 26], ['Dad birthday', 6, 2]] as const) {
      createSpecialDay(db, input({ name, month, day }), NOW)
    }

    expect(listSpecialDays(db).map(day => day.name)).toEqual(['New Year', 'Dad birthday', 'Alex birthday', 'Zoe birthday', 'Christmas', 'Boxing Day'])
  })
})

describe('updateSpecialDay', () => {
  it('replaces what the editor sets and stamps updated_at, keeping the id', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, input(), NOW)

    const updated = updateSpecialDay(db, 'christmas', input({ name: 'Xmas', day: 24, lead: 'week', takeover: false, greeting: null, palette: 'frost' }), LATER)

    expect(updated).toMatchObject({ id: 'christmas', name: 'Xmas', day: 24, lead: 'week', takeover: false, greeting: null, palette: 'frost', updated_at: '2026-10-29T08:30:00.000Z' })
    expect(getSpecialDay(db, 'christmas')).toEqual(updated)
  })

  it('keeps all the art, extra art included, which only the upload routes set', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, input(), NOW)
    db.update(specialDays).set({ tileArt: 'christmas-tile.webp', fullArt: 'christmas-full.webp', extraArt: 'christmas-extra.webp' }).run()

    const updated = updateSpecialDay(db, 'christmas', input({ name: 'Xmas' }), LATER)

    expect(updated).toMatchObject({ name: 'Xmas', tile_art: 'christmas-tile.webp', full_art: 'christmas-full.webp', extra_art: 'christmas-extra.webp' })
  })

  it('moves a day onto a scene and back, and drops since_year when it becomes a one-off', () => {
    const { db } = migratedMemoryDb()
    makeScene(db)
    createSpecialDay(db, input({ name: 'Isla', who: 'Isla', since_year: 2019 }), NOW)

    expect(updateSpecialDay(db, 'isla', input({ name: 'Isla', who: 'Isla', since_year: 2019, scene_id: 'birthday', lead: null, takeover: null, greeting: null, palette: null }), LATER))
      .toMatchObject({ scene_id: 'birthday', lead: null, takeover: null, palette: null, since_year: 2019 })
    expect(updateSpecialDay(db, 'isla', input({ name: 'Isla', who: null, year: 2027, repeat: 'once' }), LATER))
      .toMatchObject({ scene_id: null, who: null, since_year: null, year: 2027 })
  })

  it('can turn a one-off day into a yearly one, and back', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, input({ name: 'Party', month: 5, day: 5, year: 2027, repeat: 'once' }), NOW)

    expect(updateSpecialDay(db, 'party', input({ name: 'Party', month: 5, day: 5 }), LATER)).toMatchObject({ repeat: 'yearly', year: null })
    expect(updateSpecialDay(db, 'party', input({ name: 'Party', month: 5, day: 5, year: 2028, repeat: 'once' }), LATER)).toMatchObject({ repeat: 'once', year: 2028 })
  })

  it('is null for an id nobody has, and stores nothing', () => {
    const { db } = migratedMemoryDb()

    expect(updateSpecialDay(db, 'nothing', input(), NOW)).toBeNull()
    expect(listSpecialDays(db)).toEqual([])
  })
})

describe('deleteSpecialDay', () => {
  it('deletes the day and says so, and says no when there was none', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, input(), NOW)
    createSpecialDay(db, input({ name: 'New Year', month: 1, day: 1 }), NOW)

    expect(deleteSpecialDay(db, 'christmas')).toBe(true)
    expect(deleteSpecialDay(db, 'christmas')).toBe(false)
    expect(listSpecialDays(db).map(day => day.id)).toEqual(['new-year'])
  })

  it('frees the id for the next day with that name', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, input(), NOW)
    deleteSpecialDay(db, 'christmas')

    expect(createSpecialDay(db, input(), NOW).id).toBe('christmas')
  })
})

describe('duplicateSpecialDay', () => {
  it('copies every column as Copy of …, under a new id and with new timestamps', () => {
    const { db } = migratedMemoryDb()
    makeScene(db)
    createSpecialDay(db, input({ name: 'Isla\'s birthday', month: 3, day: 14, scene_id: 'birthday', who: 'Isla', since_year: 2019, lead: 'days', lead_days: 10, takeover: null, greeting: null, palette: 'night' }), NOW)
    db.update(specialDays).set({ tileArt: 'tile.webp', fullArt: 'full.webp', extraArt: 'seven.webp', updatedAt: NOW }).run()

    const copy = duplicateSpecialDay(db, 'isla-s-birthday', LATER)!

    expect(copy).toEqual({
      ...getSpecialDay(db, 'isla-s-birthday'),
      id: 'copy-of-isla-s-birthday',
      name: 'Copy of Isla\'s birthday',
      updated_at: '2026-10-29T08:30:00.000Z',
    })
    expect(copy).toMatchObject({ scene_id: 'birthday', who: 'Isla', since_year: 2019, lead: 'days', lead_days: 10, takeover: null, palette: 'night', tile_art: 'tile.webp', full_art: 'full.webp', extra_art: 'seven.webp' })
    expect(db.select().from(specialDays).all().find(row => row.id === copy.id)!.createdAt).toEqual(LATER)
    expect(listSpecialDays(db)).toHaveLength(2)
  })

  it('copies a copy under the next free id, and cuts a long name to 60 characters', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, input({ name: 'x'.repeat(60) }), NOW)
    createSpecialDay(db, input({ name: 'Xmas' }), NOW)

    const first = duplicateSpecialDay(db, 'xmas', LATER)!
    const second = duplicateSpecialDay(db, 'xmas', LATER)!
    const long = duplicateSpecialDay(db, 'x'.repeat(40), LATER)!

    expect([first.id, second.id]).toEqual(['copy-of-xmas', 'copy-of-xmas-2'])
    expect(first.name).toBe('Copy of Xmas')
    expect(long.name).toHaveLength(60)
    expect(long.name).toBe(`Copy of ${'x'.repeat(52)}`)
  })

  it('is null for an id nobody has, and stores nothing', () => {
    const { db } = migratedMemoryDb()

    expect(duplicateSpecialDay(db, 'nothing', NOW)).toBeNull()
    expect(listSpecialDays(db)).toEqual([])
  })
})

describe('slugFor', () => {
  const none = new Set<string>()

  it('makes lowercase ASCII with dashes', () => {
    expect(slugFor('Mum\'s Birthday!', none)).toBe('mum-s-birthday')
    expect(slugFor('  Bonfire   Night  ', none)).toBe('bonfire-night')
  })

  it('strips accents rather than dropping the letters', () => {
    expect(slugFor('Crème brûlée Día', none)).toBe('creme-brulee-dia')
  })

  it('falls back to "day" when nothing is left', () => {
    expect(slugFor('!!!', none)).toBe('day')
    expect(slugFor('誕生日', none)).toBe('day')
  })

  it('falls back to the name it is given, such as "scene"', () => {
    expect(slugFor('!!!', none, 'scene')).toBe('scene')
    expect(slugFor('!!!', new Set(['scene']), 'scene')).toBe('scene-2')
    expect(slugFor('Birthday', none, 'scene')).toBe('birthday')
  })

  it('cuts at 40 characters without leaving a dash on the end', () => {
    const slug = slugFor('The Very Long Name Of A Family Celebration That Goes On', none)

    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug).toBe('the-very-long-name-of-a-family-celebrati')
    expect(slugFor('a'.repeat(39) + ' bbb', none)).toBe('a'.repeat(39))
  })

  it('adds -2, -3 and so on while the id is taken', () => {
    expect(slugFor('Christmas', new Set(['christmas']))).toBe('christmas-2')
    expect(slugFor('Christmas', new Set(['christmas', 'christmas-2', 'christmas-3']))).toBe('christmas-4')
  })

  it('keeps the suffix when the name was cut', () => {
    const long = 'a'.repeat(50)

    expect(slugFor(long, new Set(['a'.repeat(40)]))).toBe(`${'a'.repeat(40)}-2`)
  })

  it('never answers with a name a route uses', () => {
    expect(slugFor('resolved', none)).toBe('resolved-2')
    expect(slugFor('Resolved', new Set(['resolved-2']))).toBe('resolved-3')
  })
})
