import { describe, expect, it } from 'vitest'
import { buttonCommand } from '../../../server/control/button'
import { BUTTON_ACTIONS } from '../../../server/config/schema'
import { commandSchema } from '../../../shared/display'
import type { Command } from '../../../shared/display'

// What each action in the config's `button` block turns into: the command the
// control service applies, or null when the app leaves the gesture alone.

const screenOn = { screen: 'on' } as const
const screenOff = { screen: 'off' } as const

describe('buttonCommand', () => {
  it.each<[(typeof BUTTON_ACTIONS)[number], Command | null]>([
    ['next_view', { type: 'next_view' }],
    ['toggle_photo', { type: 'toggle_photo' }],
    ['next_photo', { type: 'photo_next' }],
    ['next_month', { type: 'set_month', month: 'next' }],
    ['prev_month', { type: 'set_month', month: 'prev' }],
    ['this_month', { type: 'set_month', month: 'current' }],
    ['refresh', { type: 'refresh' }],
    ['ha', null],
    ['none', null],
  ])('maps %s', (action, command) => {
    expect(buttonCommand(action, screenOn)).toEqual(command)
  })

  it('turns the screen off when it is on, and on when it is off', () => {
    expect(buttonCommand('toggle_screen', screenOn)).toEqual({ type: 'set_screen', screen: 'off' })
    expect(buttonCommand('toggle_screen', screenOff)).toEqual({ type: 'set_screen', screen: 'on' })
  })

  it('answers for every action the config accepts, with a command the schema accepts', () => {
    for (const action of BUTTON_ACTIONS) {
      const command = buttonCommand(action, screenOn)
      if (command !== null) expect(commandSchema.parse(command), action).toEqual(command)
    }
  })

  it('leaves exactly ha and none to someone else', () => {
    expect(BUTTON_ACTIONS.filter(action => buttonCommand(action, screenOn) === null)).toEqual(['ha', 'none'])
  })
})
