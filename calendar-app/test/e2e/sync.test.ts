import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'
import type { EventsResponse } from '../../shared/types/events'

describe('syncing and reading events', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  // The dev config, with its fixtures by absolute path (it is read from another
  // folder here) and a wide window, so October 2026 stays inside it as the
  // years go by. Nothing else differs.
  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)}\nsync:\n  months_back: 60\n  months_ahead: 60\n`)

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const theo = { id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4' }
  const isla = { id: 'isla', name: 'Isla', initial: 'I', colour: '#D27FA0' }

  it('POST /api/refresh syncs every calendar and says how each went', async () => {
    const body = await $fetch<{ calendars: { calendarId: string, status: string, error?: string }[] }>('/api/refresh', { method: 'POST' })

    // The boot sync may have got there first, which makes this one a 304-style no-op.
    expect(body.calendars.map(c => c.calendarId)).toEqual(['family', 'dad-work'])
    for (const calendar of body.calendars) expect(['updated', 'not-modified']).toContain(calendar.status)
    expect(JSON.stringify(body)).not.toContain('file:')
  })

  it('GET /api/events lists the events in a range, with their people', async () => {
    await $fetch('/api/refresh', { method: 'POST' })

    const body = await $fetch<EventsResponse>('/api/events?from=2026-10-01&to=2026-11-01')

    expect(body).toMatchObject({ from: '2026-09-30T23:00:00.000Z', to: '2026-11-01T00:00:00.000Z' })
    const swimming = body.events.find(event => event.display_title === 'Swimming' && event.start === '2026-10-28T16:30:00.000Z')
    expect(swimming).toMatchObject({ calendar_id: 'family', title: 'Theo: Swimming', all_day: false, people: [theo] })
    const dentist = body.events.find(event => event.display_title === 'Dentist')
    expect(dentist).toMatchObject({ title: '[Isla & Theo] Dentist', people: [isla, theo] })
    expect(body.events.find(event => event.title === 'Half term')).toMatchObject({ all_day: true, start_date: '2026-10-26', end_date: '2026-10-31', people: [{ id: 'home' }] })
    // Both calendars, in order of start.
    expect(new Set(body.events.map(event => event.calendar_id))).toEqual(new Set(['family', 'dad-work']))
    const starts = body.events.map(event => event.start)
    expect(starts).toEqual([...starts].sort())
    expect(JSON.stringify(body)).not.toContain('description')
  })

  it('GET /api/events answers a bad range with a 400 and a short reason', async () => {
    const reason = (message: string) => ({ statusCode: 400, data: { message: expect.stringContaining(message) } })

    await expect($fetch('/api/events?from=nope&to=2026-11-01')).rejects.toMatchObject(reason('from must be a date'))
    await expect($fetch('/api/events?from=2026-10-01')).rejects.toMatchObject(reason('to is required'))
    await expect($fetch('/api/events?from=2026-11-01&to=2026-10-01')).rejects.toMatchObject(reason('to must be after from'))
  })
})
