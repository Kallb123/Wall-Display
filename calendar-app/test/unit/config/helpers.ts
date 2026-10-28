import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { stringify } from 'yaml'
import { ConfigError, loadConfig } from '../../../server/config/load'
import type { AppConfig } from '../../../server/config/schema'

// Tests poke at the raw config freely, so it is loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wallcal-config-'))
  dirs.push(dir)
  return dir
}

/** The smallest valid config, as a plain object. Tests change what they need. */
export function minimalConfig(): Raw {
  return {
    people: [
      { id: 'mum', name: 'Mum', colour: '#C67139' },
      { id: 'theo', name: 'Theo', colour: '#5F94C4' },
    ],
    calendars: [
      {
        id: 'family',
        person: 'mum',
        source: { type: 'ics', url: 'https://example.com/family.ics' },
      },
    ],
    displays: [{ id: 'hallway', name: 'Hallway' }],
  }
}

export interface Loaded {
  dir: string
  configFile: string
  config: AppConfig
}

interface Setup {
  /** Raw YAML text, or an object that is written out as YAML. */
  config: string | Raw
  /** Raw YAML text for secrets.yaml. Omit for no secrets file. */
  secrets?: string
  env?: Record<string, string | undefined>
}

export async function writeConfig({ config, secrets }: Setup) {
  const dir = await tempDir()
  const configFile = join(dir, 'config.yaml')
  await writeFile(configFile, typeof config === 'string' ? config : stringify(config))
  if (secrets !== undefined) await writeFile(join(dir, 'secrets.yaml'), secrets)
  return { dir, configFile }
}

export async function load(setup: Setup): Promise<Loaded> {
  const { dir, configFile } = await writeConfig(setup)
  return { dir, configFile, config: loadConfig({ configFile, env: setup.env ?? {} }) }
}

/** Loads and expects failure. Returns the error. */
export async function loadError(setup: Setup): Promise<ConfigError> {
  const { configFile } = await writeConfig(setup)
  try {
    loadConfig({ configFile, env: setup.env ?? {} })
  } catch (error) {
    if (error instanceof ConfigError) return error
    throw error
  }
  throw new Error('expected loadConfig to throw a ConfigError')
}
