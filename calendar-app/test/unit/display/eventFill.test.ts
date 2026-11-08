import { describe, expect, it } from 'vitest'
import { eventFill } from '../../../app/utils/eventFill'
import { MAX_BADGE_INITIALS } from '../../../shared/month-layout'
import { personFill } from '../../../app/utils/themes'

const colours = ['#C67139', '#3A7CA5', '#6B9E50', '#B04A8F']
const people = colours.map(colour => ({ colour }))

describe('eventFill', () => {
  it('is the surface colour with nobody on the event', () => {
    expect(eventFill([])).toEqual({ background: 'var(--surface)', ring: 'var(--surface)' })
  })

  it('is one person\'s fill, as it always was, for one person', () => {
    expect(eventFill(people.slice(0, 1))).toEqual({ background: personFill(colours[0]!), ring: personFill(colours[0]!) })
  })

  it('splits two people into halves, left to right, and rings in the first', () => {
    const [a, b] = colours.map(personFill)
    expect(eventFill(people.slice(0, 2))).toEqual({
      background: `linear-gradient(to right, ${a} 0% 50%, ${b} 50% 100%)`,
      ring: a,
    })
  })

  it('splits three into equal thirds', () => {
    const [a, b, c] = colours.map(personFill)
    expect(eventFill(people.slice(0, 3)).background).toBe(`linear-gradient(to right, ${a} 0% 33.33%, ${b} 33.33% 66.67%, ${c} 66.67% 100%)`)
  })

  it('keeps to the people the badges show', () => {
    const { background } = eventFill(people)
    expect(MAX_BADGE_INITIALS).toBe(3)
    expect(background).toContain(personFill(colours[2]!))
    expect(background).not.toContain(personFill(colours[3]!))
  })
})
