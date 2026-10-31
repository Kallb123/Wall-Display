import type { Command, DisplayState } from '../../shared/display'
import type { ButtonAction } from '../config/schema'

// What a press of the physical button does (architecture §7.4): the config
// maps each gesture (`button.single`, `double`, `long`) to one of these
// actions, and this turns the action into the command the display's control
// service applies. Pure, so the button handling (which reads the gesture off
// MQTT) only has to look the action up and apply what comes back.

/**
 * The command for `action`, or null when the app does nothing: `none`, and
 * `ha`, which leaves the gesture to a Home Assistant automation. `state` is the
 * display's current state, because `toggle_screen` goes to whichever is the
 * opposite of what the screen is now.
 */
export function buttonCommand(action: ButtonAction, state: Pick<DisplayState, 'screen'>): Command | null {
  switch (action) {
    case 'next_view': return { type: 'next_view' }
    case 'toggle_photo': return { type: 'toggle_photo' }
    case 'next_photo': return { type: 'photo_next' }
    case 'toggle_screen': return { type: 'set_screen', screen: state.screen === 'on' ? 'off' : 'on' }
    case 'next_month': return { type: 'set_month', month: 'next' }
    case 'prev_month': return { type: 'set_month', month: 'prev' }
    case 'this_month': return { type: 'set_month', month: 'current' }
    case 'refresh': return { type: 'refresh' }
    case 'ha':
    case 'none':
      return null
  }
}
