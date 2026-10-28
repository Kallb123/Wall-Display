import { describe, expect, it } from 'vitest'
import { parseSocketQuery } from '../../../server/ws/query'

const known = (id: string) => id === 'hallway'

describe('the socket query', () => {
  it('reads the display and the role', () => {
    expect(parseSocketQuery('/_ws?display=hallway&role=remote', known)).toEqual({ ok: true, displayId: 'hallway', role: 'remote' })
    expect(parseSocketQuery('ws://wall.local:3000/_ws?role=display&display=hallway', known)).toEqual({ ok: true, displayId: 'hallway', role: 'display' })
  })

  it('refuses a missing display or a bad role with a 400', () => {
    expect(parseSocketQuery('/_ws?role=remote', known)).toMatchObject({ ok: false, status: 400, message: 'display is required' })
    expect(parseSocketQuery('/_ws?display=hallway', known)).toMatchObject({ ok: false, status: 400, message: 'role must be display or remote' })
    expect(parseSocketQuery('/_ws?display=hallway&role=admin', known)).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses an unknown display with a 404', () => {
    expect(parseSocketQuery('/_ws?display=garage&role=remote', known)).toMatchObject({ ok: false, status: 404 })
  })
})
