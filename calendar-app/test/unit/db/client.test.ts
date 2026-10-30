import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, runMigrations } from '../../../server/db/client'
import { checkDb } from '../../../server/db/health'
import { MIGRATIONS_DIR, tempDir, track } from './helpers'

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
  it('creates all six tables on an empty database', () => {
    const handle = track(openDatabase(':memory:'))

    const result = runMigrations(handle, MIGRATIONS_DIR)

    const tables = handle.sqlite
      .prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_%' escape '\\' order by name`)
      .all()
      .map(row => (row as { name: string }).name)
    expect(tables).toEqual(['calendars', 'display_state', 'events', 'photo_assets', 'special_days', 'sync_status'])
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
