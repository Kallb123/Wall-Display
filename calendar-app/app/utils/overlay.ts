import type { Component } from 'vue'
import {
  Bell, Cake, Calendar, Car, Clock, Gift, Heart, House, Info, Key, MessageCircle, Package, PartyPopper,
  PawPrint, Phone, Plane, School, ShoppingCart, Star, Sun, Trash2, TriangleAlert, Umbrella, Utensils,
} from 'lucide-vue-next'
import type { Overlay } from '../../shared/display'
import { addDays, todayIn } from '../../shared/dates'
import { formatLongDate, formatTime } from '../../shared/format'

// What the overlay banner and the remote's Message section need to know about
// an overlay (architecture §7.1). The icons are imported one by one so the
// bundle holds these and not all of Lucide. Pure: no Nuxt imports.

/** The icons a message can name, by the names the remote and the API use. */
const ICONS = {
  trash: Trash2,
  bell: Bell,
  info: Info,
  alert: TriangleAlert,
  heart: Heart,
  gift: Gift,
  cake: Cake,
  car: Car,
  utensils: Utensils,
  cart: ShoppingCart,
  sun: Sun,
  umbrella: Umbrella,
  package: Package,
  home: House,
  party: PartyPopper,
  star: Star,
  calendar: Calendar,
  clock: Clock,
  school: School,
  plane: Plane,
  paw: PawPrint,
  phone: Phone,
  key: Key,
} as const satisfies Record<string, Component>

export type OverlayIconName = keyof typeof ICONS

/** What a message with no icon, or one we don't know, gets. */
const DEFAULT_ICON: Component = MessageCircle

// The other names people reach for, mostly Home Assistant's (`mdi:` icons), mapped to ours.
const ALIASES: Record<string, OverlayIconName> = {
  'bin': 'trash',
  'bins': 'trash',
  'trash-can': 'trash',
  'delete': 'trash',
  'garbage': 'trash',
  'rubbish': 'trash',
  'bell-ring': 'bell',
  'alarm': 'bell',
  'information': 'info',
  'warning': 'alert',
  'alert-circle': 'alert',
  'alert-triangle': 'alert',
  'triangle-alert': 'alert',
  'heart-outline': 'heart',
  'present': 'gift',
  'birthday': 'cake',
  'cake-variant': 'cake',
  'birthday-cake': 'cake',
  'food': 'utensils',
  'dinner': 'utensils',
  'silverware-fork-knife': 'utensils',
  'silverware': 'utensils',
  'shopping': 'cart',
  'shopping-cart': 'cart',
  'cart-outline': 'cart',
  'parcel': 'package',
  'delivery': 'package',
  'box': 'package',
  'house': 'home',
  'party-popper': 'party',
  'celebrate': 'party',
  'weather-sunny': 'sun',
  'sunny': 'sun',
  'rain': 'umbrella',
  'weather-rainy': 'umbrella',
  'airplane': 'plane',
  'holiday': 'plane',
  'pet': 'paw',
  'dog': 'paw',
  'cat': 'paw',
  'paw-print': 'paw',
  'telephone': 'phone',
  'call': 'phone',
  'key-round': 'key',
  'bus': 'car',
  'school-run': 'school',
  'calendar-today': 'calendar',
  'clock-outline': 'clock',
  'time': 'clock',
}

/** A name as written (`mdi:Trash-Can`, `Bins`) as the plain key to look up. */
function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/^(mdi|lucide):/, '').replace(/[\s_]+/g, '-')
}

/** The icon for a name: ours, an alias of ours (case, prefix and spelling aside), or the default message icon. */
export function overlayIcon(name: string | null): Component {
  if (name === null) return DEFAULT_ICON
  const key = normalise(name)
  // Home Assistant's `-outline` variants are the same picture for our purposes.
  for (const candidate of [key, key.replace(/-outline$/, '')]) {
    if (Object.hasOwn(ICONS, candidate)) return ICONS[candidate as OverlayIconName]
    const alias = ALIASES[candidate]
    if (alias && Object.hasOwn(ICONS, alias)) return ICONS[alias]
  }
  return DEFAULT_ICON
}

/** What the remote's picker offers, in order. "No icon" (the default message icon) is added by the page. */
export const OVERLAY_ICON_CHOICES: { name: OverlayIconName, label: string }[] = [
  { name: 'trash', label: 'Bins' },
  { name: 'bell', label: 'Reminder' },
  { name: 'utensils', label: 'Food' },
  { name: 'cart', label: 'Shopping' },
  { name: 'car', label: 'Car' },
  { name: 'package', label: 'Parcel' },
  { name: 'cake', label: 'Birthday' },
  { name: 'gift', label: 'Gift' },
  { name: 'alert', label: 'Warning' },
]

/** How long a message from the remote stays: `ttl` is in seconds, or left out for "until cleared". */
export interface OverlayDuration { key: string, label: string, ttl: number | undefined }

export const OVERLAY_DURATIONS: OverlayDuration[] = [
  { key: '30m', label: '30 minutes', ttl: 30 * 60 },
  { key: '1h', label: '1 hour', ttl: 60 * 60 },
  { key: '3h', label: '3 hours', ttl: 3 * 60 * 60 },
  { key: '12h', label: '12 hours', ttl: 12 * 60 * 60 },
  { key: '1d', label: '1 day', ttl: 24 * 60 * 60 },
  { key: 'cleared', label: 'Until cleared', ttl: undefined },
]

/** What the remote's duration starts on. */
export const DEFAULT_OVERLAY_DURATION = '1h'

// The server drops an overlay at `until` and tells the display, but a wall
// running from its cache (or one whose socket has lagged) must not keep a
// stale banner up, so the page asks too.
/** Whether the overlay should be on the wall at `now`: there is one, and its time has not come. */
export function isOverlayShowing(overlay: Overlay | null, now: Date): boolean {
  if (!overlay) return false
  if (overlay.until === null) return true
  return Date.parse(overlay.until) > now.getTime()
}

/** When it ends, for the remote: `Until 14:30`, `Until tomorrow, 14:30`, or `Until cleared`. Times are in the display's zone. */
export function overlayEndLabel(overlay: Overlay, now: Date, timeZone: string): string {
  if (overlay.until === null) return 'Until cleared'
  const until = new Date(overlay.until)
  const time = formatTime(until, timeZone)
  const today = todayIn(now, timeZone)
  const day = todayIn(until, timeZone)
  if (day <= today) return `Until ${time}`
  if (day === addDays(today, 1)) return `Until tomorrow, ${time}`
  return `Until ${formatLongDate(until, timeZone)}, ${time}`
}
