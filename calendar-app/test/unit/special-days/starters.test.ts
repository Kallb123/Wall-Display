import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { specialDaySceneInputSchema } from '../../../shared/special-days'
import { STARTER_SCENES, findStarterScene, starterTileUrl } from '../../../shared/starter-scenes'
import { processArt, sanitiseSvg } from '../../../server/special-days/art'
import { ART_FILE_NAME, referencedArt } from '../../../server/special-days/files'
import { listScenes } from '../../../server/special-days/scenes'
import { STARTER_ART_SLOTS, addStarterScene, starterArtPath } from '../../../server/special-days/starters'
import { migratedMemoryDb } from '../db/helpers'

// The starter scenes: their looks, their bundled art (held to the same checks
// as an upload), and adding one to the scene library.

const ASSETS = join(__dirname, '..', '..', '..', 'server', 'assets')
const read = async (path: string): Promise<Buffer> => readFileSync(join(ASSETS, path))
const NOW = new Date('2026-11-11T12:00:00Z')

describe('STARTER_SCENES', () => {
  it('has birthday, Christmas and Easter, each with a unique id', () => {
    expect(STARTER_SCENES.map(starter => starter.id)).toEqual(['birthday', 'christmas', 'easter'])
  })

  it.each(STARTER_SCENES.map(starter => [starter.id, starter] as const))('%s is a scene the API would accept as it is', (_id, starter) => {
    expect(specialDaySceneInputSchema.parse(starter.scene)).toEqual(starter.scene)
  })

  it('has a folder of art for each starter and none without one', () => {
    expect(readdirSync(join(ASSETS, 'starter-scenes')).sort()).toEqual(STARTER_SCENES.map(starter => starter.id).sort())
  })

  it('finds a starter by id, and nothing for an unknown one', () => {
    expect(findStarterScene('christmas')?.scene.name).toBe('Christmas')
    expect(findStarterScene('halloween')).toBeUndefined()
    expect(findStarterScene('')).toBeUndefined()
  })

  it('serves the tile for the picker under /special-days/starters/', () => {
    expect(starterTileUrl('easter')).toBe('/special-days/starters/easter.svg')
  })
})

describe.each(STARTER_SCENES.map(starter => [starter.id] as const))('the %s art', (id) => {
  it('is an SVG for every scene slot, and nothing else', () => {
    expect(readdirSync(join(ASSETS, 'starter-scenes', id)).sort()).toEqual(STARTER_ART_SLOTS.map(slot => `${slot}.svg`).sort())
  })

  it('passes the sanitiser untouched in substance: nothing in it is refused', async () => {
    for (const slot of STARTER_ART_SLOTS) expect(() => sanitiseSvg(readFileSync(join(ASSETS, starterArtPath(id, slot))))).not.toThrow()
  })

  it('passes the upload checks for each slot, and comes out the size the slot is cropped to', async () => {
    const tile = await processArt('tile', await read(starterArtPath(id, 'tile')))
    expect(tile.ext).toBe('svg')
    const { width, height } = await sharp(tile.data).metadata()
    expect(width).toBe(height)

    for (const [slot, box] of [['full', [2560, 1440]], ['full-portrait', [1440, 2560]]] as const) {
      const full = await processArt(slot, await read(starterArtPath(id, slot)))
      expect(full.ext).toBe('webp')
      const meta = await sharp(full.data).metadata()
      expect([meta.width, meta.height]).toEqual(box)
    }
  })
})

describe('addStarterScene', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wallcal-starters-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('makes an ordinary scene with the starter\'s look and its art stored in the art folder', async () => {
    const { db } = migratedMemoryDb()
    const scene = await addStarterScene(db, dir, findStarterScene('christmas')!, read, NOW)

    expect(scene).toMatchObject({ id: 'christmas', name: 'Christmas', lead: 'month', takeover: true, greeting: 'Merry Christmas!', palette: 'frost', updated_at: NOW.toISOString() })
    for (const name of [scene.tile_art, scene.full_art, scene.full_art_portrait]) {
      expect(name).toMatch(ART_FILE_NAME)
      expect(existsSync(join(dir, name!))).toBe(true)
    }
    expect(scene.tile_art).toMatch(/\.svg$/)
    expect(scene.full_art).toMatch(/\.webp$/)
    expect(listScenes(db)).toEqual([scene])
  })

  it('makes a second copy when the same starter is added again, sharing the art files', async () => {
    const { db } = migratedMemoryDb()
    const starter = findStarterScene('birthday')!
    const first = await addStarterScene(db, dir, starter, read, NOW)
    const second = await addStarterScene(db, dir, starter, read, NOW)

    expect(second.id).toBe('birthday-2')
    expect(second.name).toBe('Birthday')
    expect([second.tile_art, second.full_art, second.full_art_portrait]).toEqual([first.tile_art, first.full_art, first.full_art_portrait])
    expect(readdirSync(dir).filter(name => ART_FILE_NAME.test(name))).toHaveLength(3)
  })

  it('stores nothing when the art can\'t be read', async () => {
    const { db } = migratedMemoryDb()
    const missing = async (): Promise<Buffer> => {
      throw new Error('missing')
    }
    await expect(addStarterScene(db, dir, findStarterScene('easter')!, missing, NOW)).rejects.toThrow('missing')
    expect(listScenes(db)).toEqual([])
    expect(readdirSync(dir)).toEqual([])
    expect(referencedArt(db).size).toBe(0)
  })
})
