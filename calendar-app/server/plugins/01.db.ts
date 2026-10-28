import { realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { openDatabase, runMigrations } from '../db/client'
import { DB_FILE_NAME, findMigrationsDir, resolveDataDir } from '../db/paths'
import { getDb, setDb } from '../db/state'

// Nitro rewrites `import.meta.url`, and at plugin time it isn't set to the real
// location yet, so find the bundle from the entry script instead:
// `node .output/server/index.mjs`, from any working directory.
function serverBundleDir(): string {
  const entry = resolve(process.argv[1] ?? '')
  try {
    return dirname(realpathSync(entry))
  } catch {
    return dirname(entry)
  }
}

// Runs after the config plugin (the 01 prefix) and before anything that stores
// data. It is synchronous so a database that can't be opened or migrated stops
// the server before it listens.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so drop the old handle first.
  getDb()?.sqlite.close()
  setDb(undefined)

  const dataDir = resolveDataDir({ env: process.env, dev: import.meta.dev, rootDir: process.cwd() })
  const file = join(dataDir, DB_FILE_NAME)

  try {
    const handle = openDatabase(file)
    try {
      const migrationsDir = findMigrationsDir({
        env: process.env,
        dev: import.meta.dev,
        rootDir: process.cwd(),
        bundleDir: serverBundleDir(),
      })
      const { applied, total } = runMigrations(handle, migrationsDir)
      setDb(handle)
      console.info(`[db] ${file}: ${applied} migration(s) applied, at version ${total}`)
    } catch (error) {
      handle.sqlite.close()
      throw error
    }
  } catch (error) {
    console.error(`[db] could not set up the database at ${file}: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }

  nitroApp.hooks.hook('close', () => {
    getDb()?.sqlite.close()
    setDb(undefined)
  })
})
