import { describe, expect, it } from 'vitest'
import { resolveConfigPaths } from '../../../server/config/paths'

const devConfigFile = '/app/calendar-app/config.dev.yaml'

describe('resolveConfigPaths', () => {
  it('defaults to /config/config.yaml in production', () => {
    expect(resolveConfigPaths({ env: {}, dev: false, devConfigFile })).toEqual({
      configFile: '/config/config.yaml',
      secretsFile: '/config/secrets.yaml',
    })
  })

  it('uses config.dev.yaml under nuxt dev when no env var is set', () => {
    expect(resolveConfigPaths({ env: {}, dev: true, devConfigFile })).toEqual({
      configFile: devConfigFile,
      secretsFile: '/app/calendar-app/secrets.yaml',
    })
  })

  it('uses config.yaml in WALLCAL_CONFIG_DIR, in dev or not', () => {
    const env = { WALLCAL_CONFIG_DIR: '/srv/wallcal' }
    const expected = { configFile: '/srv/wallcal/config.yaml', secretsFile: '/srv/wallcal/secrets.yaml' }

    expect(resolveConfigPaths({ env, dev: false, devConfigFile })).toEqual(expected)
    expect(resolveConfigPaths({ env, dev: true, devConfigFile })).toEqual(expected)
  })

  it('uses WALLCAL_CONFIG_FILE, with secrets.yaml beside it', () => {
    const env = { WALLCAL_CONFIG_FILE: '/etc/wallcal/home.yaml' }

    expect(resolveConfigPaths({ env, dev: false, devConfigFile })).toEqual({
      configFile: '/etc/wallcal/home.yaml',
      secretsFile: '/etc/wallcal/secrets.yaml',
    })
  })

  it('prefers WALLCAL_CONFIG_FILE over WALLCAL_CONFIG_DIR', () => {
    const env = { WALLCAL_CONFIG_FILE: '/a/one.yaml', WALLCAL_CONFIG_DIR: '/b' }

    expect(resolveConfigPaths({ env, dev: true, devConfigFile }).configFile).toBe('/a/one.yaml')
  })

  it('treats empty env vars as unset', () => {
    const env = { WALLCAL_CONFIG_FILE: '', WALLCAL_CONFIG_DIR: '' }

    expect(resolveConfigPaths({ env, dev: false, devConfigFile }).configFile).toBe('/config/config.yaml')
  })

  it('makes a relative WALLCAL_CONFIG_FILE absolute', () => {
    const { configFile } = resolveConfigPaths({ env: { WALLCAL_CONFIG_FILE: 'conf/x.yaml' }, dev: false, devConfigFile })

    expect(configFile).toBe(`${process.cwd()}/conf/x.yaml`)
  })
})
