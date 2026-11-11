import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { PIN_HEADER } from '../../shared/remote'
import { specialDayArtUrl } from '../../shared/special-days'
import type { SpecialDayScene } from '../../shared/special-days'
import { starterTileUrl } from '../../shared/starter-scenes'
import { builtApp } from '../helpers/builtApp'

// Adding a starter scene, on the built app: the art is read from the bundle's
// server assets, so this is what shows it ships. On the dev config with
// `remote.pin` set. The tests build on each other, in order.
describe('starter scenes', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)}\nremote:\n  pin: "2468"\n`)
  const artDir = join(dir, 'data', 'special-days')

  await setup({
    ...builtApp,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const right = { [PIN_HEADER]: '2468' }
  const stored = () => existsSync(artDir) ? readdirSync(artDir).sort() : []
  const add = (id: string, headers: Record<string, string> = right) => fetch(`/api/special-day-scenes/starters/${id}`, { method: 'POST', headers })

  let first: SpecialDayScene

  it('serves each starter\'s tile for the picker, locked down like stored art', async () => {
    for (const id of ['birthday', 'christmas', 'easter']) {
      const response = await fetch(starterTileUrl(id))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/svg+xml')
      expect(response.headers.get('content-security-policy')).toContain('default-src \'none\'')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await response.text()).toMatch(/^<svg /)
    }
    expect((await fetch('/special-days/starters/halloween.svg')).status).toBe(404)
    expect((await fetch('/special-days/starters/birthday.png')).status).toBe(404)
  })

  it('refuses to add one without the PIN, and stores nothing', async () => {
    expect((await add('christmas', {})).status).toBe(401)
    expect(await $fetch('/api/special-day-scenes')).toEqual([])
    expect(stored()).toEqual([])
  })

  it('answers 404 for an unknown starter', async () => {
    const response = await add('halloween')
    expect(response.status).toBe(404)
    expect(stored()).toEqual([])
  })

  it('adds a starter as a scene with its art copied into the data folder', async () => {
    const response = await add('christmas')
    expect(response.status).toBe(201)
    first = await response.json() as SpecialDayScene
    expect(first).toMatchObject({ id: 'christmas', name: 'Christmas', palette: 'frost', takeover: true, lead: 'month', greeting: 'Merry Christmas!' })
    expect(stored()).toEqual([first.tile_art, first.full_art, first.full_art_portrait].sort())

    const full = await fetch(specialDayArtUrl(first.full_art!))
    expect(full.status).toBe(200)
    const meta = await sharp(Buffer.from(await full.arrayBuffer())).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 2560, 1440])
    const portrait = await sharp(Buffer.from(await (await fetch(specialDayArtUrl(first.full_art_portrait!))).arrayBuffer())).metadata()
    expect([portrait.width, portrait.height]).toEqual([1440, 2560])
  })

  it('makes a second copy when the same starter is added again, sharing the files', async () => {
    const response = await add('christmas')
    expect(response.status).toBe(201)
    const second = await response.json() as SpecialDayScene
    expect(second).toMatchObject({ id: 'christmas-2', name: 'Christmas', tile_art: first.tile_art, full_art: first.full_art, full_art_portrait: first.full_art_portrait })
    expect(stored()).toHaveLength(3)
    expect((await $fetch<SpecialDayScene[]>('/api/special-day-scenes')).map(scene => scene.id)).toEqual(['christmas', 'christmas-2'])
  })

  it('leaves an ordinary scene: deleting one copy keeps the files the other uses, deleting both removes them', async () => {
    expect((await fetch('/api/special-day-scenes/christmas-2', { method: 'DELETE', headers: right })).status).toBe(204)
    expect(stored()).toHaveLength(3)
    expect((await fetch('/api/special-day-scenes/christmas', { method: 'DELETE', headers: right })).status).toBe(204)
    expect(stored()).toEqual([])
  })
})
