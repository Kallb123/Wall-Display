import { describe, expect, it } from 'vitest'
import { isSingleEmoji, startsWithEmoji } from '../../../shared/emoji'

describe('isSingleEmoji', () => {
  it.each([
    ['a picture', '🍽️'],
    ['a picture without a variation selector', '🏊'],
    ['a ZWJ sequence', '👨‍👩‍👧'],
    ['a flag', '🇬🇧'],
    ['a skin tone', '👍🏽'],
    ['a keycap', '1️⃣'],
    ['a heart', '❤️'],
  ])('accepts %s', (_, value) => {
    expect(isSingleEmoji(value)).toBe(true)
  })

  it.each([
    ['a letter', 'a'],
    ['two letters', 'ab'],
    ['two emoji', '🍽️🍽️'],
    ['an emoji and a letter', '🍽️a'],
    ['an empty string', ''],
    ['a space', ' '],
    ['a digit', '1'],
    ['a hash', '#'],
    ['a star', '*'],
    ['half a flag', '🇬'],
  ])('rejects %s', (_, value) => {
    expect(isSingleEmoji(value)).toBe(false)
  })
})

describe('startsWithEmoji', () => {
  it.each(['🍽️ Dinner', '🇬🇧 Match', '1️⃣ First', '🍽️Dinner', '  🏊 Swim', '\n👍🏽 Fine'])('is true for "%s"', (text) => {
    expect(startsWithEmoji(text)).toBe(true)
  })

  it.each(['Dinner', '1 Dinner', '# Tag', 'Dinner 🍽️', '', '   '])('is false for "%s"', (text) => {
    expect(startsWithEmoji(text)).toBe(false)
  })
})
