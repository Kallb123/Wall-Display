// How the wall writes times and dates: British English, 24-hour, in the
// display's time zone (not the browser's). Pure: no Nuxt or Vue imports, so the
// layout code in shared/ can use it too.

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(kind: 'time' | 'date', timeZone: string): Intl.DateTimeFormat {
  const key = `${kind}|${timeZone}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = kind === 'time'
      ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      : new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long' })
    formatters.set(key, formatter)
  }
  return formatter
}

/** `09:41`. */
export function formatTime(date: Date, timeZone: string): string {
  return formatterFor('time', timeZone).format(date)
}

/** `Wednesday 28 October`. */
export function formatLongDate(date: Date, timeZone: string): string {
  return formatterFor('date', timeZone).format(date)
}
