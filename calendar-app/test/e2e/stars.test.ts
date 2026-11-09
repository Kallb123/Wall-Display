import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { addDays, todayIn } from '../../shared/dates'
import type { ServerMessage } from '../../shared/display'
import { PIN_HEADER } from '../../shared/remote'
import type { StarChart, StarSettingsEntry } from '../../shared/stars'

// The star chart API, on the dev config with `remote.pin` set: the writes need
// the PIN, and the tests send it. The tests build on each other, in order.
describe('star chart', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  const dev = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)
  writeFileSync(configFile, `${dev}\nremote:\n  pin: "2468"\n`)

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const right = { [PIN_HEADER]: '2468' }
  const wrong = { [PIN_HEADER]: '1357' }
  // The dev config's time zone, which is what "today" is on the server.
  const today = todayIn(new Date(), 'Europe/London')
  const yesterday = addDays(today, -1)

  const send = <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = right) =>
    $fetch<T>(path, { method: method as 'POST', body: body as Record<string, unknown>, headers })
  const adjust = (personId: string, body: unknown, headers?: Record<string, string>) => send<StarChart>('POST', `/api/stars/${personId}`, body, headers)
  const configure = (personId: string, body: unknown, headers?: Record<string, string>) => send<StarSettingsEntry>('PUT', `/api/settings/stars/${personId}`, body, headers)
  const reason = (statusCode: number, message: string) => ({ statusCode, data: { message: expect.stringContaining(message) } })

  /** A socket that collects what the server sends. */
  function connect(query: string) {
    const socket = new WebSocket(url(`/_ws?${query}`).replace(/^http/, 'ws'))
    const messages: ServerMessage[] = []
    const waiting: (() => void)[] = []
    socket.addEventListener('message', (event) => {
      messages.push(JSON.parse(String(event.data)) as ServerMessage)
      for (const wake of waiting.splice(0)) wake()
    })
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('error', () => reject(new Error('the socket did not open')))
    })
    async function next(match: (message: ServerMessage) => boolean, from = 0): Promise<ServerMessage> {
      const deadline = Date.now() + 10_000
      for (;;) {
        const found = messages.slice(from).find(match)
        if (found) return found
        if (Date.now() > deadline) throw new Error(`no matching message, got ${JSON.stringify(messages)}`)
        await new Promise<void>((resolve) => {
          waiting.push(resolve)
          setTimeout(resolve, 200)
        })
      }
    }
    return { socket, messages, opened, next }
  }

  const isStars = (message: ServerMessage): message is Extract<ServerMessage, { type: 'stars.updated' }> => message.type === 'stars.updated'

  it('starts with no charts, and the settings list every person in config order, all off', async () => {
    expect(await $fetch('/api/stars')).toEqual({ people: [], counts: {} })
    const entries = await $fetch<StarSettingsEntry[]>('/api/settings/stars')
    expect(entries.map(entry => entry.id)).toEqual(['mum', 'dad', 'isla', 'theo', 'poppy', 'home'])
    expect(entries[0]).toEqual({ id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139', enabled: false, period: 'week', goal: null })
  })

  it('needs the PIN for every write', async () => {
    await expect(configure('isla', { enabled: true, period: 'week', goal: null }, {})).rejects.toMatchObject({ statusCode: 401 })
    await expect(configure('isla', { enabled: true, period: 'week', goal: null }, wrong)).rejects.toMatchObject({ statusCode: 401 })
    await expect(adjust('isla', { delta: 1 }, {})).rejects.toMatchObject({ statusCode: 401 })
    expect((await fetch('/api/stars/isla', { method: 'POST', headers: wrong })).status).toBe(401)
    expect(await $fetch('/api/stars')).toEqual({ people: [], counts: {} })
  })

  it('PUT /api/settings/stars/:id answers with the entry and switches the chart on', async () => {
    const entry = await configure('isla', { enabled: true, period: 'day', goal: 3 })
    expect(entry).toEqual({ id: 'isla', name: 'Isla', initial: 'I', colour: '#D27FA0', enabled: true, period: 'day', goal: 3 })
    expect((await $fetch<StarSettingsEntry[]>('/api/settings/stars')).find(e => e.id === 'isla')).toEqual(entry)
    expect(await $fetch('/api/stars')).toEqual({ people: [{ id: 'isla', name: 'Isla', initial: 'I', colour: '#D27FA0', period: 'day', goal: 3 }], counts: {} })
  })

  it('refuses a bad settings body with a 400 that names the field, and an unknown person with a 404', async () => {
    await expect(configure('isla', { enabled: true, period: 'month', goal: null })).rejects.toMatchObject(reason(400, 'period'))
    await expect(configure('isla', { enabled: true, period: 'day', goal: 0 })).rejects.toMatchObject(reason(400, 'goal'))
    await expect(configure('isla', { enabled: true, period: 'day', goal: null, extra: 1 })).rejects.toMatchObject(reason(400, 'extra'))
    await expect(configure('nobody', { enabled: true, period: 'day', goal: null })).rejects.toMatchObject(reason(404, 'nobody'))
  })

  it('POST /api/stars/:id adds stars for today, and answers with the chart', async () => {
    const chart = await adjust('isla', { delta: 2 })
    expect(chart.counts).toEqual({ isla: { [today]: 2 } })
    expect(chart.people.map(person => person.id)).toEqual(['isla'])
    expect(await $fetch('/api/stars')).toEqual(chart)
  })

  it('takes stars away, on another day, and never below 0', async () => {
    await adjust('isla', { delta: 3, date: yesterday })
    expect((await adjust('isla', { delta: -1, date: yesterday })).counts.isla).toEqual({ [yesterday]: 2, [today]: 2 })
    expect((await adjust('isla', { delta: -10, date: yesterday })).counts.isla).toEqual({ [today]: 2 })
  })

  it('refuses a bad adjustment with a 400, a future or too old date included', async () => {
    await expect(adjust('isla', { delta: 0 })).rejects.toMatchObject(reason(400, 'delta'))
    await expect(adjust('isla', { delta: 11 })).rejects.toMatchObject(reason(400, 'delta'))
    await expect(adjust('isla', { delta: 1, date: 'yesterday' })).rejects.toMatchObject(reason(400, 'date'))
    await expect(adjust('isla', { delta: 1, date: addDays(today, 2) })).rejects.toMatchObject(reason(400, 'in the future'))
    await expect(adjust('isla', { delta: 1, date: addDays(today, -14) })).rejects.toMatchObject(reason(400, 'too long ago'))
    expect((await adjust('isla', { delta: 1, date: addDays(today, -13) })).counts.isla![addDays(today, -13)]).toBe(1)
  })

  it('answers 404 for a person who is not in the config and 409 for one without a chart', async () => {
    await expect(adjust('nobody', { delta: 1 })).rejects.toMatchObject(reason(404, 'nobody'))
    await expect(adjust('theo', { delta: 1 })).rejects.toMatchObject(reason(409, 'theo'))
    await configure('isla', { enabled: false, period: 'day', goal: 3 })
    await expect(adjust('isla', { delta: 1 })).rejects.toMatchObject(reason(409, 'isla'))
  })

  it('keeps the counts of a person whose chart is switched off, and brings them back when it is switched on', async () => {
    expect(await $fetch('/api/stars')).toEqual({ people: [], counts: {} })
    await configure('isla', { enabled: true, period: 'week', goal: 10 })
    expect((await $fetch<StarChart>('/api/stars')).counts.isla![today]).toBe(2)
  })

  it('sends the chart to a new socket on connect, and again to every socket after a change', async () => {
    const hallway = connect('display=hallway&role=display')
    const remote = connect('display=hallway&role=remote')
    await Promise.all([hallway.opened, remote.opened])

    const onConnect = await hallway.next(isStars) as { stars: StarChart }
    expect(onConnect.stars.people.map(person => person.id)).toEqual(['isla'])
    await remote.next(isStars)

    const seen = [hallway.messages.length, remote.messages.length] as const
    await configure('theo', { enabled: true, period: 'day', goal: null })
    await adjust('theo', { delta: 4 })

    for (const [socket, from] of [[hallway, seen[0]], [remote, seen[1]]] as const) {
      const pushed = await socket.next(message => isStars(message) && message.stars.counts.theo?.[today] === 4, from) as { stars: StarChart }
      expect(pushed.stars.people.map(person => person.id)).toEqual(['isla', 'theo'])
    }
    hallway.socket.close()
    remote.socket.close()
  })
})
