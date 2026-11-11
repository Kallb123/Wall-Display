import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, runMigrations } from '../../../server/db/client'
import { checkDb } from '../../../server/db/health'
import { MIGRATIONS_DIR, migratedMemoryDb, tempDir, track } from './helpers'

describe('openDatabase', () => {
  it('uses WAL, foreign keys, a busy timeout and normal sync on a file database', async () => {
    const dir = await tempDir()
    const { sqlite } = track(openDatabase(join(dir, 'wallcal.db')))

    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(sqlite.pragma('synchronous', { simple: true })).toBe(1)
  })

  it('creates the parent folder if it is missing', async () => {
    const dir = await tempDir()
    const file = join(dir, 'nested', 'data', 'wallcal.db')

    track(openDatabase(file))

    expect(existsSync(file)).toBe(true)
  })

  it('opens an in-memory database with foreign keys on', () => {
    const { sqlite } = track(openDatabase(':memory:'))

    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('fails with a readable error when the folder cannot be created', () => {
    // A file in the way, so mkdir fails whoever runs the test (even root).
    expect(() => openDatabase(join(import.meta.filename, 'nope', 'wallcal.db'))).toThrow(/ENOTDIR|EEXIST|not a directory/i)
  })
})

describe('runMigrations', () => {
  it('creates all the tables on an empty database', () => {
    const handle = track(openDatabase(':memory:'))

    const result = runMigrations(handle, MIGRATIONS_DIR)

    const tables = handle.sqlite
      .prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_%' escape '\\' order by name`)
      .all()
      .map(row => (row as { name: string }).name)
    expect(tables).toEqual(['calendars', 'custom_layouts', 'display_state', 'events', 'photo_assets', 'photo_playlists', 'photo_renditions', 'preference_overrides', 'special_day_scenes', 'special_days', 'star_chart_people', 'star_counts', 'sync_status'])
    expect(result.applied).toBe(result.total)
    expect(result.applied).toBeGreaterThan(0)
  })

  it('does nothing the second time', async () => {
    const dir = await tempDir()
    const file = join(dir, 'wallcal.db')

    const first = track(openDatabase(file))
    const firstResult = runMigrations(first, MIGRATIONS_DIR)
    first.sqlite.close()

    const second = track(openDatabase(file))
    const secondResult = runMigrations(second, MIGRATIONS_DIR)

    expect(firstResult.applied).toBe(firstResult.total)
    expect(secondResult).toEqual({ applied: 0, total: firstResult.total })
  })

  it('keeps the special days stored before lead_days was added (0002)', async () => {
    // The migrations up to 0001, as a database from before 0002 had them.
    const before = join(await tempDir(), 'migrations')
    cpSync(MIGRATIONS_DIR, before, { recursive: true })
    const journalFile = join(before, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter(entry => entry.tag < '0002')
    writeFileSync(journalFile, JSON.stringify(journal))

    const handle = track(openDatabase(':memory:'))
    runMigrations(handle, before)
    handle.sqlite.prepare(`insert into special_days (id, name, month, day, repeat, lead, created_at, updated_at) values ('halloween', 'Halloween', 10, 31, 'yearly', 'week', 0, 0)`).run()

    runMigrations(handle, MIGRATIONS_DIR)

    expect(handle.sqlite.prepare('select id, lead, lead_days from special_days').all()).toEqual([{ id: 'halloween', lead: 'week', lead_days: null }])
  })

  it('keeps the special days stored before scenes were added (0003)', async () => {
    // The migrations up to 0002, as a database from before 0003 had them.
    const before = join(await tempDir(), 'migrations')
    cpSync(MIGRATIONS_DIR, before, { recursive: true })
    const journalFile = join(before, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter(entry => entry.tag < '0003')
    writeFileSync(journalFile, JSON.stringify(journal))

    const handle = track(openDatabase(':memory:'))
    runMigrations(handle, before)
    const insert = handle.sqlite.prepare(`insert into special_days (id, name, month, day, year, repeat, lead, lead_days, tile_art, takeover, full_art, greeting, palette, created_at, updated_at)
      values (@id, @name, @month, @day, @year, @repeat, @lead, @lead_days, @tile_art, @takeover, @full_art, @greeting, @palette, @created_at, @updated_at)`)
    const yearly = { id: 'isla', name: 'Isla birthday', month: 3, day: 14, year: null, repeat: 'yearly', lead: 'days', lead_days: 10, tile_art: 'isla-tile.png', takeover: 1, full_art: 'isla-full.png', greeting: 'Happy birthday!', palette: 'frost', created_at: 1000, updated_at: 2000 }
    const once = { id: 'moving', name: 'Moving day', month: 6, day: 1, year: 2027, repeat: 'once', lead: 'day', lead_days: null, tile_art: null, takeover: 0, full_art: null, greeting: null, palette: 'warm', created_at: 3000, updated_at: 4000 }
    insert.run(yearly)
    insert.run(once)

    runMigrations(handle, MIGRATIONS_DIR)

    const rows = handle.sqlite.prepare('select * from special_days order by id').all()
    expect(rows).toEqual([
      { ...yearly, scene_id: null, who: null, since_year: null, extra_art: null, full_art_portrait: null, backdrop_art: null, backdrop_art_portrait: null, extra_art_portrait: null },
      { ...once, scene_id: null, who: null, since_year: null, extra_art: null, full_art_portrait: null, backdrop_art: null, backdrop_art_portrait: null, extra_art_portrait: null },
    ])
  })

  it('adds the preference overrides table on top of a database from before 0005, keeping what it holds', async () => {
    const before = join(await tempDir(), 'migrations')
    cpSync(MIGRATIONS_DIR, before, { recursive: true })
    const journalFile = join(before, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter(entry => entry.tag < '0005')
    writeFileSync(journalFile, JSON.stringify(journal))

    const handle = track(openDatabase(':memory:'))
    runMigrations(handle, before)
    handle.sqlite.prepare(`insert into display_state (display_id, state, updated_at) values ('hallway', '{"view":"week"}', 0)`).run()
    expect(handle.sqlite.prepare(`select name from sqlite_master where name = 'preference_overrides'`).all()).toEqual([])

    // 0006 and any later ones come too.
    expect(runMigrations(handle, MIGRATIONS_DIR).applied).toBeGreaterThan(0)

    expect(handle.sqlite.prepare('select display_id, state from display_state').all()).toEqual([{ display_id: 'hallway', state: '{"view":"week"}' }])
    handle.sqlite.prepare(`insert into preference_overrides (scope, "values", updated_at) values ('shared', '{"min_step":10}', 0)`).run()
    expect(handle.sqlite.prepare('select scope, "values" from preference_overrides').all()).toEqual([{ scope: 'shared', values: '{"min_step":10}' }])
  })

  it('carries the photos cached before renditions (0006) over as landscape ones', async () => {
    const before = join(await tempDir(), 'migrations')
    cpSync(MIGRATIONS_DIR, before, { recursive: true })
    const journalFile = join(before, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter(entry => entry.tag < '0006')
    writeFileSync(journalFile, JSON.stringify(journal))

    const handle = track(openDatabase(':memory:'))
    runMigrations(handle, before)
    const file = `${'a'.repeat(64)}.webp`
    const insert = handle.sqlite.prepare(`insert into photo_assets (id, provider, provider_asset_id, width, height, orientation, cache_file, cache_bytes, fetched_at, last_shown_at, created_at)
      values (@id, 'local', @id, 1600, 900, 'landscape', @cache_file, @cache_bytes, @fetched_at, @last_shown_at, 1000)`)
    insert.run({ id: 'cached', cache_file: file, cache_bytes: 4096, fetched_at: 2000, last_shown_at: 3000 })
    // Cached by an early build that did not note the size or the time.
    insert.run({ id: 'bare', cache_file: file, cache_bytes: null, fetched_at: null, last_shown_at: null })
    insert.run({ id: 'listed', cache_file: null, cache_bytes: null, fetched_at: null, last_shown_at: null })

    // 0006, then 0007 to 0011 after it.
    expect(runMigrations(handle, MIGRATIONS_DIR).applied).toBe(6)

    expect(handle.sqlite.prepare('select * from photo_renditions order by asset_id').all()).toEqual([
      { asset_id: 'bare', rendition: 'landscape', cache_file: file, cache_bytes: 0, fetched_at: 1000, last_shown_at: null },
      { asset_id: 'cached', rendition: 'landscape', cache_file: file, cache_bytes: 4096, fetched_at: 2000, last_shown_at: 3000 },
    ])
    const columns = handle.sqlite.prepare(`select name from pragma_table_info('photo_assets')`).all().map(row => (row as { name: string }).name)
    expect(columns).not.toContain('cache_file')
    expect(columns).toContain('last_shown_at')
    // The photos are still there, and a photo that goes takes its renditions with it.
    expect(handle.sqlite.prepare('select count(*) as n from photo_assets').get()).toEqual({ n: 3 })
    handle.sqlite.prepare(`delete from photo_assets where id = 'cached'`).run()
    expect(handle.sqlite.prepare('select asset_id from photo_renditions').all()).toEqual([{ asset_id: 'bare' }])
  })

  it('adds the portrait art columns (0007) empty, keeping the art already stored', async () => {
    const before = join(await tempDir(), 'migrations')
    cpSync(MIGRATIONS_DIR, before, { recursive: true })
    const journalFile = join(before, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter(entry => entry.tag < '0007')
    writeFileSync(journalFile, JSON.stringify(journal))

    const handle = track(openDatabase(':memory:'))
    runMigrations(handle, before)
    handle.sqlite.prepare(`insert into special_day_scenes (id, name, lead, takeover, full_art, palette, created_at, updated_at) values ('spooky', 'Spooky', 'day', 1, 'scene-full.webp', 'ember', 0, 0)`).run()
    handle.sqlite.prepare(`insert into special_days (id, name, month, day, repeat, scene_id, full_art, extra_art, created_at, updated_at) values ('halloween', 'Halloween', 10, 31, 'yearly', 'spooky', 'day-full.webp', 'day-extra.webp', 0, 0)`).run()

    expect(runMigrations(handle, MIGRATIONS_DIR).applied).toBe(5)

    expect(handle.sqlite.prepare('select full_art, full_art_portrait from special_day_scenes').all()).toEqual([{ full_art: 'scene-full.webp', full_art_portrait: null }])
    expect(handle.sqlite.prepare('select full_art, full_art_portrait, extra_art, extra_art_portrait from special_days').all()).toEqual([
      { full_art: 'day-full.webp', full_art_portrait: null, extra_art: 'day-extra.webp', extra_art_portrait: null },
    ])
  })

  it('adds the backdrop columns (0011) empty, keeping the art already stored', async () => {
    const before = join(await tempDir(), 'migrations')
    cpSync(MIGRATIONS_DIR, before, { recursive: true })
    const journalFile = join(before, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter(entry => entry.tag < '0011')
    writeFileSync(journalFile, JSON.stringify(journal))

    const handle = track(openDatabase(':memory:'))
    runMigrations(handle, before)
    handle.sqlite.prepare(`insert into special_day_scenes (id, name, lead, takeover, full_art, full_art_portrait, palette, created_at, updated_at) values ('spooky', 'Spooky', 'day', 1, 'scene-full.webp', 'scene-tall.webp', 'ember', 0, 0)`).run()
    handle.sqlite.prepare(`insert into special_days (id, name, month, day, repeat, scene_id, full_art, created_at, updated_at) values ('halloween', 'Halloween', 10, 31, 'yearly', 'spooky', 'day-full.webp', 0, 0)`).run()

    expect(runMigrations(handle, MIGRATIONS_DIR).applied).toBe(1)

    expect(handle.sqlite.prepare('select full_art, full_art_portrait, backdrop_art, backdrop_art_portrait from special_day_scenes').all()).toEqual([
      { full_art: 'scene-full.webp', full_art_portrait: 'scene-tall.webp', backdrop_art: null, backdrop_art_portrait: null },
    ])
    expect(handle.sqlite.prepare('select full_art, backdrop_art, backdrop_art_portrait from special_days').all()).toEqual([
      { full_art: 'day-full.webp', backdrop_art: null, backdrop_art_portrait: null },
    ])
  })

  it('checks scenes and the new special day rules once 0003 is applied', () => {
    const { sqlite } = migratedMemoryDb()
    sqlite.prepare(`insert into special_day_scenes (id, name, lead, lead_days, takeover, palette, created_at, updated_at) values ('birthday', 'Birthday', 'days', 7, 1, 'frost', 0, 0)`).run()
    const insertDay = (columns: string, values: string) =>
      sqlite.prepare(`insert into special_days (id, name, month, day, repeat, created_at, updated_at, ${columns}) values ('d', 'D', 3, 14, 'yearly', 0, 0, ${values})`).run()

    // A yearly day on a scene, with nothing of its own, is fine.
    insertDay('scene_id, since_year', `'birthday', 2020`)
    sqlite.prepare(`delete from special_days`).run()

    // since_year only makes sense for a day that repeats.
    expect(() => sqlite.prepare(`insert into special_days (id, name, month, day, year, repeat, since_year, created_at, updated_at) values ('d', 'D', 3, 14, 2027, 'once', 2020, 0, 0)`).run()).toThrow(/CHECK/)
    // A count needs a lead of days, even when the lead is left to the scene.
    expect(() => insertDay('lead, lead_days', `NULL, 5`)).toThrow(/CHECK/)
    expect(() => insertDay('lead, lead_days', `'days', NULL`)).toThrow(/CHECK/)
    // A scene must be a real one, and cannot be deleted while a day uses it.
    expect(() => insertDay('scene_id', `'nope'`)).toThrow(/FOREIGN KEY/)
    insertDay('scene_id', `'birthday'`)
    expect(() => sqlite.prepare(`delete from special_day_scenes where id = 'birthday'`).run()).toThrow(/FOREIGN KEY/)
    sqlite.prepare(`delete from special_days`).run()
    sqlite.prepare(`delete from special_day_scenes where id = 'birthday'`).run()
  })

  it('fails clearly when the folder has no migrations', async () => {
    const handle = track(openDatabase(':memory:'))
    const missing = join(await tempDir(), 'missing')

    expect(() => runMigrations(handle, missing)).toThrow()
  })
})

describe('checkDb', () => {
  it('returns null while the database answers', () => {
    expect(checkDb(track(openDatabase(':memory:')).db)).toBeNull()
  })

  it('returns the error once the database is closed', () => {
    const handle = track(openDatabase(':memory:'))
    handle.sqlite.close()

    expect(checkDb(handle.db)).toMatch(/not open/i)
  })
})
