// Emoji checks for calendar icons and event titles. Pure: no DOM, no Vue.

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// `\p{Emoji}` alone matches digits, # and *, so it isn't used. Pictographs cover
// most emoji (and ZWJ sequences and skin tones, which are one grapheme with a
// pictograph in it); flags are two regional indicators; keycaps are a digit,
// # or * with an optional variation selector and the combining keycap.
const PICTOGRAPH = /\p{Extended_Pictographic}/u
const FLAG = /^\p{Regional_Indicator}{2}$/u
const KEYCAP = /^[0-9#*]\uFE0F?\u20E3$/u

function isEmojiGrapheme(grapheme: string): boolean {
  return PICTOGRAPH.test(grapheme) || FLAG.test(grapheme) || KEYCAP.test(grapheme)
}

/** Whether the text is exactly one emoji: one grapheme, and an emoji. */
export function isSingleEmoji(value: string): boolean {
  const graphemes = [...segmenter.segment(value)]
  return graphemes.length === 1 && isEmojiGrapheme(graphemes[0]!.segment)
}

/** Whether the text, after any leading whitespace, starts with an emoji. */
export function startsWithEmoji(text: string): boolean {
  const first = segmenter.segment(text.trimStart())[Symbol.iterator]().next()
  return !first.done && isEmojiGrapheme(first.value.segment)
}
