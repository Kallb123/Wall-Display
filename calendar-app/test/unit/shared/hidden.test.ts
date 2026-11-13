import { describe, expect, it } from 'vitest'
import { isHiddenEvent } from '../../../shared/hidden'

describe('isHiddenEvent', () => {
  it.each([
    'hide',
    'Hide',
    'HIDE',
    '  hide  ',
    '\thide\t',
    'Who: Theo\nhide',
    'hide\nBring a coat',
    'Bring a coat\n\nhide\n\nThanks',
  ])('hides %j', (description) => {
    expect(isHiddenEvent(description)).toBe(true)
  })

  it.each([
    '<p>hide</p>',
    '<div> Hide </div>',
    'Who: Theo<br>hide',
    'Who: Theo<br/>HIDE<br />',
    '<ul><li>Bring a coat</li><li>hide</li></ul>',
    '<p><b>hide</b></p>',
    'hide&nbsp;',
    '&nbsp;hide',
  ])('hides the HTML description %j', (description) => {
    // A no-break space is not trimmed away by an entity-unaware reader, but is by String.trim.
    expect(isHiddenEvent(description)).toBe(true)
  })

  it('reads CRLF and bare CR line endings', () => {
    expect(isHiddenEvent('Who: Theo\r\nhide\r\n')).toBe(true)
    expect(isHiddenEvent('Who: Theo\rhide')).toBe(true)
  })

  it.each([null, '', '   ', '\n\n'])('does not hide %j', (description) => {
    expect(isHiddenEvent(description)).toBe(false)
  })

  it.each([
    'hide this',
    'hide me',
    "don't hide",
    'do not hide',
    'hidden',
    'hide, please',
    'hide: yes',
    'hi de',
    'h i d e',
    'Who: Theo hide',
    '<p>hide this</p>',
    '&lt;p&gt;hide&lt;/p&gt;',
    'Bring a coat',
  ])('does not hide %j', (description) => {
    expect(isHiddenEvent(description)).toBe(false)
  })
})
