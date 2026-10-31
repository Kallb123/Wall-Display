import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { todayIn } from '../../shared/dates'
import type { ServerMessage } from '../../shared/display'
import { PIN_HEADER } from '../../shared/remote'
import type { SpecialDay, SpecialDayScene, SpecialDaysResponse } from '../../shared/special-days'

// The scenes API, the copying routes and the checks that tie days to scenes,
// on the dev config with `remote.pin` set: the writes need the PIN, and the
// tests send it. The tests build on each other, in order.
describe('special day scenes', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)}\nremote:\n  pin: "2468"\n`)

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const reason = (statusCode: number, message: string) => ({ statusCode, data: { message: expect.stringContaining(message) } })
  const right = { [PIN_HEADER]: '2468' }
  const wrong = { [PIN_HEADER]: '1357' }

  const birthday = { name: 'Birthday', lead: 'week', takeover: true, greeting: 'Happy {nth} birthday, {who}!', palette: 'sage' }
  const isla = { name: 'Isla\'s birthday', month: 3, day: 14, repeat: 'yearly', scene_id: 'birthday', who: 'Isla', since_year: 2019 }

  const send = <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = right) =>
    $fetch<T>(path, { method: method as 'POST', body: body as Record<string, unknown>, headers })
  const raw = (method: string, path: string, headers: Record<string, string> = right) => fetch(path, { method, headers })
  const createScene = (body: unknown, headers?: Record<string, string>) => send<SpecialDayScene>('POST', '/api/special-day-scenes', body, headers)
  const updateScene = (id: string, body: unknown, headers?: Record<string, string>) => send<SpecialDayScene>('PUT', `/api/special-day-scenes/${id}`, body, headers)
  const createDay = (body: unknown, headers?: Record<string, string>) => send<SpecialDay>('POST', '/api/special-days', body, headers)
  const updateDay = (id: string, body: unknown, headers?: Record<string, string>) => send<SpecialDay>('PUT', `/api/special-days/${id}`, body, headers)
  const resolved = async () => (await $fetch<SpecialDaysResponse>('/api/special-days/resolved')).special_days!

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
    /** Resolves with the first message from index `from` on that passes `match`. */
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

  it('GET /api/special-day-scenes is empty to begin with', async () => {
    expect(await $fetch('/api/special-day-scenes')).toEqual([])
  })

  it('POST /api/special-day-scenes answers 201 with the new scene, id and all', async () => {
    const response = await fetch('/api/special-day-scenes', { method: 'POST', body: JSON.stringify(birthday), headers: { ...right, 'content-type': 'application/json' } })
    const created = await response.json() as SpecialDayScene

    expect(response.status).toBe(201)
    expect(created).toEqual({
      id: 'birthday',
      name: 'Birthday',
      lead: 'week',
      lead_days: null,
      tile_art: null,
      takeover: true,
      full_art: null,
      greeting: 'Happy {nth} birthday, {who}!',
      palette: 'sage',
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    })
  })

  it('GET /api/special-day-scenes/:id and GET /api/special-day-scenes read it back', async () => {
    const scene = await $fetch<SpecialDayScene>('/api/special-day-scenes/birthday')

    expect(scene).toMatchObject({ id: 'birthday', name: 'Birthday' })
    expect(await $fetch('/api/special-day-scenes')).toEqual([scene])
  })

  it('answers a bad scene body with a 400 that names the field', async () => {
    await expect(createScene({ ...birthday, name: '' })).rejects.toMatchObject(reason(400, 'name must'))
    await expect(createScene({ ...birthday, lead: undefined })).rejects.toMatchObject(reason(400, 'lead'))
    await expect(createScene({ ...birthday, lead: 'days' })).rejects.toMatchObject(reason(400, 'lead_days is required'))
    await expect(createScene({ ...birthday, takeover: undefined })).rejects.toMatchObject(reason(400, 'takeover'))
    await expect(createScene({ ...birthday, palette: 'neon' })).rejects.toMatchObject(reason(400, 'palette must be one of'))
    await expect(createScene({ ...birthday, greeting: 'Hello {name}' })).rejects.toMatchObject(reason(400, 'greeting has an unknown placeholder {name}'))
    await expect(createScene({ ...birthday, tile_art: 'x.webp' })).rejects.toMatchObject(reason(400, 'tile_art is not a field of a scene'))
    await expect(createScene(null)).rejects.toMatchObject({ statusCode: 400 })
    await expect(updateScene('birthday', { ...birthday, takeover: 'yes' })).rejects.toMatchObject(reason(400, 'takeover must'))
    expect(await $fetch<SpecialDayScene[]>('/api/special-day-scenes')).toHaveLength(1)
  })

  it('answers 404 for an unknown scene', async () => {
    await expect($fetch('/api/special-day-scenes/nothing')).rejects.toMatchObject(reason(404, 'Unknown scene "nothing"'))
    await expect(updateScene('nothing', birthday)).rejects.toMatchObject(reason(404, 'Unknown scene "nothing"'))
    expect((await raw('DELETE', '/api/special-day-scenes/nothing')).status).toBe(404)
    expect((await raw('POST', '/api/special-day-scenes/nothing/duplicate')).status).toBe(404)
  })

  it('POST /api/special-days takes a scene, who and since_year, with the look left to the scene', async () => {
    const created = await createDay(isla)

    expect(created).toMatchObject({
      id: 'isla-s-birthday',
      scene_id: 'birthday',
      who: 'Isla',
      since_year: 2019,
      lead: null,
      lead_days: null,
      takeover: null,
      greeting: null,
      palette: null,
      extra_art: null,
    })
  })

  it('answers 400 for an unknown scene_id, and for a greeting the day can\'t fill', async () => {
    await expect(createDay({ ...isla, scene_id: 'nothing' })).rejects.toMatchObject(reason(400, 'scene_id is not a scene: "nothing"'))
    await expect(updateDay('isla-s-birthday', { ...isla, scene_id: 'nothing' })).rejects.toMatchObject(reason(400, 'scene_id is not a scene: "nothing"'))
    await expect(createDay({ ...isla, name: 'Theo\'s birthday', since_year: undefined })).rejects.toMatchObject(reason(400, 'greeting can\'t be filled for Theo\'s birthday: {nth} needs since_year'))
    await expect(createDay({ ...isla, name: 'Other', who: undefined })).rejects.toMatchObject(reason(400, '{who} needs who'))

    const error = await updateDay('isla-s-birthday', { ...isla, since_year: undefined }).catch((caught: unknown) => caught)
    expect(error).toMatchObject(reason(400, 'greeting can\'t be filled for Isla\'s birthday: {nth} needs since_year'))
    expect((error as { data: { data: unknown } }).data.data).toEqual({ days: [{ id: 'isla-s-birthday', name: 'Isla\'s birthday' }] })
    expect(await $fetch<SpecialDay[]>('/api/special-days')).toHaveLength(1)
  })

  it('PUT /api/special-day-scenes/:id answers a greeting some day can\'t fill with a 400 naming every such day', async () => {
    // Under a greeting with no placeholders any day will do.
    await updateScene('birthday', { ...birthday, greeting: 'Happy birthday' })
    await updateDay('isla-s-birthday', { ...isla, since_year: undefined })
    await createDay({ ...isla, name: 'Theo\'s birthday', month: 9, day: 2, who: undefined, since_year: undefined })
    // Fine whatever the scene says, because it has a greeting of its own.
    await createDay({ ...isla, name: 'Ann', month: 5, day: 5, greeting: 'Hi', since_year: undefined, who: undefined })

    const error = await updateScene('birthday', birthday).catch((caught: unknown) => caught)

    expect(error).toMatchObject(reason(400, 'greeting can\'t be filled for Isla\'s birthday ({nth} needs since_year) and Theo\'s birthday ({nth} needs since_year and {who} needs who)'))
    expect((error as { data: { data: unknown } }).data.data).toEqual({
      days: [{ id: 'isla-s-birthday', name: 'Isla\'s birthday' }, { id: 'theo-s-birthday', name: 'Theo\'s birthday' }],
    })
    // Nothing was saved.
    expect(await $fetch('/api/special-day-scenes/birthday')).toMatchObject({ greeting: 'Happy birthday' })

    // Put right, the same save goes through.
    expect((await raw('DELETE', '/api/special-days/theo-s-birthday')).status).toBe(204)
    expect((await raw('DELETE', '/api/special-days/ann')).status).toBe(204)
    await updateDay('isla-s-birthday', isla)
    expect(await updateScene('birthday', birthday)).toMatchObject({ greeting: 'Happy {nth} birthday, {who}!' })
  })

  it('PUT /api/special-day-scenes/:id replaces the fields, keeps the id, and leaves the days\' updated_at alone', async () => {
    const dayBefore = await $fetch<SpecialDay>('/api/special-days/isla-s-birthday')
    const before = await $fetch<SpecialDayScene>('/api/special-day-scenes/birthday')
    await new Promise(resolve => setTimeout(resolve, 5))

    const updated = await updateScene('birthday', { ...birthday, lead: 'days', lead_days: 10, takeover: false, palette: 'frost' })

    expect(updated).toMatchObject({ id: 'birthday', lead: 'days', lead_days: 10, takeover: false, palette: 'frost', tile_art: null, full_art: null })
    expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(before.updated_at))
    expect(await $fetch('/api/special-day-scenes/birthday')).toEqual(updated)
    expect((await $fetch<SpecialDay>('/api/special-days/isla-s-birthday')).updated_at).toBe(dayBefore.updated_at)

    const back = await updateScene('birthday', birthday)
    expect(back).toMatchObject({ lead: 'week', lead_days: null })
  })

  it('POST /api/special-days/:id/duplicate answers 201 with the copy', async () => {
    const response = await raw('POST', '/api/special-days/isla-s-birthday/duplicate')
    const copy = await response.json() as SpecialDay

    expect(response.status).toBe(201)
    expect(copy).toMatchObject({ id: 'copy-of-isla-s-birthday', name: 'Copy of Isla\'s birthday', scene_id: 'birthday', who: 'Isla', since_year: 2019, month: 3, day: 14 })
    expect(await $fetch('/api/special-days/copy-of-isla-s-birthday')).toEqual(copy)
    expect((await raw('DELETE', '/api/special-days/copy-of-isla-s-birthday')).status).toBe(204)
    expect((await raw('POST', '/api/special-days/nothing/duplicate')).status).toBe(404)
  })

  it('POST /api/special-day-scenes/:id/duplicate answers 201 with the copy', async () => {
    const response = await raw('POST', '/api/special-day-scenes/birthday/duplicate')
    const copy = await response.json() as SpecialDayScene

    expect(response.status).toBe(201)
    expect(copy).toMatchObject({ id: 'copy-of-birthday', name: 'Copy of Birthday', lead: 'week', palette: 'sage' })
    expect((await raw('DELETE', '/api/special-day-scenes/copy-of-birthday')).status).toBe(204)
  })

  it('POST /api/special-days/:id/save-as-scene answers 201 with the scene and the day, named after the day by default', async () => {
    const response = await raw('POST', '/api/special-days/isla-s-birthday/save-as-scene')
    const body = await response.json() as { scene: SpecialDayScene, day: SpecialDay }

    expect(response.status).toBe(201)
    expect(body.scene).toMatchObject({ id: 'isla-s-birthday', name: 'Isla\'s birthday', lead: 'week', takeover: true, palette: 'sage', greeting: 'Happy {nth} birthday, {who}!' })
    expect(body.day).toMatchObject({ scene_id: 'isla-s-birthday', who: 'Isla', since_year: 2019, lead: null, palette: null })
    expect(await $fetch('/api/special-days/isla-s-birthday')).toEqual(body.day)

    // Put it back for the tests after.
    expect(await updateDay('isla-s-birthday', isla)).toMatchObject({ scene_id: 'birthday' })
    expect((await raw('DELETE', '/api/special-day-scenes/isla-s-birthday')).status).toBe(204)
  })

  it('POST /api/special-days/:id/save-as-scene takes a name, and leaves updated_at alone', async () => {
    const before = await $fetch<SpecialDay>('/api/special-days/isla-s-birthday')
    await new Promise(resolve => setTimeout(resolve, 5))

    const saved = await send<{ scene: SpecialDayScene, day: SpecialDay }>('POST', '/api/special-days/isla-s-birthday/save-as-scene', { name: '  Isla style  ' })

    expect(saved.scene).toMatchObject({ id: 'isla-style', name: 'Isla style' })
    expect(saved.day.updated_at).toBe(before.updated_at)
    await updateDay('isla-s-birthday', isla)
    await raw('DELETE', '/api/special-day-scenes/isla-style')
  })

  it('answers a bad save-as-scene body with a 400, and an unknown day with a 404', async () => {
    await expect(send('POST', '/api/special-days/isla-s-birthday/save-as-scene', { name: '' })).rejects.toMatchObject(reason(400, 'name must'))
    await expect(send('POST', '/api/special-days/isla-s-birthday/save-as-scene', { name: 'x'.repeat(61) })).rejects.toMatchObject(reason(400, 'name must'))
    await expect(send('POST', '/api/special-days/isla-s-birthday/save-as-scene', { title: 'x' })).rejects.toMatchObject(reason(400, 'title is not a field of the save-as-scene body'))
    await expect(send('POST', '/api/special-days/nothing/save-as-scene', {})).rejects.toMatchObject(reason(404, 'Unknown special day "nothing"'))
    expect(await $fetch<SpecialDayScene[]>('/api/special-day-scenes')).toHaveLength(1)
  })

  it('serves /resolved from its own route, and the day routes next to the folder of /:id routes', async () => {
    expect((await resolved()).tiles).toEqual(expect.any(Array))
    expect(await $fetch('/api/special-days/isla-s-birthday')).toMatchObject({ id: 'isla-s-birthday' })
    expect(await $fetch('/api/special-day-scenes/birthday')).toMatchObject({ id: 'birthday' })
  })

  it('DELETE /api/special-day-scenes/:id answers 409 naming the days while a day uses the scene', async () => {
    await createDay({ ...isla, name: 'Theo\'s birthday', month: 9, day: 2, who: 'Theo' })

    const error = await raw('DELETE', '/api/special-day-scenes/birthday')
    const body = await error.json() as { message: string, data: { days: unknown } }

    expect(error.status).toBe(409)
    expect(body.message).toBe('Scene "Birthday" is used by Isla\'s birthday and Theo\'s birthday')
    expect(body.data.days).toEqual([{ id: 'isla-s-birthday', name: 'Isla\'s birthday' }, { id: 'theo-s-birthday', name: 'Theo\'s birthday' }])
    expect(await $fetch('/api/special-day-scenes/birthday')).toMatchObject({ id: 'birthday' })
  })

  it('sends the resolution again after a scene is saved that changes a day\'s look', async () => {
    const today = todayIn(new Date(), 'Europe/London')
    const [, month, day] = today.split('-').map(Number)
    await createDay({ name: 'Today', month, day, repeat: 'yearly', scene_id: 'birthday', who: 'Zed', since_year: 2020 })

    const { socket, messages, opened, next } = connect('display=hallway&role=display')
    await opened
    await next(message => message.type === 'special_days.updated' && message.special_days?.takeover?.palette === 'sage')

    const seen = messages.length
    await updateScene('birthday', { ...birthday, palette: 'night' })
    const pushed = await next(message => message.type === 'special_days.updated' && message.special_days?.takeover?.palette === 'night', seen)

    expect(pushed).toMatchObject({ special_days: { today, takeover: { id: 'today', palette: 'night', greeting: expect.stringMatching(/^Happy \d+(st|nd|rd|th) birthday, Zed!$/) } } })
    socket.close()
    expect((await raw('DELETE', '/api/special-days/today')).status).toBe(204)
  })

  it('DELETE /api/special-day-scenes/:id?detach=true copies the scene into its days and leaves the wall as it was', async () => {
    const today = todayIn(new Date(), 'Europe/London')
    const [, month, day] = today.split('-').map(Number)
    await createDay({ name: 'Today', month, day, repeat: 'yearly', scene_id: 'birthday', who: 'Zed', since_year: 2020 })
    const before = await resolved()
    const dayBefore = await $fetch<SpecialDay>('/api/special-days/isla-s-birthday')

    const response = await raw('DELETE', '/api/special-day-scenes/birthday?detach=true')

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(await resolved()).toEqual(before)
    expect(await $fetch('/api/special-days/isla-s-birthday')).toEqual({ ...dayBefore, scene_id: null, lead: 'week', takeover: true, greeting: 'Happy {nth} birthday, {who}!', palette: 'night' })
    await expect($fetch('/api/special-day-scenes/birthday')).rejects.toMatchObject({ statusCode: 404 })
    expect(await $fetch('/api/special-day-scenes')).toEqual([])
  })

  it('DELETE /api/special-day-scenes/:id answers 204 for a scene nobody uses', async () => {
    await createScene(birthday)

    const response = await raw('DELETE', '/api/special-day-scenes/birthday')

    expect(response.status).toBe(204)
    expect(await $fetch('/api/special-day-scenes')).toEqual([])
  })

  it('guards every write with the PIN, and leaves the reads open', async () => {
    await createScene(birthday)
    const writes: [string, string][] = [
      ['POST', '/api/special-day-scenes'],
      ['PUT', '/api/special-day-scenes/birthday'],
      ['DELETE', '/api/special-day-scenes/birthday'],
      ['DELETE', '/api/special-day-scenes/birthday?detach=true'],
      ['POST', '/api/special-day-scenes/birthday/duplicate'],
      ['POST', '/api/special-days/isla-s-birthday/duplicate'],
      ['POST', '/api/special-days/isla-s-birthday/save-as-scene'],
      // Before it says whether the scene or day exists.
      ['DELETE', '/api/special-day-scenes/nothing'],
      ['POST', '/api/special-days/nothing/duplicate'],
    ]
    for (const [method, path] of writes) {
      expect((await raw(method, path, {})).status, `${method} ${path} with no PIN`).toBe(401)
      expect((await raw(method, path, wrong)).status, `${method} ${path} with a wrong PIN`).toBe(401)
    }
    await expect(createScene(birthday, {})).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect(updateScene('birthday', birthday, wrong)).rejects.toMatchObject(reason(401, 'Wrong PIN'))

    expect(await $fetch<SpecialDayScene[]>('/api/special-day-scenes')).toHaveLength(1)
    expect(await $fetch('/api/special-day-scenes/birthday')).toMatchObject({ name: 'Birthday' })
  })
})
