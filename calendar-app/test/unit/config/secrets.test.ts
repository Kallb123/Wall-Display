import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { secretEnvName } from '../../../server/config/load'
import { load, loadError, minimalConfig } from './helpers'

// minimalConfig as text, with the family calendar's URL replaced by a !secret
function withSecretUrl(name: string): string {
  const raw = minimalConfig()
  raw.calendars[0].source.url = 'PLACEHOLDER'
  return stringify(raw).replace('PLACEHOLDER', `!secret ${name}`)
}

describe('!secret', () => {
  it('reads the value from secrets.yaml', async () => {
    const { config } = await load({
      config: withSecretUrl('family_ics_url'),
      secrets: 'family_ics_url: https://example.com/from-file.ics\n',
    })

    expect(config.calendars[0]!.source).toMatchObject({ url: 'https://example.com/from-file.ics' })
  })

  it('lets an environment variable override secrets.yaml', async () => {
    const { config } = await load({
      config: withSecretUrl('family_ics_url'),
      secrets: 'family_ics_url: https://example.com/from-file.ics\n',
      env: { WALLCAL_SECRET_FAMILY_ICS_URL: 'https://example.com/from-env.ics' },
    })

    expect(config.calendars[0]!.source).toMatchObject({ url: 'https://example.com/from-env.ics' })
  })

  it('works with the environment variable alone, with no secrets file', async () => {
    const { config } = await load({
      config: withSecretUrl('family_ics_url'),
      env: { WALLCAL_SECRET_FAMILY_ICS_URL: 'https://example.com/from-env.ics' },
    })

    expect(config.calendars[0]!.source).toMatchObject({ url: 'https://example.com/from-env.ics' })
  })

  it('normalises names for environment variables', () => {
    expect(secretEnvName('family_ics_url')).toBe('WALLCAL_SECRET_FAMILY_ICS_URL')
    expect(secretEnvName('dad-work.ics url')).toBe('WALLCAL_SECRET_DAD_WORK_ICS_URL')
  })

  it('finds a hyphenated secret through its normalised environment variable', async () => {
    const { config } = await load({
      config: withSecretUrl('dad-work-url'),
      env: { WALLCAL_SECRET_DAD_WORK_URL: 'https://example.com/dad.ics' },
    })

    expect(config.calendars[0]!.source).toMatchObject({ url: 'https://example.com/dad.ics' })
  })

  it('is fine without a secrets file when no secret is used', async () => {
    const { config } = await load({ config: minimalConfig() })

    expect(config.people).toHaveLength(2)
  })

  it('keeps secret values as text, so a PIN keeps its leading zero', async () => {
    const raw = stringify({ ...minimalConfig(), remote: { pin: 'PLACEHOLDER' } }).replace('PLACEHOLDER', '!secret remote_pin')
    const { config } = await load({ config: raw, secrets: 'remote_pin: 0042\n' })

    expect(config.remote?.pin).toBe('0042')
  })

  it('can fill any scalar, such as an aliases entry', async () => {
    const raw = stringify(minimalConfig()).replace('name: Mum', 'name: Mum\n    aliases: [!secret mum_nickname]')
    const { config } = await load({ config: raw, secrets: 'mum_nickname: Mummykins\n' })

    expect(config.people[0]!.aliases).toEqual(['Mummykins'])
  })

  describe('when a secret is missing', () => {
    it('names the secret, the config path, and both places it was looked for', async () => {
      const error = await loadError({ config: withSecretUrl('family_ics_url'), secrets: 'other: x\n' })

      expect(error.message).toContain('calendars[0].source.url')
      expect(error.message).toContain('"family_ics_url"')
      expect(error.message).toContain('WALLCAL_SECRET_FAMILY_ICS_URL')
      expect(error.message).toContain('secrets.yaml')
      // no follow-on "required" error for the same field
      expect(error.problems).toHaveLength(1)
    })

    it('says so when there is no secrets file at all', async () => {
      const error = await loadError({ config: withSecretUrl('family_ics_url') })

      expect(error.message).toContain('secrets.yaml')
      expect(error.message).toContain('file not found')
    })

    it('reports every missing secret', async () => {
      const raw = stringify(minimalConfig())
        .replace('https://example.com/family.ics', '!secret one')
        .replace('name: Hallway', 'name: !secret two')
      const error = await loadError({ config: raw })

      expect(error.problems).toHaveLength(2)
      expect(error.message).toContain('"one"')
      expect(error.message).toContain('"two"')
    })

    it('treats an empty value in secrets.yaml as missing', async () => {
      const error = await loadError({ config: withSecretUrl('family_ics_url'), secrets: 'family_ics_url: ""\n' })

      expect(error.message).toContain('key is empty')
    })
  })

  describe('error messages never contain secret values', () => {
    const sentinel = 'SENTINEL-s3cr3t-value'

    it('for an invalid secret in secrets.yaml', async () => {
      const error = await loadError({ config: withSecretUrl('family_ics_url'), secrets: `family_ics_url: ${sentinel}\n` })

      expect(error.message).toContain('calendars[0].source.url')
      expect(error.message).toContain('secret "family_ics_url"')
      expect(error.message).not.toContain(sentinel)
    })

    it('for an invalid secret in an environment variable', async () => {
      const error = await loadError({
        config: withSecretUrl('family_ics_url'),
        env: { WALLCAL_SECRET_FAMILY_ICS_URL: sentinel },
      })

      expect(error.message).toContain('secret "family_ics_url"')
      expect(error.message).not.toContain(sentinel)
    })

    it('for a secret used where a regular expression is expected', async () => {
      const raw = stringify({
        ...minimalConfig(),
        calendars: [{ ...minimalConfig().calendars[0], rules: [{ match: 'PLACEHOLDER', people: ['theo'] }] }],
      }).replace('PLACEHOLDER', '!secret pattern')
      const error = await loadError({ config: raw, secrets: `pattern: "(${sentinel}"\n` })

      expect(error.message).toContain('calendars[0].rules[0].match')
      expect(error.message).not.toContain(sentinel)
    })

    it('for a broken secrets.yaml', async () => {
      const error = await loadError({
        config: withSecretUrl('family_ics_url'),
        secrets: `family_ics_url: ${sentinel}\n  bad: [indent\n`,
      })

      expect(error.message).toContain('secrets.yaml')
      expect(error.message).not.toContain(sentinel)
    })

    it('for a secret value that ends up inside another message', async () => {
      // a secret used as an alias that clashes with another person's name, which is
      // reported against the later person
      const raw = stringify(minimalConfig()).replace('name: Mum', 'name: Mum\n    aliases: [!secret nick]')
      const error = await loadError({ config: raw, secrets: 'nick: Theo\n' })

      expect(error.message).toContain('people[1].name')
      expect(error.message).toContain('"***" is already a name or alias')
    })
  })

  it('reports a !secret with no name', async () => {
    const error = await loadError({ config: stringify(minimalConfig()).replace('name: Hallway', 'name: !secret') })

    expect(error.message).toContain('!secret needs a secret name')
  })
})
