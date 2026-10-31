import { existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SpecialDayInput, SpecialDaySceneInput } from '../../../shared/special-days'
import type { Db } from '../../../server/db/client'
import { ART_DIR_NAME, ART_FILE_NAME, artFileName, referencedArt, removeUnreferencedArt, writeArtFile } from '../../../server/special-days/files'
import { createScene, deleteScene, duplicateScene, getScene, setSceneArt } from '../../../server/special-days/scenes'
import { createSpecialDay, deleteSpecialDay, duplicateSpecialDay, getSpecialDay, setSpecialDayArt } from '../../../server/special-days/store'
import { migratedMemoryDb, tempDir } from '../db/helpers'

// The art files on disk and the rule for when one may go: only when no scene
// and no day refers to it.

const NOW = new Date('2026-10-28T12:00:00Z')
const LATER = new Date('2026-10-29T08:30:00Z')

function sceneInput(overrides: Partial<SpecialDaySceneInput> = {}): SpecialDaySceneInput {
  return { name: 'Birthday', lead: 'week', lead_days: null, takeover: true, greeting: null, palette: 'sage', ...overrides }
}

function dayInput(overrides: Partial<SpecialDayInput> = {}): SpecialDayInput {
  return { name: 'Christmas', month: 12, day: 25, year: null, repeat: 'yearly', scene_id: null, who: null, since_year: null, lead: 'month', lead_days: null, takeover: true, greeting: null, palette: 'warm', ...overrides }
}

/** Stores some bytes as art and returns the name. */
function store(dir: string, text: string, ext: 'webp' | 'svg' = 'webp'): string {
  return writeArtFile(dir, Buffer.from(text), ext)
}

function filesIn(dir: string): string[] {
  return readdirSync(dir).sort()
}

describe('artFileName', () => {
  it('is the SHA-256 of the bytes and the extension, and a valid served name', () => {
    const name = artFileName(Buffer.from('hello'), 'webp')

    expect(name).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.webp')
    expect(name).toMatch(ART_FILE_NAME)
  })

  it('gives the same bytes the same name, and different bytes or a different extension another', () => {
    const a = artFileName(Buffer.from('one'), 'webp')

    expect(artFileName(Buffer.from('one'), 'webp')).toBe(a)
    expect(artFileName(Buffer.from('two'), 'webp')).not.toBe(a)
    expect(artFileName(Buffer.from('one'), 'svg')).not.toBe(a)
    expect(artFileName(Buffer.from('one'), 'svg')).toMatch(/\.svg$/)
  })

  it('names the folder special-days', () => {
    expect(ART_DIR_NAME).toBe('special-days')
  })
})

describe('ART_FILE_NAME', () => {
  const hash = 'a'.repeat(64)

  it('accepts a full hash with .webp or .svg', () => {
    expect(`${hash}.webp`).toMatch(ART_FILE_NAME)
    expect(`${hash}.svg`).toMatch(ART_FILE_NAME)
  })

  it('refuses anything else, including paths', () => {
    for (const name of [`${hash}.png`, `${'a'.repeat(63)}.webp`, `${hash.toUpperCase()}.webp`, `../${hash}.webp`, `${hash}.webp/`, `x/${hash}.webp`, `${hash}.webp\n`, '']) {
      expect(name, name).not.toMatch(ART_FILE_NAME)
    }
  })
})

describe('writeArtFile', () => {
  it('makes the folder, writes the bytes under their name and returns it', async () => {
    const dir = join(await tempDir(), 'nested', ART_DIR_NAME)

    const name = writeArtFile(dir, Buffer.from('picture'), 'webp')

    expect(name).toBe(artFileName(Buffer.from('picture'), 'webp'))
    expect(readFileSync(join(dir, name), 'utf8')).toBe('picture')
    expect(filesIn(dir)).toEqual([name])
  })

  it('is a no-op for a file already there: same name, same content, same mtime, no temp files', async () => {
    const dir = await tempDir()
    const name = writeArtFile(dir, Buffer.from('picture'), 'svg')
    const past = new Date('2020-01-01T00:00:00Z')
    utimesSync(join(dir, name), past, past)

    expect(writeArtFile(dir, Buffer.from('picture'), 'svg')).toBe(name)

    expect(statSync(join(dir, name)).mtime).toEqual(past)
    expect(readFileSync(join(dir, name), 'utf8')).toBe('picture')
    expect(filesIn(dir)).toEqual([name])
  })

  it('stores the same bytes as webp and as svg separately', async () => {
    const dir = await tempDir()

    const webp = writeArtFile(dir, Buffer.from('same'), 'webp')
    const svg = writeArtFile(dir, Buffer.from('same'), 'svg')

    expect(webp).not.toBe(svg)
    expect(filesIn(dir)).toHaveLength(2)
  })
})

describe('referencedArt', () => {
  it('is empty when nothing has art', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    createSpecialDay(db, dayInput(), NOW)

    expect(referencedArt(db)).toEqual(new Set())
  })

  it('collects every art slot of every scene and day, once each', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    createSpecialDay(db, dayInput(), NOW)
    setSceneArt(db, 'birthday', 'tile', 'scene-tile', NOW)
    setSceneArt(db, 'birthday', 'full', 'scene-full', NOW)
    setSpecialDayArt(db, 'christmas', 'tile', 'day-tile', NOW)
    setSpecialDayArt(db, 'christmas', 'full', 'scene-full', NOW)
    setSpecialDayArt(db, 'christmas', 'extra', 'day-extra', NOW)

    expect(referencedArt(db)).toEqual(new Set(['scene-tile', 'scene-full', 'day-tile', 'day-extra']))
  })
})

describe('removeUnreferencedArt', () => {
  it('deletes only the named files nothing refers to, and says which', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()
    createSpecialDay(db, dayInput(), NOW)
    const kept = store(dir, 'kept')
    const gone = store(dir, 'gone')
    const bystander = store(dir, 'bystander')
    setSpecialDayArt(db, 'christmas', 'full', kept, NOW)

    expect(removeUnreferencedArt(db, dir, [kept, gone])).toEqual([gone])

    expect(filesIn(dir)).toEqual([kept, bystander].sort())
  })

  it('ignores nulls, undefined, names that aren\'t art names and files that are already gone', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()
    const outside = join(dir, 'outside.txt')
    writeFileSync(outside, 'keep me')
    const missing = artFileName(Buffer.from('never written'), 'webp')

    expect(removeUnreferencedArt(db, dir, [null, undefined, '', 'outside.txt', '../outside.txt', `../${missing}`, missing])).toEqual([])
    expect(readFileSync(outside, 'utf8')).toBe('keep me')
  })

  it('deletes a file named twice once, and deletes nothing for no names', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()
    const name = store(dir, 'twice')

    expect(removeUnreferencedArt(db, dir, [])).toEqual([])
    expect(removeUnreferencedArt(db, dir, [name, name])).toEqual([name])
    expect(filesIn(dir)).toEqual([])
  })
})

describe('a file shared by a scene and a day', () => {
  /** A scene with tile art X and a day with full art Y, copied so Y is shared. */
  function setUp(db: Db, dir: string) {
    const x = store(dir, 'scene tile')
    const y = store(dir, 'day full')
    createScene(db, sceneInput(), NOW)
    createSpecialDay(db, dayInput(), NOW)
    setSceneArt(db, 'birthday', 'tile', x, NOW)
    setSpecialDayArt(db, 'christmas', 'full', y, NOW)
    const copy = duplicateSpecialDay(db, 'christmas', NOW)!
    return { x, y, copy: copy.id }
  }

  /** What a route does after changing a slot. */
  function clearDayFull(db: Db, dir: string, id: string): string[] {
    const { previous } = setSpecialDayArt(db, id, 'full', null, LATER)!
    return removeUnreferencedArt(db, dir, [previous])
  }

  it('shares the file on duplicating: the copy refers to it too', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()

    const { y, copy } = setUp(db, dir)

    expect(getSpecialDay(db, copy)!.full_art).toBe(y)
  })

  it('stays when one of two days clears it, and goes when the other does', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()
    const { x, y, copy } = setUp(db, dir)

    expect(clearDayFull(db, dir, 'christmas')).toEqual([])
    expect(filesIn(dir)).toEqual([x, y].sort())

    expect(clearDayFull(db, dir, copy)).toEqual([y])
    expect(filesIn(dir)).toEqual([x])
  })

  it('stays when a day replaces it while a scene or another day still uses it', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()
    const { y, copy } = setUp(db, dir)
    const other = store(dir, 'replacement')

    const { previous } = setSpecialDayArt(db, 'christmas', 'full', other, LATER)!
    expect(previous).toBe(y)
    expect(removeUnreferencedArt(db, dir, [previous])).toEqual([])
    expect(getSpecialDay(db, copy)!.full_art).toBe(y)
    expect(existsSync(join(dir, y))).toBe(true)
  })

  it('is kept by a day when a scene clears it, and the other way round, whichever slot it is in', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()
    const shared = store(dir, 'shared across tables')
    createScene(db, sceneInput(), NOW)
    createSpecialDay(db, dayInput(), NOW)
    setSceneArt(db, 'birthday', 'full', shared, NOW)
    setSpecialDayArt(db, 'christmas', 'extra', shared, NOW)

    const { previous } = setSceneArt(db, 'birthday', 'full', null, LATER)!
    expect(removeUnreferencedArt(db, dir, [previous])).toEqual([])
    expect(existsSync(join(dir, shared))).toBe(true)

    const cleared = setSpecialDayArt(db, 'christmas', 'extra', null, LATER)!
    expect(removeUnreferencedArt(db, dir, [cleared.previous])).toEqual([shared])
  })

  it('goes with the last day that deleted it, not before', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()
    const { x, y } = setUp(db, dir)

    const first = deleteSpecialDay(db, 'christmas')!
    expect(first).toEqual([y])
    expect(removeUnreferencedArt(db, dir, first)).toEqual([])

    const second = deleteSpecialDay(db, 'copy-of-christmas')!
    expect(removeUnreferencedArt(db, dir, second)).toEqual([y])
    expect(filesIn(dir)).toEqual([x])
  })

  it('goes with a scene that is deleted, unless a day uses it too', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()
    const { x, y } = setUp(db, dir)
    const copy = duplicateScene(db, 'birthday', NOW)!
    // The copy shares X, and so does a day (as its tile art).
    setSpecialDayArt(db, 'christmas', 'tile', x, NOW)

    const held = deleteScene(db, copy.id)!
    expect(held).toEqual([x])
    expect(removeUnreferencedArt(db, dir, held)).toEqual([])

    expect(setSpecialDayArt(db, 'christmas', 'tile', null, LATER)).toBeTruthy()
    const last = deleteScene(db, 'birthday')!
    expect(removeUnreferencedArt(db, dir, last)).toEqual([x])
    expect(filesIn(dir)).toEqual([y])
  })

  it('stays when a scene is detached, because the days now refer to it', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()
    const tile = store(dir, 'scene tile')
    const full = store(dir, 'scene full')
    createScene(db, sceneInput(), NOW)
    setSceneArt(db, 'birthday', 'tile', tile, NOW)
    setSceneArt(db, 'birthday', 'full', full, NOW)
    createSpecialDay(db, dayInput({ scene_id: 'birthday', lead: null, takeover: null, palette: null }), NOW)

    const held = deleteScene(db, 'birthday', { detach: true })!

    expect(held).toEqual([tile, full])
    expect(removeUnreferencedArt(db, dir, held)).toEqual([])
    expect(getScene(db, 'birthday')).toBeUndefined()
    expect(getSpecialDay(db, 'christmas')).toMatchObject({ tile_art: tile, full_art: full })
    expect(filesIn(dir)).toEqual([tile, full].sort())
  })

  it('drops the scene\'s art on detach when every day had its own, since nothing refers to it any more', async () => {
    const dir = await tempDir()
    const { db } = migratedMemoryDb()
    const sceneFull = store(dir, 'scene full')
    const ownFull = store(dir, 'own full')
    createScene(db, sceneInput(), NOW)
    setSceneArt(db, 'birthday', 'full', sceneFull, NOW)
    createSpecialDay(db, dayInput({ scene_id: 'birthday', lead: null, takeover: null, palette: null }), NOW)
    setSpecialDayArt(db, 'christmas', 'full', ownFull, NOW)

    const held = deleteScene(db, 'birthday', { detach: true })!

    expect(removeUnreferencedArt(db, dir, held)).toEqual([sceneFull])
    expect(filesIn(dir)).toEqual([ownFull])
  })
})

describe('setSpecialDayArt', () => {
  it('sets the slot, bumps updated_at and returns the day and what the slot held', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, dayInput(), NOW)

    const first = setSpecialDayArt(db, 'christmas', 'tile', 'one', LATER)!
    expect(first.previous).toBeNull()
    expect(first.day).toMatchObject({ tile_art: 'one', full_art: null, extra_art: null, updated_at: LATER.toISOString() })

    const second = setSpecialDayArt(db, 'christmas', 'tile', 'two', new Date('2026-10-30T00:00:00Z'))!
    expect(second.previous).toBe('one')
    expect(second.day.tile_art).toBe('two')
    expect(getSpecialDay(db, 'christmas')).toEqual(second.day)
  })

  it('sets each slot on its own', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, dayInput(), NOW)

    setSpecialDayArt(db, 'christmas', 'tile', 'tile', NOW)
    setSpecialDayArt(db, 'christmas', 'full', 'full', NOW)
    setSpecialDayArt(db, 'christmas', 'extra', 'extra', NOW)

    expect(getSpecialDay(db, 'christmas')).toMatchObject({ tile_art: 'tile', full_art: 'full', extra_art: 'extra' })
  })

  it('clears a slot with null, and still bumps updated_at', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, dayInput(), NOW)
    setSpecialDayArt(db, 'christmas', 'full', 'full', NOW)

    const cleared = setSpecialDayArt(db, 'christmas', 'full', null, LATER)!

    expect(cleared.previous).toBe('full')
    expect(cleared.day).toMatchObject({ full_art: null, updated_at: LATER.toISOString() })
  })

  it('leaves every other day alone, and says null for an unknown id', () => {
    const { db } = migratedMemoryDb()
    createSpecialDay(db, dayInput(), NOW)
    createSpecialDay(db, dayInput({ name: 'New Year', month: 1, day: 1 }), NOW)

    expect(setSpecialDayArt(db, 'nothing', 'tile', 'x', LATER)).toBeNull()
    setSpecialDayArt(db, 'christmas', 'tile', 'x', LATER)

    expect(getSpecialDay(db, 'new-year')).toMatchObject({ tile_art: null, updated_at: NOW.toISOString() })
  })
})

describe('setSceneArt', () => {
  it('sets the slot, bumps the scene\'s updated_at and returns the scene and what the slot held', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)

    const first = setSceneArt(db, 'birthday', 'tile', 'one', LATER)!
    expect(first.previous).toBeNull()
    expect(first.scene).toMatchObject({ tile_art: 'one', full_art: null, updated_at: LATER.toISOString() })

    const second = setSceneArt(db, 'birthday', 'tile', null, new Date('2026-10-30T00:00:00Z'))!
    expect(second.previous).toBe('one')
    expect(second.scene.tile_art).toBeNull()
    expect(getScene(db, 'birthday')).toEqual(second.scene)
  })

  it('sets each slot on its own', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)

    setSceneArt(db, 'birthday', 'tile', 'tile', NOW)
    setSceneArt(db, 'birthday', 'full', 'full', NOW)

    expect(getScene(db, 'birthday')).toMatchObject({ tile_art: 'tile', full_art: 'full' })
  })

  it('leaves the days using the scene alone, and says null for an unknown id', () => {
    const { db } = migratedMemoryDb()
    createScene(db, sceneInput(), NOW)
    createSpecialDay(db, dayInput({ scene_id: 'birthday' }), NOW)

    expect(setSceneArt(db, 'nothing', 'tile', 'x', LATER)).toBeNull()
    setSceneArt(db, 'birthday', 'full', 'x', LATER)

    expect(getSpecialDay(db, 'christmas')).toMatchObject({ full_art: null, updated_at: NOW.toISOString() })
  })
})
