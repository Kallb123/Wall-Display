import { dirname, join, resolve } from 'node:path'

export type Env = Record<string, string | undefined>

export interface ConfigPathOptions {
  env: Env
  /** True under `nuxt dev`, where a missing env falls back to the dev config. */
  dev: boolean
  /** Where `config.dev.yaml` lives (the calendar-app folder). */
  devConfigFile: string
}

export interface ConfigPaths {
  configFile: string
  secretsFile: string
}

const DEFAULT_CONFIG_DIR = '/config'

function set(value: string | undefined): value is string {
  return value !== undefined && value !== ''
}

/**
 * Works out which config file to read:
 *
 * 1. `WALLCAL_CONFIG_FILE`, if set.
 * 2. `config.yaml` in `WALLCAL_CONFIG_DIR`, if set.
 * 3. Under `nuxt dev`, `config.dev.yaml` in the calendar-app folder.
 * 4. `/config/config.yaml`.
 *
 * `secrets.yaml` is always looked for in the same folder as the config file.
 */
export function resolveConfigPaths({ env, dev, devConfigFile }: ConfigPathOptions): ConfigPaths {
  let configFile: string
  if (set(env.WALLCAL_CONFIG_FILE)) configFile = resolve(env.WALLCAL_CONFIG_FILE)
  else if (set(env.WALLCAL_CONFIG_DIR)) configFile = resolve(env.WALLCAL_CONFIG_DIR, 'config.yaml')
  else if (dev) configFile = resolve(devConfigFile)
  else configFile = join(DEFAULT_CONFIG_DIR, 'config.yaml')

  return { configFile, secretsFile: join(dirname(configFile), 'secrets.yaml') }
}
