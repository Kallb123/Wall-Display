import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { resolveSpecialDays } from '../../../shared/special-days'
import type { SpecialDayInput, SpecialDaySceneInput } from '../../../shared/special-days'
import type { Db } from '../../../server/db/client'
import { specialDays, specialDayScenes } from '../../../server/db/schema'
import { checkDayInput, checkSceneInput } from '../../../server/special-days/checks'
import { SpecialDayError } from '../../../server/special-days/errors'
import { createScene, daysUsingScene, deleteScene, duplicateScene, getScene, listScenes, updateScene } from '../../../server/special-days/scenes'
import { createSpecialDay, getSpecialDay, listSpecialDays, saveDayAsScene, updateSpecialDay } from '../../../server/special-days/store'
import { migratedMemoryDb } from '../db/helpers'

// The scene store, the copying that crosses it and the day store, and the
// checks, against a migrated in-memory database.

const NOW = new Date('2026-10-28T12:00:00Z')
const LATER = new Date('2026-10-29T08:30:00Z')

function sceneInput(overrides: Partial<SpecialDaySceneInput> = {}): SpecialDaySceneInput {
  return { name: 'Birthday', lead: 'week', lead_days: null, takeover: true, greeting: 'Happy {nth} birthday, {who}!', palette: 'sage', ...overrides }
}

function dayInput(overrides: Partial<SpecialDayInput> = {}): SpecialDayInput {
  return {
    name: 'Isla\'s birthday', month: 3, day: 14, year: null, repeat: 'yearly', scene_id: 'birthday', who: 'Isla', since_year: 2019,
    lead: null, lead_days: null, takeover: null, greeting: null, palette: null, ...overrides,
  }
}

/** What the wall would draw around 14 March 2026. */
function resolution(db: Db) {
  return resolveSpecialDays(listSpecialDays(db), listScenes(db), { from: '2026-02-01', to: '2026-04-30', today: '2026-03-14' })
}

/** Gives a scene art, which only the upload routes do in the app. */
function giveSceneArt(db: Db, id: string): void {
  db.update(specialDayScenes).set({ tileArt: 'scene-tile.webp', fullArt: 'scene-full.webp' }).where(eq(specialDayScenes.id, id)).run()
}

function updatedAtOf(db: Db, id: string): Date {
  return db.select().from(specialDays).where(eq(specialDays.id, id)).get()!.updatedAt
}

describe('createScene and getScene', () => {
  it('stores a scene under a slug of its name, as the wire format', () => {
    const { db } = migratedMemoryDb()

    const created = createScene(db, sceneInput(), NOW)

    expect(created).toEqual({
      id: 'birthday',
      name: 'Birthday',
      lead: 'week',
      lead_days: null,
      tile_art: null,
      takeover: true,
      full_art: null,
      greeting: 'Happy {nth} birthday, {who}!',
      palette: 'sage',
      updated_at: '2026-10-28T12:00:00.000Z',
    })
    expect(getScene(db, 'birthday')).toEqual(created)
  })

  it('stores a days lead with its count, and no count for the other leads', () => {
    const { db } = migratedMemoryDb()

    expect(createScene(db, sceneInput({ name: 'A', lead: 'days', lead_days: 10 }), NOW)).toMatchObject({ lead: 'days', lead_days: 10 })
    expect(createScene(db, sceneInput({ name: 'B', lead: 'month', lead_days: 10 }), NOW)).toMatchObject({ lead: 'month', lead_days: null })
  })

  it('gives a second scene with the same name the next free id, and "scene" to a name with no letters', () => {
    const { db } = migratedMemoryDb()

    expect([sceneInput(), sceneInput(), sceneInput({ name: '!!!' }), sceneInput({ name: '誕生日' })].map(input => createScene(db, input, NOW).id))
      .toEqual(['birthday', 'birthday-2', 'scene', 'scene-2'])
  })

  it('is undefined for an id nobody has', () => {
    const { db } = migratedMemoryDb()

    expect(getScene(db, 'nothing')).toBeUndefined()
  })
})

describe('listScenes', () => {
  it('is empty with nothing stored, and otherwise sorted by name', () => {
    const { db } = migratedMemoryDb()
    expect(listScenes(db)).toEqual([])

    for (const name of ['Halloween', 'Birthday', 'Christmas']) createScene(db, sceneInput({ name }), NOW)

    expect(listScenes(db).map(scene => scene.name)).toEqual(['Birthday', 'Christmas', 'Halloween'])
  })
})

describe('updateScene', () => {
  it('replaces what the editor sets and stamps updated_at, keeping the id and the art', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    giveSceneArt(db, 'birthday')

    const updated = updateScene(db, 'birthday', sceneInput({ name: 'Birthdays', lead: 'days', lead_days: 3, takeover: false, greeting: null, palette: 'frost' }), LATER)

    expect(updated).toEqual({
      id: 'birthday',
      name: 'Birthdays',
      lead: 'days',
      lead_days: 3,
      tile_art: 'scene-tile.webp',
      takeover: false,
      full_art: 'scene-full.webp',
      greeting: null,
      palette: 'frost',
      updated_at: '2026-10-29T08:30:00.000Z',
    })
    expect(getScene(db, 'birthday')).toEqual(updated)
  })

  it('drops the lead count when the lead changes back', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput({ lead: 'days', lead_days: 3 }), NOW)

    expect(updateScene(db, 'birthday', sceneInput({ lead: 'week', lead_days: 3 }), LATER)).toMatchObject({ lead: 'week', lead_days: null })
  })

  it('leaves the days on the scene exactly as they were, updated_at too', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    createSpecialDay(db, dayInput(), NOW)

    updateScene(db, 'birthday', sceneInput({ palette: 'night' }), LATER)

    expect(updatedAtOf(db, 'isla-s-birthday')).toEqual(NOW)
  })

  it('is null for an id nobody has, and stores nothing', () => {
    const { db } = migratedMemoryDb()

    expect(updateScene(db, 'nothing', sceneInput(), NOW)).toBeNull()
    expect(listScenes(db)).toEqual([])
  })
})

describe('duplicateScene', () => {
  it('copies the look and the art as Copy of …, under a new id and with a new timestamp', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput({ lead: 'days', lead_days: 5 }), NOW)
    giveSceneArt(db, 'birthday')

    const copy = duplicateScene(db, 'birthday', LATER)!

    expect(copy).toEqual({ ...getScene(db, 'birthday'), id: 'copy-of-birthday', name: 'Copy of Birthday', updated_at: '2026-10-29T08:30:00.000Z' })
    expect(copy).toMatchObject({ lead: 'days', lead_days: 5, tile_art: 'scene-tile.webp', full_art: 'scene-full.webp' })
    expect(listScenes(db)).toHaveLength(2)
  })

  it('is independent: editing the copy leaves the original, and no day uses the copy', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    createSpecialDay(db, dayInput(), NOW)

    const copy = duplicateScene(db, 'birthday', LATER)!
    updateScene(db, copy.id, sceneInput({ name: 'Garden party', palette: 'frost' }), LATER)

    expect(getScene(db, 'birthday')).toMatchObject({ name: 'Birthday', palette: 'sage' })
    expect(daysUsingScene(db, copy.id)).toEqual([])
  })

  it('takes the next free id for a second copy, and cuts a long name to 60 characters', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    createScene(db, sceneInput({ name: 'y'.repeat(60) }), NOW)

    expect([duplicateScene(db, 'birthday', LATER)!.id, duplicateScene(db, 'birthday', LATER)!.id]).toEqual(['copy-of-birthday', 'copy-of-birthday-2'])
    expect(duplicateScene(db, 'y'.repeat(40), LATER)!.name).toBe(`Copy of ${'y'.repeat(52)}`)
  })

  it('is null for an id nobody has', () => {
    const { db } = migratedMemoryDb()

    expect(duplicateScene(db, 'nothing', NOW)).toBeNull()
  })
})

describe('daysUsingScene', () => {
  it('names the days on the scene in calendar order, and nobody else\'s', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    createScene(db, sceneInput({ name: 'Other' }), NOW)
    createSpecialDay(db, dayInput({ name: 'Theo', month: 9, day: 2 }), NOW)
    createSpecialDay(db, dayInput({ name: 'Isla', month: 3, day: 14 }), NOW)
    createSpecialDay(db, dayInput({ name: 'Elsewhere', scene_id: 'other' }), NOW)
    createSpecialDay(db, dayInput({ name: 'Alone', scene_id: null }), NOW)

    expect(daysUsingScene(db, 'birthday')).toEqual([{ id: 'isla', name: 'Isla' }, { id: 'theo', name: 'Theo' }])
  })
})

describe('deleteScene', () => {
  it('deletes a scene nobody uses and says so, and says no when there was none', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)

    expect(deleteScene(db, 'birthday')).toEqual([])
    expect(deleteScene(db, 'birthday')).toBeNull()
    expect(listScenes(db)).toEqual([])
  })

  it('refuses a scene in use with a 409 that names its days, and changes nothing', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    createSpecialDay(db, dayInput({ name: 'Theo\'s birthday', month: 9, day: 2 }), NOW)
    createSpecialDay(db, dayInput(), NOW)

    const error = (() => {
      try {
        deleteScene(db, 'birthday')
      } catch (caught) {
        return caught
      }
    })()

    expect(error).toBeInstanceOf(SpecialDayError)
    expect(error).toMatchObject({
      statusCode: 409,
      message: 'Scene "Birthday" is used by Isla\'s birthday and Theo\'s birthday',
      days: [{ id: 'isla-s-birthday', name: 'Isla\'s birthday' }, { id: 'theo-s-birthday', name: 'Theo\'s birthday' }],
    })
    expect(getScene(db, 'birthday')).toBeDefined()
    expect(getSpecialDay(db, 'isla-s-birthday')!.scene_id).toBe('birthday')
  })

  it('can\'t be got round by the foreign key alone: the table also refuses', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    createSpecialDay(db, dayInput(), NOW)

    expect(() => db.delete(specialDayScenes).run()).toThrow()
  })

  describe('with detach', () => {
    it('gives each day the scene\'s value for every field it left null, and takes it off the scene', () => {
      const { db } = migratedMemoryDb()
      createScene(db, sceneInput(), NOW)
      giveSceneArt(db, 'birthday')
      createSpecialDay(db, dayInput(), NOW)

      expect(deleteScene(db, 'birthday', { detach: true })).toEqual(['scene-tile.webp', 'scene-full.webp'])

      expect(getSpecialDay(db, 'isla-s-birthday')).toMatchObject({
        scene_id: null,
        lead: 'week',
        lead_days: null,
        tile_art: 'scene-tile.webp',
        takeover: true,
        full_art: 'scene-full.webp',
        greeting: 'Happy {nth} birthday, {who}!',
        palette: 'sage',
        who: 'Isla',
        since_year: 2019,
      })
      expect(getScene(db, 'birthday')).toBeUndefined()
    })

    it('keeps what the day has of its own, and takes lead and lead_days together from one place', () => {
      const { db } = migratedMemoryDb()
      createScene(db, sceneInput({ lead: 'days', lead_days: 20 }), NOW)
      createSpecialDay(db, dayInput({ name: 'Own lead', lead: 'days', lead_days: 3, palette: 'night', greeting: 'Own greeting', takeover: false }), NOW)
      createSpecialDay(db, dayInput({ name: 'Scene lead' }), NOW)

      deleteScene(db, 'birthday', { detach: true })

      expect(getSpecialDay(db, 'own-lead')).toMatchObject({ lead: 'days', lead_days: 3, palette: 'night', greeting: 'Own greeting', takeover: false })
      expect(getSpecialDay(db, 'scene-lead')).toMatchObject({ lead: 'days', lead_days: 20 })
    })

    it('leaves every day\'s updated_at alone, and other scenes\' days untouched', () => {
      const { db } = migratedMemoryDb()
      createScene(db, sceneInput(), NOW)
      createScene(db, sceneInput({ name: 'Other' }), NOW)
      createSpecialDay(db, dayInput(), NOW)
      createSpecialDay(db, dayInput({ name: 'Elsewhere', scene_id: 'other' }), NOW)

      deleteScene(db, 'birthday', { detach: true })

      expect(updatedAtOf(db, 'isla-s-birthday')).toEqual(NOW)
      expect(getSpecialDay(db, 'elsewhere')).toMatchObject({ scene_id: 'other', palette: null })
    })

    it('leaves what the wall shows exactly as it was', () => {
      const { db } = migratedMemoryDb()
      createScene(db, sceneInput(), NOW)
      giveSceneArt(db, 'birthday')
      createSpecialDay(db, dayInput(), NOW)
      createSpecialDay(db, dayInput({ name: 'Mixed', month: 3, day: 20, lead: 'month', greeting: 'Hello {who}', who: 'Theo', palette: 'frost' }), NOW)
      const before = resolution(db)
      expect(before.takeover).toMatchObject({ id: 'isla-s-birthday', palette: 'sage', greeting: 'Happy 7th birthday, Isla!' })

      deleteScene(db, 'birthday', { detach: true })

      expect(resolution(db)).toEqual(before)
    })

    it('deletes an unused scene as usual', () => {
      const { db } = migratedMemoryDb()
      createScene(db, sceneInput(), NOW)

      expect(deleteScene(db, 'birthday', { detach: true })).toEqual([])
      expect(deleteScene(db, 'birthday', { detach: true })).toBeNull()
    })
  })
})

describe('saveDayAsScene', () => {
  it('makes a scene from the day\'s own look and moves the day onto it with its own look cleared', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, dayInput({ name: 'First birthday', scene_id: null, lead: 'days', lead_days: 4, takeover: true, greeting: 'Happy {nth}, {who}!', palette: 'night' }), NOW)
    db.update(specialDays).set({ tileArt: 'tile.webp', fullArt: 'full.webp', extraArt: 'seven.webp' }).run()

    const saved = saveDayAsScene(db, 'first-birthday', undefined, LATER)!

    expect(saved.scene).toEqual({
      id: 'first-birthday',
      name: 'First birthday',
      lead: 'days',
      lead_days: 4,
      tile_art: 'tile.webp',
      takeover: true,
      full_art: 'full.webp',
      greeting: 'Happy {nth}, {who}!',
      palette: 'night',
      updated_at: '2026-10-29T08:30:00.000Z',
    })
    expect(saved.day).toMatchObject({
      scene_id: 'first-birthday',
      lead: null,
      lead_days: null,
      tile_art: null,
      takeover: null,
      full_art: null,
      greeting: null,
      palette: null,
      // What is about this day alone stays.
      who: 'Isla',
      since_year: 2019,
      extra_art: 'seven.webp',
      name: 'First birthday',
    })
    expect(getSpecialDay(db, 'first-birthday')).toEqual(saved.day)
    expect(getScene(db, 'first-birthday')).toEqual(saved.scene)
  })

  it('uses the effective look: the scene\'s values under the day\'s own', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput({ lead: 'month', palette: 'sage', greeting: 'From scene' }), NOW)
    giveSceneArt(db, 'birthday')
    createSpecialDay(db, dayInput({ palette: 'frost', takeover: false }), NOW)

    const saved = saveDayAsScene(db, 'isla-s-birthday', 'Isla style', LATER)!

    expect(saved.scene).toMatchObject({ id: 'isla-style', name: 'Isla style', lead: 'month', takeover: false, palette: 'frost', greeting: 'From scene', tile_art: 'scene-tile.webp', full_art: 'scene-full.webp' })
    expect(saved.day).toMatchObject({ scene_id: 'isla-style', palette: null, takeover: null, greeting: null })
    // The old scene is untouched.
    expect(getScene(db, 'birthday')).toMatchObject({ palette: 'sage', takeover: true })
  })

  it('leaves the day\'s updated_at alone, and the wall looking exactly as it did', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    giveSceneArt(db, 'birthday')
    createSpecialDay(db, dayInput({ palette: 'frost', lead: 'month' }), NOW)
    createSpecialDay(db, dayInput({ name: 'Rival', month: 3, day: 14, scene_id: null, lead: 'day', takeover: true, palette: 'night' }), NOW)
    const before = resolution(db)

    saveDayAsScene(db, 'isla-s-birthday', undefined, LATER)

    expect(updatedAtOf(db, 'isla-s-birthday')).toEqual(NOW)
    expect(resolution(db)).toEqual(before)
  })

  it('numbers the scene\'s id when the name is taken, and takes "scene" for a name with no letters', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput({ name: 'Isla\'s birthday' }), NOW)
    createSpecialDay(db, dayInput({ scene_id: null, lead: 'day', takeover: false, palette: 'warm' }), NOW)

    expect(saveDayAsScene(db, 'isla-s-birthday', undefined, LATER)!.scene.id).toBe('isla-s-birthday-2')
  })

  it('is null for a day nobody has, and stores nothing', () => {
    const { db } = migratedMemoryDb()

    expect(saveDayAsScene(db, 'nothing', undefined, NOW)).toBeNull()
    expect(listScenes(db)).toEqual([])
  })
})

describe('checkDayInput', () => {
  const caught = (run: () => void) => {
    try {
      run()
    } catch (error) {
      return error
    }
  }

  it('accepts a day with no scene, a known scene, and a greeting it can fill', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)

    expect(() => checkDayInput(db, dayInput({ scene_id: null, greeting: 'Hello' }))).not.toThrow()
    expect(() => checkDayInput(db, dayInput())).not.toThrow()
    expect(() => checkDayInput(db, dayInput({ greeting: '{who} is {years}' }))).not.toThrow()
  })

  it('refuses a scene that is not there with a 400', () => {
    const { db } = migratedMemoryDb()

    expect(caught(() => checkDayInput(db, dayInput({ scene_id: 'nothing' })))).toMatchObject({ statusCode: 400, message: 'scene_id is not a scene: "nothing"' })
  })

  it('refuses a greeting of its own it can\'t fill, naming the day and what is missing', () => {
    const { db } = migratedMemoryDb()

    const error = caught(() => checkDayInput(db, dayInput({ scene_id: null, who: null, since_year: null, greeting: 'Happy {nth}, {who}!' }), 'isla-s-birthday'))

    expect(error).toMatchObject({
      statusCode: 400,
      message: 'greeting can\'t be filled for Isla\'s birthday: {nth} needs since_year and {who} needs who',
      days: [{ id: 'isla-s-birthday', name: 'Isla\'s birthday' }],
    })
  })

  it('checks the scene\'s greeting when the day has none of its own', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)

    expect(caught(() => checkDayInput(db, dayInput({ since_year: null }))))
      .toMatchObject({ statusCode: 400, message: 'greeting can\'t be filled for Isla\'s birthday: {nth} needs since_year', days: [] })
    // Its own greeting replaces the scene's, so the scene's {nth} no longer matters.
    expect(() => checkDayInput(db, dayInput({ since_year: null, greeting: 'Hello {who}' }))).not.toThrow()
  })
})

describe('checkSceneInput', () => {
  const caught = (run: () => void) => {
    try {
      run()
    } catch (error) {
      return error
    }
  }

  it('accepts an edit every day on the scene can fill', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    createSpecialDay(db, dayInput(), NOW)

    expect(() => checkSceneInput(db, 'birthday', sceneInput({ greeting: 'Hello {who}, {years} today' }))).not.toThrow()
    expect(() => checkSceneInput(db, 'birthday', sceneInput({ greeting: null }))).not.toThrow()
  })

  it('names every day the new greeting would leave unfilled, in one error', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput({ greeting: 'Hello' }), NOW)
    createSpecialDay(db, dayInput({ name: 'Theo\'s birthday', month: 9, day: 2, who: null }), NOW)
    createSpecialDay(db, dayInput({ name: 'Isla\'s birthday', since_year: null }), NOW)
    createSpecialDay(db, dayInput({ name: 'Fine', month: 5, day: 5 }), NOW)

    const error = caught(() => checkSceneInput(db, 'birthday', sceneInput()))

    expect(error).toMatchObject({
      statusCode: 400,
      message: 'greeting can\'t be filled for Isla\'s birthday ({nth} needs since_year) and Theo\'s birthday ({who} needs who)',
      days: [{ id: 'isla-s-birthday', name: 'Isla\'s birthday' }, { id: 'theo-s-birthday', name: 'Theo\'s birthday' }],
    })
  })

  it('ignores a day with its own greeting, and days on other scenes', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput({ greeting: 'Hello' }), NOW)
    createScene(db, sceneInput({ name: 'Other' }), NOW)
    createSpecialDay(db, dayInput({ since_year: null, greeting: 'Own greeting' }), NOW)
    createSpecialDay(db, dayInput({ name: 'Elsewhere', scene_id: 'other', since_year: null }), NOW)

    expect(() => checkSceneInput(db, 'birthday', sceneInput())).not.toThrow()
  })

  it('does not stop a day from being moved off the scene first', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput({ greeting: 'Hello' }), NOW)
    createSpecialDay(db, dayInput({ since_year: null }), NOW)
    expect(() => checkSceneInput(db, 'birthday', sceneInput())).toThrow()

    updateSpecialDay(db, 'isla-s-birthday', dayInput({ scene_id: null, since_year: null, greeting: 'Hi' }), LATER)

    expect(() => checkSceneInput(db, 'birthday', sceneInput())).not.toThrow()
  })
})
