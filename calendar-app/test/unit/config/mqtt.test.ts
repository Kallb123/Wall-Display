import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { load, loadError, minimalConfig } from './helpers'

/** Loads a config with this `mqtt` block and returns the error message. */
async function messageFor(mqtt: unknown): Promise<string> {
  const config = minimalConfig()
  config.mqtt = mqtt
  return (await loadError({ config })).message
}

describe('the mqtt block', () => {
  it('is left out when MQTT is off', async () => {
    const { config } = await load({ config: minimalConfig() })

    expect(config.mqtt).toBeUndefined()
  })

  it('takes a full block', async () => {
    const raw = minimalConfig()
    raw.mqtt = { url: 'mqtts://broker.example.com:8883', username: 'wallcal', password: 'hunter2', client_id: 'wall_cal-1' }
    const { config } = await load({ config: raw })

    expect(config.mqtt).toEqual({ url: 'mqtts://broker.example.com:8883', username: 'wallcal', password: 'hunter2', client_id: 'wall_cal-1' })
  })

  it('needs only a URL, and the client id defaults to wallcal', async () => {
    const raw = minimalConfig()
    raw.mqtt = { url: 'mqtt://mosquitto:1883' }
    const { config } = await load({ config: raw })

    expect(config.mqtt).toEqual({ url: 'mqtt://mosquitto:1883', client_id: 'wallcal' })
  })

  it.each([
    ['no port', 'mqtt://mosquitto'],
    ['a trailing slash', 'mqtt://192.168.1.20:1883/'],
    ['an IPv6 host', 'mqtt://[::1]:1883'],
  ])('accepts a URL with %s', async (_name, url) => {
    const raw = minimalConfig()
    raw.mqtt = { url }
    const { config } = await load({ config: raw })

    expect(config.mqtt?.url).toBe(url)
  })

  it.each([
    ['http', 'http://mosquitto:1883'],
    ['ws', 'ws://mosquitto:9001'],
    ['a bare host', 'mosquitto:1883'],
    ['no scheme at all', 'mosquitto'],
    ['no host', 'mqtt://'],
  ])('rejects a URL that is %s', async (_name, url) => {
    const message = await messageFor({ url })

    expect(message).toContain('mqtt.url: ')
    expect(message).toMatch(/mqtt:\/\/ or mqtts:\/\/ URL|host name/)
  })

  it('rejects credentials in the URL, and points to username and password', async () => {
    const message = await messageFor({ url: 'mqtt://wallcal:hunter2@mosquitto:1883' })

    expect(message).toContain('mqtt.url: must not contain a username or password (use the username and password settings instead)')
    expect(message).not.toContain('hunter2')
  })

  it('rejects a username in the URL', async () => {
    expect(await messageFor({ url: 'mqtt://wallcal@mosquitto:1883' })).toContain('mqtt.url: must not contain a username or password')
  })

  it.each([
    ['a path', 'mqtt://mosquitto:1883/wallcal'],
    ['a query', 'mqtt://mosquitto:1883/?a=1'],
  ])('rejects a URL with %s', async (_name, url) => {
    expect(await messageFor({ url })).toContain('mqtt.url: must be just the broker')
  })

  it('needs a URL', async () => {
    expect(await messageFor({ username: 'wallcal' })).toContain('mqtt.url: is required')
  })

  it('rejects a password without a username', async () => {
    const message = await messageFor({ url: 'mqtt://mosquitto:1883', password: 'hunter2' })

    expect(message).toContain('mqtt.password: needs a username')
    expect(message).not.toContain('hunter2')
  })

  it('accepts a username without a password', async () => {
    const raw = minimalConfig()
    raw.mqtt = { url: 'mqtt://mosquitto:1883', username: 'wallcal' }
    const { config } = await load({ config: raw })

    expect(config.mqtt).toMatchObject({ username: 'wallcal' })
    expect(config.mqtt).not.toHaveProperty('password')
  })

  it.each([
    ['a space', 'wall cal'],
    ['a slash', 'wall/cal'],
    ['a dot', 'wall.cal'],
    ['nothing', ''],
    ['more than 64 characters', 'a'.repeat(65)],
  ])('rejects a client_id with %s', async (_name, clientId) => {
    expect(await messageFor({ url: 'mqtt://mosquitto:1883', client_id: clientId })).toContain('mqtt.client_id: must be 1 to 64 letters, digits, hyphens and underscores')
  })

  it('rejects an unknown setting', async () => {
    expect(await messageFor({ url: 'mqtt://mosquitto:1883', topic_prefix: 'home' })).toContain('mqtt.topic_prefix: unknown setting')
  })

  describe('with !secret', () => {
    const sentinel = 'SENTINEL-s3cr3t-value'

    /** The config as text, with each `!secret ...` value in the mqtt block written as a reference. */
    function withSecrets(mqtt: Record<string, string>): string {
      const [head, block] = stringify({ ...minimalConfig(), mqtt }).split('\nmqtt:\n')
      return `${head}\nmqtt:\n${block!.replace(/: "?(!secret \w+)"?$/gm, ': $1')}`
    }

    it('reads the password from secrets.yaml', async () => {
      const { config } = await load({
        config: withSecrets({ url: 'mqtt://mosquitto:1883', username: 'wallcal', password: '!secret mqtt_password' }),
        secrets: `mqtt_password: ${sentinel}\n`,
      })

      expect(config.mqtt?.password).toBe(sentinel)
    })

    it('never puts the password in an error, when there is no username to go with it', async () => {
      const error = await loadError({
        config: withSecrets({ url: 'mqtt://mosquitto:1883', password: '!secret mqtt_password' }),
        secrets: `mqtt_password: ${sentinel}\n`,
      })

      expect(error.message).toContain('mqtt.password: needs a username')
      expect(error.message).not.toContain(sentinel)
    })

    it('never puts the password in an error, when the URL is a secret that carries it', async () => {
      const error = await loadError({
        config: withSecrets({ url: '!secret mqtt_url' }),
        secrets: `mqtt_url: mqtt://wallcal:${sentinel}@mosquitto:1883\n`,
      })

      expect(error.message).toContain('mqtt.url: must not contain a username or password')
      expect(error.message).toContain('secret "mqtt_url"')
      expect(error.message).not.toContain(sentinel)
    })

    it('never puts the password in an error, whatever else is wrong with the block', async () => {
      const error = await loadError({
        config: withSecrets({ url: 'http://mosquitto:1883', password: '!secret mqtt_password', client_id: 'no good' }),
        secrets: `mqtt_password: ${sentinel}\n`,
      })

      expect(error.problems.length).toBeGreaterThanOrEqual(2)
      expect(error.message).not.toContain(sentinel)
    })
  })
})
