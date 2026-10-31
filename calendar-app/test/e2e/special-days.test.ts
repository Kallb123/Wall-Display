import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { todayIn } from '../../shared/dates'
import type { DisplayState, ServerMessage } from '../../shared/display'
import { PIN_HEADER } from '../../shared/remote'
import type { SpecialDay, SpecialDaysResponse } from '../../shared/special-days'

// The special days API, the resolution it serves and the socket push, on the
// dev config with `remote.pin` set: the writes need the PIN, and the tests send it.
describe('special days', async () => {
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

  const christmas = { name: 'Christmas', month: 12, day: 25, repeat: 'yearly', lead: 'month', takeover: true, greeting: 'Merry Christmas', palette: 'warm' }
  const create = (body: unknown, headers: Record<string, string> = right) => $fetch<SpecialDay>('/api/special-days', { method: 'POST', body: body as Record<string, unknown>, headers })
  const update = (id: string, body: unknown, headers: Record<string, string> = right) => $fetch<SpecialDay>(`/api/special-days/${id}`, { method: 'PUT', body: body as Record<string, unknown>, headers })
  const remove = (id: string, headers: Record<string, string> = right) => fetch(`/api/special-days/${id}`, { method: 'DELETE', headers })

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

  it('GET /api/special-days is empty to begin with', async () => {
    expect(await $fetch('/api/special-days')).toEqual([])
  })

  it('POST /api/special-days answers 201 with the new day, id and all', async () => {
    const response = await fetch('/api/special-days', { method: 'POST', body: JSON.stringify(christmas), headers: { ...right, 'content-type': 'application/json' } })
    const created = await response.json() as SpecialDay

    expect(response.status).toBe(201)
    expect(created).toEqual({
      id: 'christmas',
      name: 'Christmas',
      month: 12,
      day: 25,
      year: null,
      repeat: 'yearly',
      scene_id: null,
      who: null,
      since_year: null,
      lead: 'month',
      lead_days: null,
      tile_art: null,
      takeover: true,
      full_art: null,
      greeting: 'Merry Christmas',
      palette: 'warm',
      extra_art: null,
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    })
  })

  it('GET /api/special-days/:id and GET /api/special-days read it back', async () => {
    const day = await $fetch<SpecialDay>('/api/special-days/christmas')

    expect(day).toMatchObject({ id: 'christmas', name: 'Christmas' })
    expect(await $fetch('/api/special-days')).toEqual([day])
  })

  it('POST /api/special-days trims, normalises a blank greeting to null, and gives a repeated name the next id', async () => {
    const second = await create({ ...christmas, name: '  Christmas  ', day: 24, greeting: '   ' })

    expect(second).toMatchObject({ id: 'christmas-2', name: 'Christmas', day: 24, greeting: null })
    expect((await $fetch<SpecialDay[]>('/api/special-days')).map(day => day.id)).toEqual(['christmas-2', 'christmas'])
    expect((await remove('christmas-2')).status).toBe(204)
  })

  it('PUT /api/special-days/:id replaces the fields and keeps the id', async () => {
    const before = await $fetch<SpecialDay>('/api/special-days/christmas')
    await new Promise(resolve => setTimeout(resolve, 5))

    const updated = await update('christmas', { ...christmas, name: 'Xmas', lead: 'week', takeover: false, palette: 'frost' })

    expect(updated).toMatchObject({ id: 'christmas', name: 'Xmas', lead: 'week', takeover: false, palette: 'frost', tile_art: null, full_art: null })
    expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(before.updated_at))
    expect(await $fetch('/api/special-days/christmas')).toEqual(updated)
  })

  it('PUT /api/special-days/:id takes a custom lead in days, and drops the count when the lead changes back', async () => {
    // As the test before left it, which the tests after rely on.
    const edited = { ...christmas, name: 'Xmas', lead: 'week', takeover: false, palette: 'frost' }

    const custom = await update('christmas', { ...edited, lead: 'days', lead_days: 10 })
    expect(custom).toMatchObject({ lead: 'days', lead_days: 10 })

    const back = await update('christmas', edited)
    expect(back).toMatchObject({ lead: 'week', lead_days: null })
  })

  it('answers a bad body with a 400 that names the field', async () => {
    await expect(create({ ...christmas, name: '' })).rejects.toMatchObject(reason(400, 'name must'))
    await expect(create({ ...christmas, month: 13 })).rejects.toMatchObject(reason(400, 'month must'))
    await expect(create({ ...christmas, month: 2, day: 30 })).rejects.toMatchObject(reason(400, 'day must'))
    await expect(create({ ...christmas, repeat: 'once' })).rejects.toMatchObject(reason(400, 'year is required'))
    await expect(create({ ...christmas, year: 2027 })).rejects.toMatchObject(reason(400, 'year must'))
    await expect(create({ ...christmas, repeat: 'once', year: 2027, month: 2, day: 29 })).rejects.toMatchObject(reason(400, 'day must'))
    await expect(create({ ...christmas, palette: 'neon' })).rejects.toMatchObject(reason(400, 'palette must be one of'))
    await expect(create({ ...christmas, lead: 'fortnight' })).rejects.toMatchObject(reason(400, 'lead must be one of'))
    await expect(create({ ...christmas, lead: null, lead_days: 5 })).rejects.toMatchObject(reason(400, 'lead_days must be left out'))
    await expect(create({ ...christmas, lead: 'days' })).rejects.toMatchObject(reason(400, 'lead_days is required'))
    await expect(create({ ...christmas, lead: 'days', lead_days: 400 })).rejects.toMatchObject(reason(400, 'lead_days must'))
    await expect(create({ ...christmas, tile_art: 'x.webp' })).rejects.toMatchObject(reason(400, 'tile_art'))
    await expect(create({ ...christmas, extra_art: 'x.webp' })).rejects.toMatchObject(reason(400, 'extra_art'))
    await expect(create({ ...christmas, since_year: 1800 })).rejects.toMatchObject(reason(400, 'since_year must'))
    await expect(create({ ...christmas, repeat: 'once', year: 2027, since_year: 2019 })).rejects.toMatchObject(reason(400, 'since_year must be left out'))
    await expect(create({ ...christmas, who: 'x'.repeat(41) })).rejects.toMatchObject(reason(400, 'who must'))
    await expect(create({ ...christmas, greeting: 'Hi {name}' })).rejects.toMatchObject(reason(400, 'greeting has an unknown placeholder'))
    await expect(create(null)).rejects.toMatchObject({ statusCode: 400 })
    await expect(update('christmas', { ...christmas, takeover: 'yes' })).rejects.toMatchObject(reason(400, 'takeover must'))
    expect(await $fetch<SpecialDay[]>('/api/special-days')).toHaveLength(1)
  })

  it('answers 404 for an unknown day', async () => {
    await expect($fetch('/api/special-days/nothing')).rejects.toMatchObject(reason(404, 'Unknown special day "nothing"'))
    await expect(update('nothing', christmas)).rejects.toMatchObject(reason(404, 'Unknown special day "nothing"'))
    expect((await remove('nothing')).status).toBe(404)
  })

  it('serves /resolved from its own route, not as the id "resolved"', async () => {
    const response = await $fetch<SpecialDaysResponse>('/api/special-days/resolved')

    expect(response.special_days).toMatchObject({ today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), tiles: expect.any(Array) })
    // And a day named "Resolved" does not take the route's place.
    const day = await create({ ...christmas, name: 'Resolved' })
    expect(day.id).toBe('resolved-2')
    await remove('resolved-2')
  })

  it('GET /api/special-days/resolved follows an edit: tiles, today\'s special day and the takeover', async () => {
    const today = todayIn(new Date(), 'Europe/London')
    const [, month, day] = today.split('-').map(Number)

    const created = await create({ name: 'Today only', month, day, repeat: 'yearly', lead: 'day', takeover: true, greeting: 'Hello', palette: 'night' })
    const { special_days: resolved } = await $fetch<SpecialDaysResponse>('/api/special-days/resolved')

    expect(created.id).toBe('today-only')
    expect(resolved).toMatchObject({
      current: { id: 'today-only', name: 'Today only' },
      takeover: { id: 'today-only', name: 'Today only', greeting: 'Hello', palette: 'night', full_art: null },
    })
    expect(resolved!.tiles).toContainEqual({ date: resolved!.today, days: [{ id: 'today-only', name: 'Today only', palette: 'night', tile_art: null }] })

    expect((await remove('today-only')).status).toBe(204)
    const after = (await $fetch<SpecialDaysResponse>('/api/special-days/resolved')).special_days
    expect(after).toMatchObject({ current: null, takeover: null })
    expect(after!.tiles.map(tile => tile.days.map(d => d.id)).flat()).not.toContain('today-only')
  })

  it('sends the resolution on connect, and again after an edit', async () => {
    const { socket, messages, opened, next } = connect('display=hallway&role=display')
    await opened
    const first = await next(message => message.type === 'special_days.updated')
    expect(first).toMatchObject({ type: 'special_days.updated', special_days: { tiles: expect.any(Array) } })

    const seen = messages.length
    const today = todayIn(new Date(), 'Europe/London')
    const [, month, day] = today.split('-').map(Number)
    await create({ name: 'Pushed', month, day, repeat: 'yearly', lead: 'day', takeover: false, palette: 'sage' })
    const pushed = await next(message => message.type === 'special_days.updated' && message.special_days?.current?.id === 'pushed', seen)

    expect(pushed).toMatchObject({ special_days: { today, current: { id: 'pushed' }, takeover: null } })
    socket.close()
    await remove('pushed')
  })

  describe('previewing on the wall', () => {
    // A one-off day in 2030, so the date it is shown on does not depend on when the test runs.
    const halloween = { name: 'Halloween', month: 10, day: 31, year: 2030, repeat: 'once', lead: 'day', takeover: true, greeting: 'Boo!', palette: 'night' }
    const birthday = { name: 'Birthday', lead: 'week', takeover: true, greeting: 'Happy {nth} birthday, {who}!', palette: 'sage' }
    const command = (id: string, body: unknown, headers: Record<string, string> = right) => $fetch<DisplayState>(`/api/displays/${id}/commands`, { method: 'POST', body: body as Record<string, unknown>, headers })
    const preview = (query: string) => $fetch<SpecialDaysResponse>(`/api/special-days/preview${query}`)
    const createScene = (body: unknown) => $fetch('/api/special-day-scenes', { method: 'POST', body: body as Record<string, unknown>, headers: right })

    it('GET /api/special-days/preview?special_day= answers as if the day were today, from its own route', async () => {
      await create(halloween)

      const { special_days } = await preview('?special_day=halloween')

      expect(special_days).toMatchObject({
        today: '2030-10-31',
        from: '2030-09-17',
        to: '2030-11-14',
        tiles: [{ date: '2030-10-31', days: [{ id: 'halloween', name: 'Halloween', palette: 'night', tile_art: null }] }],
        current: { id: 'halloween', name: 'Halloween' },
        takeover: { id: 'halloween', date: '2030-10-31', greeting: 'Boo!', palette: 'night' },
        tomorrow_art: [],
      })
      // The day is not going to be the live resolution, which is for the real today.
      expect((await $fetch<SpecialDaysResponse>('/api/special-days/resolved')).special_days?.current?.id).not.toBe('halloween')
      await remove('halloween')
    })

    it('GET /api/special-days/preview?scene= shows a scene nobody uses today, with its placeholders as typed', async () => {
      await createScene(birthday)

      const { special_days } = await preview('?scene=birthday')

      expect(special_days).toMatchObject({
        today: todayIn(new Date(), 'Europe/London'),
        current: { id: 'scene:birthday', name: 'Birthday' },
        takeover: { id: 'scene:birthday', greeting: 'Happy {nth} birthday, {who}!', palette: 'sage' },
      })
    })

    it('GET /api/special-days/preview shows a scene through the first day that uses it', async () => {
      await create({ name: 'Isla', month: 3, day: 14, repeat: 'yearly', scene_id: 'birthday', who: 'Isla', since_year: 2019 })

      const { special_days } = await preview('?scene=birthday')

      expect(special_days?.current).toEqual({ id: 'isla', name: 'Isla' })
      expect(special_days?.takeover?.greeting).toMatch(/^Happy \d+(st|nd|rd|th) birthday, Isla!$/)
      await remove('isla')
    })

    it('GET /api/special-days/preview answers 400 unless it is given exactly one of special_day and scene, and 404 for an unknown one', async () => {
      await expect(preview('')).rejects.toMatchObject(reason(400, 'exactly one of special_day and scene'))
      await expect(preview('?special_day=halloween&scene=birthday')).rejects.toMatchObject(reason(400, 'exactly one of special_day and scene'))
      await expect(preview('?special_day=')).rejects.toMatchObject(reason(400, 'exactly one'))
      await expect(preview('?scene=a&scene=b')).rejects.toMatchObject(reason(400, 'exactly one'))
      await expect(preview('?special_day=nothing')).rejects.toMatchObject(reason(404, 'Unknown special day "nothing"'))
      await expect(preview('?scene=nothing')).rejects.toMatchObject(reason(404, 'Unknown scene "nothing"'))
    })

    it('POST /api/displays/:id/commands starts a preview of a day or a scene, and answers with the state', async () => {
      await create(halloween)

      const day = await command('hallway', { type: 'preview_special_day', id: 'halloween', seconds: 120 })
      expect(day.preview).toEqual({ special_day: 'halloween', until: expect.stringMatching(/Z$/) })
      expect(Date.parse(day.preview!.until) - Date.now()).toBeGreaterThan(110_000)
      expect((await $fetch<DisplayState>('/api/displays/hallway/state')).preview).toEqual(day.preview)

      const scene = await command('hallway', { type: 'preview_special_day', scene: 'birthday' })
      expect(scene.preview).toEqual({ scene: 'birthday', until: expect.any(String) })
      // Left out, it runs for a minute.
      expect(Date.parse(scene.preview!.until) - Date.now()).toBeLessThanOrEqual(60_000)
      expect(Date.parse(scene.preview!.until) - Date.now()).toBeGreaterThan(50_000)
      await remove('halloween')
      await fetch('/api/special-day-scenes/birthday', { method: 'DELETE', headers: right })
    })

    it('POST /api/displays/:id/commands answers a bad preview with a 400 and an unknown day or scene with a 404', async () => {
      await expect(command('hallway', { type: 'preview_special_day' })).rejects.toMatchObject(reason(400, 'needs exactly one of id and scene'))
      await expect(command('hallway', { type: 'preview_special_day', id: 'a', scene: 'b' })).rejects.toMatchObject(reason(400, 'needs exactly one of id and scene'))
      await expect(command('hallway', { type: 'preview_special_day', id: 'christmas', seconds: 4 })).rejects.toMatchObject(reason(400, 'seconds must be from 5 to 600'))
      await expect(command('hallway', { type: 'preview_special_day', id: 'christmas', seconds: 601 })).rejects.toMatchObject(reason(400, 'seconds must be from 5 to 600'))
      await expect(command('hallway', { type: 'preview_special_day', id: 'nothing' })).rejects.toMatchObject(reason(404, 'Unknown special day "nothing"'))
      await expect(command('hallway', { type: 'preview_special_day', scene: 'nothing' })).rejects.toMatchObject(reason(404, 'Unknown scene "nothing"'))
      await expect(command('garage', { type: 'preview_special_day', id: 'christmas' })).rejects.toMatchObject(reason(404, 'Unknown display "garage"'))
      // And it needs the PIN, like every command.
      await expect(command('hallway', { type: 'preview_special_day', id: 'christmas' }, {})).rejects.toMatchObject(reason(401, 'PIN required'))
    })

    it('clears the preview by itself when its time is up, and tells the socket', async () => {
      const { socket, messages, opened, next } = connect('display=hallway&role=display')
      await opened
      await next(message => message.type === 'state.updated')

      const seen = messages.length
      await command('hallway', { type: 'preview_special_day', id: 'christmas', seconds: 5 })
      await next(message => message.type === 'state.updated' && message.state.preview?.special_day === 'christmas', seen)
      const cleared = await next(message => message.type === 'state.updated' && message.state.preview === null, seen)

      expect(cleared).toMatchObject({ display_id: 'hallway', state: { preview: null } })
      expect((await $fetch<DisplayState>('/api/displays/hallway/state')).preview).toBeNull()
      socket.close()
    })
  })

  it('guards the writes with the PIN, and leaves the reads open', async () => {
    await expect(create(christmas, {})).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect(create(christmas, wrong)).rejects.toMatchObject(reason(401, 'Wrong PIN'))
    await expect(update('christmas', christmas, {})).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect(update('christmas', christmas, wrong)).rejects.toMatchObject(reason(401, 'Wrong PIN'))
    expect((await remove('christmas', {})).status).toBe(401)
    // Before it says whether the day exists.
    expect((await remove('nothing', {})).status).toBe(401)

    expect(await $fetch<SpecialDay[]>('/api/special-days')).toHaveLength(1)
    expect(await $fetch('/api/special-days/christmas')).toMatchObject({ name: 'Xmas' })
    expect((await $fetch<SpecialDaysResponse>('/api/special-days/resolved')).special_days).not.toBeNull()
  })

  it('DELETE /api/special-days/:id answers 204 with no body, and the day is gone', async () => {
    const response = await remove('christmas')

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(await $fetch('/api/special-days')).toEqual([])
    await expect($fetch('/api/special-days/christmas')).rejects.toMatchObject({ statusCode: 404 })
  })
})
