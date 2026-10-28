import { resolve } from 'node:path'
import { loadConfig } from '../config/load'
import { resolveConfigPaths } from '../config/paths'
import { setLoadedConfig } from '../config/state'

// Runs first (the 00 prefix), before the database and anything that needs config.
// Loading is synchronous so a bad config stops the server before it listens.
export default defineNitroPlugin(() => {
  const { configFile, secretsFile } = resolveConfigPaths({
    env: process.env,
    dev: import.meta.dev,
    devConfigFile: resolve(process.cwd(), 'config.dev.yaml'),
  })

  try {
    const config = loadConfig({ configFile, secretsFile, env: process.env })
    setLoadedConfig(config)
    console.info(`[config] loaded ${configFile}: ${config.people.length} people, ${config.calendars.length} calendars, ${config.displays.length} displays`)
  } catch (error) {
    console.error(`[config] ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
})
