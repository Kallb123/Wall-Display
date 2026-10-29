import { describe, expect, it } from 'vitest'
import { Bell, Cake, MessageCircle, Package, PawPrint, ShoppingCart, Trash2, TriangleAlert, Umbrella, Utensils } from 'lucide-vue-next'
import { MAX_OVERLAY_TTL_SECONDS, commandSchema } from '../../../shared/display'
import {
  DEFAULT_OVERLAY_DURATION,
  OVERLAY_DURATIONS,
  OVERLAY_ICON_CHOICES,
  isOverlayShowing,
  overlayEndLabel,
  overlayIcon,
} from '../../../app/utils/overlay'

describe('overlayIcon', () => {
  it('finds an icon by its own name', () => {
    expect(overlayIcon('trash')).toBe(Trash2)
    expect(overlayIcon('bell')).toBe(Bell)
    expect(overlayIcon('cart')).toBe(ShoppingCart)
  })

  it('ignores case and spaces', () => {
    expect(overlayIcon('Trash')).toBe(Trash2)
    expect(overlayIcon('  BELL ')).toBe(Bell)
  })

  it('drops an mdi: or lucide: prefix', () => {
    expect(overlayIcon('mdi:bell')).toBe(Bell)
    expect(overlayIcon('lucide:bell')).toBe(Bell)
    expect(overlayIcon('MDI:Trash-Can')).toBe(Trash2)
  })

  it('knows the names people guess', () => {
    expect(overlayIcon('bins')).toBe(Trash2)
    expect(overlayIcon('delete')).toBe(Trash2)
    expect(overlayIcon('mdi:trash-can-outline')).toBe(Trash2)
    expect(overlayIcon('warning')).toBe(TriangleAlert)
    expect(overlayIcon('alert-circle')).toBe(TriangleAlert)
    expect(overlayIcon('mdi:cake-variant')).toBe(Cake)
    expect(overlayIcon('birthday')).toBe(Cake)
    expect(overlayIcon('mdi:silverware-fork-knife')).toBe(Utensils)
    expect(overlayIcon('dinner')).toBe(Utensils)
    expect(overlayIcon('shopping_cart')).toBe(ShoppingCart)
    expect(overlayIcon('parcel')).toBe(Package)
    expect(overlayIcon('mdi:weather-rainy')).toBe(Umbrella)
    expect(overlayIcon('dog')).toBe(PawPrint)
  })

  it('is the plain message icon for null, an empty name or one it does not know', () => {
    expect(overlayIcon(null)).toBe(MessageCircle)
    expect(overlayIcon('')).toBe(MessageCircle)
    expect(overlayIcon('mdi:flux-capacitor')).toBe(MessageCircle)
  })

  it('does not mistake an object property for an icon', () => {
    expect(overlayIcon('constructor')).toBe(MessageCircle)
    expect(overlayIcon('__proto__')).toBe(MessageCircle)
  })
})

describe('OVERLAY_ICON_CHOICES', () => {
  it('is a short list of icons the wall knows, each with a label', () => {
    expect(OVERLAY_ICON_CHOICES.length).toBeGreaterThanOrEqual(6)
    expect(OVERLAY_ICON_CHOICES.length).toBeLessThanOrEqual(10)
    for (const { name, label } of OVERLAY_ICON_CHOICES) {
      expect(overlayIcon(name)).not.toBe(MessageCircle)
      expect(label).not.toBe('')
    }
    expect(new Set(OVERLAY_ICON_CHOICES.map(choice => choice.name)).size).toBe(OVERLAY_ICON_CHOICES.length)
  })
})

describe('isOverlayShowing', () => {
  const now = new Date('2026-10-28T09:41:00Z')
  const overlay = (until: string | null) => ({ text: 'Bins out', icon: null, until })

  it('is false when there is no overlay', () => {
    expect(isOverlayShowing(null, now)).toBe(false)
  })

  it('is true until its time, and false from that moment on', () => {
    expect(isOverlayShowing(overlay('2026-10-28T09:41:01Z'), now)).toBe(true)
    expect(isOverlayShowing(overlay('2026-10-28T09:41:00Z'), now)).toBe(false)
    expect(isOverlayShowing(overlay('2026-10-28T09:40:59Z'), now)).toBe(false)
  })

  it('is true with no end time', () => {
    expect(isOverlayShowing(overlay(null), now)).toBe(true)
  })
})

describe('overlayEndLabel', () => {
  const now = new Date('2026-10-28T09:41:00Z')
  const until = (value: string | null) => ({ text: 'Bins out', icon: null, until: value })

  it('says it stays until cleared', () => {
    expect(overlayEndLabel(until(null), now, 'Europe/London')).toBe('Until cleared')
  })

  it('gives the time in the display zone, 24-hour', () => {
    expect(overlayEndLabel(until('2026-10-28T14:30:00Z'), now, 'Europe/London')).toBe('Until 14:30')
    expect(overlayEndLabel(until('2026-10-28T14:30:00Z'), now, 'Asia/Tokyo')).toBe('Until 23:30')
  })

  it('names the day when it is not today there', () => {
    expect(overlayEndLabel(until('2026-10-29T08:00:00Z'), now, 'Europe/London')).toBe('Until tomorrow, 08:00')
    expect(overlayEndLabel(until('2026-11-04T18:15:00Z'), now, 'Europe/London')).toBe('Until Wednesday 4 November, 18:15')
  })
})

describe('OVERLAY_DURATIONS', () => {
  it('stay within what the server accepts', () => {
    for (const { ttl } of OVERLAY_DURATIONS) {
      if (ttl === undefined) continue
      expect(ttl).toBeGreaterThanOrEqual(1)
      expect(ttl).toBeLessThanOrEqual(MAX_OVERLAY_TTL_SECONDS)
      expect(commandSchema.safeParse({ type: 'set_overlay', overlay: { text: 'x', ttl } }).success).toBe(true)
    }
  })

  it('run from 30 minutes to until cleared, with one hour the default', () => {
    expect(OVERLAY_DURATIONS.map(duration => duration.label)).toEqual(['30 minutes', '1 hour', '3 hours', '12 hours', '1 day', 'Until cleared'])
    expect(OVERLAY_DURATIONS.at(-1)!.ttl).toBeUndefined()
    expect(OVERLAY_DURATIONS.find(duration => duration.key === DEFAULT_OVERLAY_DURATION)!.ttl).toBe(3600)
    expect(new Set(OVERLAY_DURATIONS.map(duration => duration.key)).size).toBe(OVERLAY_DURATIONS.length)
  })
})
