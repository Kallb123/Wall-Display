import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../../server/config/load'

const appDir = fileURLToPath(new URL('../../..', import.meta.url))
const repoDir = fileURLToPath(new URL('../../../..', import.meta.url))

describe('shipped config files', () => {
  it('config.example.yaml loads with secrets.example.yaml', () => {
    const config = loadConfig({
      configFile: `${repoDir}config.example.yaml`,
      secretsFile: `${repoDir}secrets.example.yaml`,
      env: {},
    })

    expect(config.people.map(person => person.id)).toEqual(['mum', 'dad', 'isla', 'theo', 'poppy', 'home'])
    expect(config.people.find(person => person.id === 'home')).toMatchObject({ initial: 'H', aliases: ['Family', 'All'] })
    expect(config.calendars.map(calendar => calendar.source.type)).toEqual(['ics', 'ics', 'homeassistant'])
    expect(config.homeassistant?.token).toBe('CHANGE_ME_HOME_ASSISTANT_TOKEN')
    expect(config.remote?.pin).toBe('1234')
    expect(config.photos?.immich?.api_key).toBe('CHANGE_ME_IMMICH_KEY')
    expect(config.displays[0]!.id).toBe('hallway')
  })

  it('config.example.yaml needs every secret in secrets.example.yaml', async () => {
    const used = [...(await readFile(`${repoDir}config.example.yaml`, 'utf8')).matchAll(/^[^#\n]*!secret (\w+)/gm)].map(match => match[1])
    const defined = (await readFile(`${repoDir}secrets.example.yaml`, 'utf8')).matchAll(/^(\w+):/gm)

    expect(used.length).toBeGreaterThan(0)
    expect([...defined].map(match => match[1]).sort()).toEqual([...new Set(used)].sort())
  })

  it('config.dev.yaml loads with no secrets file and no environment', () => {
    const config = loadConfig({ configFile: `${appDir}config.dev.yaml`, secretsFile: '/nonexistent/secrets.yaml', env: {} })

    expect(config.homeassistant).toBeUndefined()
    expect(config.calendars.map(calendar => calendar.id)).toEqual(['family', 'dad-work'])
    expect(config.displays).toEqual([expect.objectContaining({ id: 'hallway', theme: 'light' })])
    const urls = config.calendars.map(calendar => (calendar.source as { url: string }).url)
    expect(urls[0]).toBe(`file://${appDir}test/fixtures/ics/family.ics`)
  })
})
