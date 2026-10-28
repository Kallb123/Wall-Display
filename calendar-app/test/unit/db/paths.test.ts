import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findMigrationsDir, resolveDataDir } from '../../../server/db/paths'

describe('resolveDataDir', () => {
  const rootDir = '/app/calendar-app'

  it('defaults to /data in production', () => {
    expect(resolveDataDir({ env: {}, dev: false, rootDir })).toBe('/data')
  })

  it('uses .data in the calendar-app folder under nuxt dev', () => {
    expect(resolveDataDir({ env: {}, dev: true, rootDir })).toBe('/app/calendar-app/.data')
  })

  it('uses WALLCAL_DATA_DIR, in dev or not', () => {
    const env = { WALLCAL_DATA_DIR: '/srv/wallcal/data' }

    expect(resolveDataDir({ env, dev: false, rootDir })).toBe('/srv/wallcal/data')
    expect(resolveDataDir({ env, dev: true, rootDir })).toBe('/srv/wallcal/data')
  })

  it('makes a relative WALLCAL_DATA_DIR absolute', () => {
    const dir = resolveDataDir({ env: { WALLCAL_DATA_DIR: 'data' }, dev: false, rootDir })

    expect(dir.startsWith('/')).toBe(true)
    expect(dir.endsWith('/data')).toBe(true)
  })

  it('ignores an empty WALLCAL_DATA_DIR', () => {
    expect(resolveDataDir({ env: { WALLCAL_DATA_DIR: '' }, dev: false, rootDir })).toBe('/data')
  })
})

describe('findMigrationsDir', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  async function bundle(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'wallcal-bundle-'))
    dirs.push(dir)
    return dir
  }

  async function addMigrations(dir: string): Promise<string> {
    const migrations = join(dir, 'db', 'migrations')
    await mkdir(join(migrations, 'meta'), { recursive: true })
    await writeFile(join(migrations, 'meta', '_journal.json'), '{}')
    return migrations
  }

  it('uses server/db/migrations in the calendar-app folder under nuxt dev', () => {
    expect(findMigrationsDir({ env: {}, dev: true, rootDir: '/app/calendar-app', bundleDir: '/nowhere' }))
      .toBe('/app/calendar-app/server/db/migrations')
  })

  it('finds db/migrations next to the server entry', async () => {
    const dir = await bundle()
    const migrations = await addMigrations(dir)

    expect(findMigrationsDir({ env: {}, dev: false, rootDir: '/x', bundleDir: dir })).toBe(migrations)
  })

  it('finds db/migrations above the bundle folder', async () => {
    const dir = await bundle()
    const migrations = await addMigrations(dir)
    const chunks = join(dir, 'chunks', 'nitro')
    await mkdir(chunks, { recursive: true })

    expect(findMigrationsDir({ env: {}, dev: false, rootDir: '/x', bundleDir: chunks })).toBe(migrations)
  })

  it('prefers WALLCAL_MIGRATIONS_DIR', async () => {
    const dir = await bundle()
    await addMigrations(dir)

    expect(findMigrationsDir({ env: { WALLCAL_MIGRATIONS_DIR: '/custom/migrations' }, dev: false, rootDir: '/x', bundleDir: dir }))
      .toBe('/custom/migrations')
  })

  it('explains what it tried when there are no migrations', async () => {
    const dir = await bundle()

    expect(() => findMigrationsDir({ env: {}, dev: false, rootDir: '/x', bundleDir: dir }))
      .toThrow(/Could not find the database migrations.*WALLCAL_MIGRATIONS_DIR/)
  })
})
