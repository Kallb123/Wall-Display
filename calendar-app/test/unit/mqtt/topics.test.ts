import { describe, expect, it } from 'vitest'
import type { Command, DisplayState } from '../../../shared/display'
import { defaultDisplayState } from '../../../server/control/commands'
import {
  AVAILABILITY_TOPIC,
  BUTTON_GESTURES,
  buttonPayloadReason,
  COMMAND_TOPICS,
  displayBase,
  parseButtonPayload,
  parseCommandPayload,
  parseCommandTopic,
  parseIlluminancePayload,
  parsePresencePayload,
  parseSchedulePayload,
  parseScheduleTopic,
  PI_BUTTON_TOPIC,
  PI_ILLUMINANCE_TOPIC,
  PI_PRESENCE_TOPIC,
  illuminancePayloadReason,
  presencePayloadReason,
  SCHEDULE_SET_TEMPLATE,
  SCHEDULE_STATE_TEMPLATE,
  schedulePayloads,
  scheduleTopic,
  statePayloads,
  topicFor,
} from '../../../server/mqtt/topics'
import type { CommandTopic } from '../../../server/mqtt/topics'

// How topics and payloads turn into commands and back (architecture §7.3).
// contract.test.ts holds the same rules against contracts/mqtt.json.

function state(overrides: Partial<DisplayState> = {}): DisplayState {
  return { ...defaultDisplayState(), ...overrides }
}

function command(suffix: CommandTopic, payload: string): Command {
  const parsed = parseCommandPayload(suffix, payload)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.command
}

function reason(suffix: CommandTopic, payload: string): string {
  const parsed = parseCommandPayload(suffix, payload)
  if (parsed.ok) throw new Error(`${suffix} accepted ${JSON.stringify(payload)}`)
  return parsed.reason
}

describe('topic names', () => {
  it('puts a display under the root', () => {
    expect(displayBase('hallway')).toBe('wallcal/hallway')
    expect(topicFor('hallway', 'view/set')).toBe('wallcal/hallway/view/set')
    expect(topicFor('hallway', AVAILABILITY_TOPIC)).toBe('wallcal/hallway/availability')
  })
})

describe('parseCommandTopic', () => {
  it('finds the display and the command in every command topic', () => {
    for (const suffix of COMMAND_TOPICS) {
      expect(parseCommandTopic(topicFor('hallway', suffix))).toEqual({ displayId: 'hallway', suffix })
    }
  })

  it('leaves out anything that is not a command topic of the app', () => {
    for (const topic of [
      'wallcal/hallway/view/state',
      'wallcal/hallway/availability',
      'wallcal/hallway/pi/screen/set',
      'wallcal/hallway/pi/button',
      'wallcal/hallway/pi/presence',
      'wallcal/hallway/pi/illuminance',
      'wallcal/hallway/view/set/extra',
      'wallcal/hallway/View/set',
      'wallcal/hallway',
      'wallcal//view/set',
      'wallcal/view/set',
      'other/hallway/view/set',
      'hallway/view/set',
      '/wallcal/hallway/view/set',
      '',
    ]) {
      expect(parseCommandTopic(topic), topic).toBeNull()
    }
  })
})

describe('the button topic', () => {
  it('is under pi/, for the display, and is not a command topic', () => {
    expect(PI_BUTTON_TOPIC).toBe('pi/button')
    expect(topicFor('hallway', PI_BUTTON_TOPIC)).toBe('wallcal/hallway/pi/button')
    expect((COMMAND_TOPICS as readonly string[]).includes(PI_BUTTON_TOPIC)).toBe(false)
    expect(parseCommandTopic(topicFor('hallway', PI_BUTTON_TOPIC))).toBeNull()
  })
})

describe('parseButtonPayload', () => {
  it('names the gesture in each of the three payloads', () => {
    expect(BUTTON_GESTURES).toEqual(['single', 'double', 'long'])
    for (const gesture of BUTTON_GESTURES) expect(parseButtonPayload(gesture)).toBe(gesture)
  })

  it('takes nothing else: no other case, no spaces, no other word, no empty payload', () => {
    for (const payload of ['Single', 'DOUBLE', 'long ', ' long', 'long\n', 'triple', 'press', 'single,double', '', ' ', 'toString', '__proto__']) {
      expect(parseButtonPayload(payload), JSON.stringify(payload)).toBeNull()
    }
  })

  it('has a reason that names the topic and quotes at most 60 characters of the payload', () => {
    expect(buttonPayloadReason('triple')).toBe('pi/button: must be single, double or long (got "triple")')
    expect(buttonPayloadReason('a\nb')).toBe('pi/button: must be single, double or long (got "a\\nb")')
    expect(buttonPayloadReason('x'.repeat(61))).toBe(`pi/button: must be single, double or long (got "${'x'.repeat(60)}…")`)
  })
})

describe('the presence topic', () => {
  it('is under pi/, for the display, and is not a command topic', () => {
    expect(PI_PRESENCE_TOPIC).toBe('pi/presence')
    expect(topicFor('hallway', PI_PRESENCE_TOPIC)).toBe('wallcal/hallway/pi/presence')
    expect((COMMAND_TOPICS as readonly string[]).includes(PI_PRESENCE_TOPIC)).toBe(false)
    expect(parseCommandTopic(topicFor('hallway', PI_PRESENCE_TOPIC))).toBeNull()
  })
})

describe('parsePresencePayload', () => {
  it('reads ON as someone there and OFF as nobody', () => {
    expect(parsePresencePayload('ON')).toBe(true)
    expect(parsePresencePayload('OFF')).toBe(false)
  })

  it('takes nothing else: no other case, no spaces, no other word, no empty payload', () => {
    for (const payload of ['on', 'Off', 'ON ', ' OFF', 'ON\n', 'true', 'false', '1', '0', 'present', '', ' ', 'toString', '__proto__']) {
      expect(parsePresencePayload(payload), JSON.stringify(payload)).toBeNull()
    }
  })

  it('has a reason that names the topic and quotes at most 60 characters of the payload', () => {
    expect(presencePayloadReason('on')).toBe('pi/presence: must be ON or OFF (got "on")')
    expect(presencePayloadReason('a\nb')).toBe('pi/presence: must be ON or OFF (got "a\\nb")')
    expect(presencePayloadReason('x'.repeat(61))).toBe(`pi/presence: must be ON or OFF (got "${'x'.repeat(60)}…")`)
  })
})

describe('the illuminance topic', () => {
  it('is under pi/, for the display, and is not a command topic', () => {
    expect(PI_ILLUMINANCE_TOPIC).toBe('pi/illuminance')
    expect(topicFor('hallway', PI_ILLUMINANCE_TOPIC)).toBe('wallcal/hallway/pi/illuminance')
    expect((COMMAND_TOPICS as readonly string[]).includes(PI_ILLUMINANCE_TOPIC)).toBe(false)
    expect(parseCommandTopic(topicFor('hallway', PI_ILLUMINANCE_TOPIC))).toBeNull()
  })
})

describe('parseIlluminancePayload', () => {
  it('reads a whole number or a decimal of lux', () => {
    expect(parseIlluminancePayload('0')).toBe(0)
    expect(parseIlluminancePayload('0.25')).toBe(0.25)
    expect(parseIlluminancePayload('12.5')).toBe(12.5)
    expect(parseIlluminancePayload('430')).toBe(430)
    expect(parseIlluminancePayload('100000')).toBe(100000)
  })

  it('takes more decimal places than the agent sends, as the contract does', () => {
    expect(parseIlluminancePayload('12.500')).toBe(12.5)
    expect(parseIlluminancePayload('0.001')).toBe(0.001)
  })

  it('takes nothing else: no sign, exponent, comma, leading zero, bare point, space or other word', () => {
    for (const payload of ['', ' ', '-1', '-0', '+1', '1e3', '1E3', '12,5', '.5', '5.', '00', '012', '0x10', ' 5', '5 ', '5\n', '1 2', 'abc', 'NaN', 'Infinity', '-Infinity', 'toString', '__proto__', '٥']) {
      expect(parseIlluminancePayload(payload), JSON.stringify(payload)).toBeNull()
    }
  })

  it('takes no number too big to be a reading', () => {
    expect(parseIlluminancePayload('9'.repeat(400))).toBeNull()
  })
})

describe('illuminancePayloadReason', () => {
  it('names the topic and quotes at most 60 characters of the payload', () => {
    expect(illuminancePayloadReason('abc')).toBe('pi/illuminance: must be a number of lux such as 12.5 (got "abc")')
    expect(illuminancePayloadReason('a\nb')).toBe('pi/illuminance: must be a number of lux such as 12.5 (got "a\\nb")')
    expect(illuminancePayloadReason('x'.repeat(61))).toBe(`pi/illuminance: must be a number of lux such as 12.5 (got "${'x'.repeat(60)}…")`)
  })
})

describe('parseCommandPayload', () => {
  it('turns view/set into a view, and next into the next view', () => {
    expect(command('view/set', 'agenda')).toEqual({ type: 'set_view', view: 'agenda' })
    expect(command('view/set', 'night')).toEqual({ type: 'set_view', view: 'night' })
    expect(command('view/set', 'next')).toEqual({ type: 'next_view' })
  })

  it('turns month/set into a month, or current, prev and next', () => {
    expect(command('month/set', '2026-12')).toEqual({ type: 'set_month', month: '2026-12' })
    for (const month of ['current', 'prev', 'next']) {
      expect(command('month/set', month)).toEqual({ type: 'set_month', month })
    }
  })

  it('turns screen/set and photo_source/set into commands', () => {
    expect(command('screen/set', 'off')).toEqual({ type: 'set_screen', screen: 'off' })
    expect(command('photo_source/set', 'google')).toEqual({ type: 'set_photo_source', photo_source: 'google' })
  })

  it('reads brightness as a whole number from 0 to 100, with a trailing .0 allowed', () => {
    expect(command('brightness/set', '0')).toEqual({ type: 'set_brightness', brightness: 0 })
    expect(command('brightness/set', '80')).toEqual({ type: 'set_brightness', brightness: 80 })
    expect(command('brightness/set', '100')).toEqual({ type: 'set_brightness', brightness: 100 })
    expect(command('brightness/set', '50.0')).toEqual({ type: 'set_brightness', brightness: 50 })
    expect(command('brightness/set', '50.00')).toEqual({ type: 'set_brightness', brightness: 50 })
  })

  it('rejects brightness that is not a whole number in range', () => {
    for (const payload of ['50.5', 'abc', '101', '-1', '', ' ', '1e2', '050', '80%', '5 0', '0x10', '+5', '.0', '100.5']) {
      expect(parseCommandPayload('brightness/set', payload), JSON.stringify(payload)).toMatchObject({ ok: false })
    }
  })

  it('does not clamp brightness, and says what the range is', () => {
    expect(reason('brightness/set', '101')).toContain('must be from 0 to 100')
    expect(reason('brightness/set', '50.5')).toContain('must be a whole number from 0 to 100')
  })

  it('reads ON and OFF, in upper case, for both automatic policies', () => {
    expect(command('auto_presence/set', 'ON')).toEqual({ type: 'set_auto_presence', auto_presence: true })
    expect(command('auto_presence/set', 'OFF')).toEqual({ type: 'set_auto_presence', auto_presence: false })
    expect(command('auto_brightness/set', 'ON')).toEqual({ type: 'set_auto_brightness', auto_brightness: true })
    expect(command('auto_brightness/set', 'OFF')).toEqual({ type: 'set_auto_brightness', auto_brightness: false })
  })

  it('rejects the policies in any other spelling', () => {
    for (const suffix of ['auto_presence/set', 'auto_brightness/set'] as const) {
      for (const payload of ['on', 'Off', 'true', '1', '', 'ON ']) {
        expect(reason(suffix, payload), `${suffix} ${JSON.stringify(payload)}`).toContain('must be ON or OFF')
      }
    }
  })

  it('turns an overlay object into set_overlay', () => {
    expect(command('overlay/set', '{"text":"Bins out tonight","icon":"trash","ttl":3600}')).toEqual({
      type: 'set_overlay',
      overlay: { text: 'Bins out tonight', icon: 'trash', ttl: 3600 },
    })
    expect(command('overlay/set', '{"text":"Back at 6"}')).toEqual({ type: 'set_overlay', overlay: { text: 'Back at 6' } })
  })

  it('clears the overlay for an empty payload, or one of only whitespace', () => {
    for (const payload of ['', ' ', '\n', ' \t\r\n']) {
      expect(command('overlay/set', payload)).toEqual({ type: 'set_overlay', overlay: null })
    }
  })

  it('rejects an overlay that is not a valid object for the command', () => {
    for (const payload of [
      'not json',
      '{',
      '{}',
      'null',
      '[]',
      '"Hi"',
      '42',
      '{"text":""}',
      '{"text":"   "}',
      '{"text":7}',
      `{"text":"${'x'.repeat(201)}"}`,
      '{"text":"Hi","colour":"red"}',
      '{"text":"Hi","ttl":0}',
      '{"text":"Hi","ttl":604801}',
      '{"text":"Hi","ttl":1.5}',
      '{"text":"Hi","ttl":"60"}',
      '{"text":"Hi","icon":""}',
    ]) {
      expect(parseCommandPayload('overlay/set', payload), payload).toMatchObject({ ok: false })
    }
  })

  it('names the field that is wrong in an overlay', () => {
    expect(reason('overlay/set', '{"text":"Hi","ttl":0}')).toContain('ttl must be at least 1 second')
    expect(reason('overlay/set', '{"text":""}')).toContain('text must not be empty')
    expect(reason('overlay/set', '{"text":"Hi","colour":"red"}')).toContain('Unrecognized key')
  })

  it('takes any payload for photo/next and refresh', () => {
    for (const payload of ['', '1', 'now', '{"a":1}']) {
      expect(command('photo/next', payload)).toEqual({ type: 'photo_next' })
      expect(command('refresh', payload)).toEqual({ type: 'refresh' })
    }
  })

  it('rejects a word that is not in the set, whatever its case or spacing', () => {
    for (const [suffix, payload] of [
      ['view/set', 'Month'],
      ['view/set', 'month '],
      ['view/set', 'next_view'],
      ['view/set', ''],
      ['month/set', '2026-13'],
      ['month/set', '2026-1'],
      ['month/set', 'Current'],
      ['month/set', ''],
      ['screen/set', 'ON'],
      ['screen/set', 'true'],
      ['photo_source/set', 'Immich'],
      ['photo_source/set', 'dropbox'],
    ] as const) {
      expect(parseCommandPayload(suffix, payload), `${suffix} ${JSON.stringify(payload)}`).toMatchObject({ ok: false })
    }
  })

  describe('the reason', () => {
    it('names the topic and what was wrong', () => {
      expect(reason('view/set', 'calendar')).toMatch(/^view\/set: Invalid option.* \(got "calendar"\)$/)
      expect(reason('month/set', '2026-13')).toBe('month/set: must be a month like 2026-10 (got "2026-13")')
      expect(reason('overlay/set', 'not json')).toBe('overlay/set: must be JSON like {"text":"Bins out tonight"}, or empty to clear (got "not json")')
    })

    it('quotes at most 60 characters of the payload', () => {
      const payload = 'a'.repeat(500)
      const message = reason('view/set', payload)

      expect(message).toContain(`"${'a'.repeat(60)}…"`)
      expect(message).not.toContain('a'.repeat(61))
    })

    it('keeps a long overlay out of the log', () => {
      const payload = `{"text":"Hi","${'k'.repeat(500)}":1}`
      const message = reason('overlay/set', payload)

      expect(message.length).toBeLessThanOrEqual(250)
      expect(message).not.toContain('k'.repeat(100))
    })

    it('stays on one line, whatever the payload holds', () => {
      const message = reason('view/set', 'line one\nline two\r\u001b[31mred')

      expect(message).not.toContain('\n')
      expect(message).not.toContain('\r')
      expect(message).not.toContain('\u001b')
    })
  })
})

describe('statePayloads', () => {
  const NOW = new Date('2026-10-28T12:00:00Z')

  it('gives every state topic its payload', () => {
    expect(statePayloads(state({ view: 'agenda', screen: 'off', photo_source: 'local', brightness: 80, auto_presence: false }), NOW, 'Europe/London')).toEqual({
      'view/state': 'agenda',
      'month/state': '2026-10',
      'screen/state': 'off',
      'photo_source/state': 'local',
      'brightness/state': '80',
      'auto_presence/state': 'OFF',
      'auto_brightness/state': 'ON',
      'overlay/state': '',
    })
  })

  it('writes brightness as a plain integer, at both ends', () => {
    expect(statePayloads(state({ brightness: 0 }), NOW, 'Europe/London')['brightness/state']).toBe('0')
    expect(statePayloads(state({ brightness: 100 }), NOW, 'Europe/London')['brightness/state']).toBe('100')
  })

  it('writes both policies as ON or OFF', () => {
    const on = statePayloads(state(), NOW, 'Europe/London')
    const off = statePayloads(state({ auto_presence: false, auto_brightness: false }), NOW, 'Europe/London')

    expect([on['auto_presence/state'], on['auto_brightness/state']]).toEqual(['ON', 'ON'])
    expect([off['auto_presence/state'], off['auto_brightness/state']]).toEqual(['OFF', 'OFF'])
  })

  it('shows the overlay\'s text, and nothing when there is no overlay', () => {
    const overlay = { text: 'Bins out tonight', icon: null, until: null }

    expect(statePayloads(state({ overlay }), NOW, 'Europe/London')['overlay/state']).toBe('Bins out tonight')
    expect(statePayloads(state({ overlay: null }), NOW, 'Europe/London')['overlay/state']).toBe('')
  })

  it('shows only the text of an overlay that has an icon and a time to go', () => {
    const overlay = { text: 'Back at 6', icon: 'clock', until: '2026-10-28T13:00:00.000Z' }

    expect(statePayloads(state({ overlay }), NOW, 'Europe/London')['overlay/state']).toBe('Back at 6')
  })

  it('shows the pinned month while one is pinned', () => {
    const pinned = state({ month: '2026-12', month_set_at: NOW.toISOString() })

    expect(statePayloads(pinned, NOW, 'Europe/London')['month/state']).toBe('2026-12')
  })

  it('shows the current month in the display time zone when nothing is pinned', () => {
    // 23:30 on Halloween in London is already 1 November in Auckland, where the process runs.
    const lateOnThe31st = new Date('2026-10-31T23:30:00Z')

    expect(statePayloads(state(), lateOnThe31st, 'Europe/London')['month/state']).toBe('2026-10')
    expect(statePayloads(state(), lateOnThe31st, 'Pacific/Auckland')['month/state']).toBe('2026-11')
  })

  it('rolls over to the new month with the clock, without the state changing', () => {
    const before = new Date('2026-12-31T23:59:59Z')
    const after = new Date('2027-01-01T00:00:00Z')

    expect(statePayloads(state(), before, 'Europe/London')['month/state']).toBe('2026-12')
    expect(statePayloads(state(), after, 'Europe/London')['month/state']).toBe('2027-01')
  })
})

describe('the schedule topics', () => {
  it('names the templates as the contract does, and fills in an id', () => {
    expect(SCHEDULE_SET_TEMPLATE).toBe('schedule/{schedule_id}/set')
    expect(SCHEDULE_STATE_TEMPLATE).toBe('schedule/{schedule_id}/state')
    expect(scheduleTopic('daytime-photos', 'set')).toBe('schedule/daytime-photos/set')
    expect(scheduleTopic('daytime-photos', 'state')).toBe('schedule/daytime-photos/state')
    expect(topicFor('hallway', scheduleTopic('mornings', 'set'))).toBe('wallcal/hallway/schedule/mornings/set')
  })

  it('is not one of the fixed command topics', () => {
    expect(parseCommandTopic('wallcal/hallway/schedule/mornings/set')).toBeNull()
  })
})

describe('parseScheduleTopic', () => {
  it('gives the display id and the schedule id', () => {
    expect(parseScheduleTopic('wallcal/hallway/schedule/mornings/set')).toEqual({ displayId: 'hallway', scheduleId: 'mornings' })
    expect(parseScheduleTopic('wallcal/kitchen/schedule/daytime-photos/set')).toEqual({ displayId: 'kitchen', scheduleId: 'daytime-photos' })
    expect(parseScheduleTopic('wallcal/hallway/schedule/7am/set')).toEqual({ displayId: 'hallway', scheduleId: '7am' })
  })

  it.each([
    'wallcal/hallway/schedule/mornings/state',
    'wallcal/hallway/schedule/mornings',
    'wallcal/hallway/schedule/mornings/set/more',
    'wallcal/hallway/schedule//set',
    'wallcal/hallway/schedule/Mornings/set',
    'wallcal/hallway/schedule/-mornings/set',
    'wallcal/hallway/schedule/morn ings/set',
    'wallcal/hallway/schedule/+/set',
    'wallcal//schedule/mornings/set',
    'wallcal/hallway/schedules/mornings/set',
    'other/hallway/schedule/mornings/set',
    'schedule/mornings/set',
  ])('is null for %s', (topic) => {
    expect(parseScheduleTopic(topic)).toBeNull()
  })
})

describe('parseSchedulePayload', () => {
  it('turns ON and OFF into set_schedule', () => {
    expect(parseSchedulePayload('mornings', 'ON')).toEqual({ ok: true, command: { type: 'set_schedule', schedule: 'mornings', on: true } })
    expect(parseSchedulePayload('daytime-photos', 'OFF')).toEqual({ ok: true, command: { type: 'set_schedule', schedule: 'daytime-photos', on: false } })
  })

  it.each(['on', 'off', 'On', 'true', '1', '', ' ON', 'ON\n', 'toggle'])('rejects %j', (payload) => {
    expect(parseSchedulePayload('mornings', payload)).toMatchObject({ ok: false })
  })

  it('has a reason that names the topic and quotes the payload, cut at 60 characters, on one line', () => {
    const short = parseSchedulePayload('mornings', 'yes')
    const long = parseSchedulePayload('mornings', `${'x'.repeat(80)}\n\u001b[31m`)

    expect(short).toEqual({ ok: false, reason: 'schedule/mornings/set: must be ON or OFF (got "yes")' })
    if (long.ok) throw new Error('accepted')
    expect(long.reason).toBe(`schedule/mornings/set: must be ON or OFF (got "${'x'.repeat(60)}…")`)
    expect(long.reason).not.toContain('\n')
  })
})

describe('schedulePayloads', () => {
  it('gives each configured schedule ON unless it is in schedules_off', () => {
    expect(schedulePayloads(state({ schedules_off: ['daytime-photos'] }), ['mornings', 'daytime-photos'])).toEqual({
      'schedule/mornings/state': 'ON',
      'schedule/daytime-photos/state': 'OFF',
    })
  })

  it('gives nothing for a display without schedules, and leaves out an id that is no longer configured', () => {
    expect(schedulePayloads(state(), [])).toEqual({})
    expect(schedulePayloads(state({ schedules_off: ['gone'] }), ['mornings'])).toEqual({ 'schedule/mornings/state': 'ON' })
  })
})
