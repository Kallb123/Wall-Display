import { afterEach, describe, expect, it } from 'vitest'
import { setLoadedConfig } from '../../../server/config/state'
import { useConfig } from '../../../server/utils/config'
import { load, minimalConfig } from './helpers'

afterEach(() => setLoadedConfig(undefined))

describe('useConfig', () => {
  it('throws a clear error before the config is loaded', () => {
    expect(() => useConfig()).toThrow(/before the config was loaded/)
  })

  it('returns the loaded config', async () => {
    const { config } = await load({ config: minimalConfig() })
    setLoadedConfig(config)

    expect(useConfig()).toBe(config)
  })
})
