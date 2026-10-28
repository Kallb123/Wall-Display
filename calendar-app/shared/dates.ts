// Calendar dates as `YYYY-MM-DD` strings in the display's time zone. The
// arithmetic is on UTC dates, never the process's local time, so the answer is
// the same wherever the code runs. Pure: no Nuxt or Vue imports, so the display,
// the remote and the server can all use it.

/** `date` moved by `days` (negative for earlier). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10)
}

/** The day of the week of `date`, from 0 (Sunday) to 6 (Saturday). */
export function dayOfWeek(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** Today's date on a wall in `timeZone`. */
export function todayIn(now: Date, timeZone: string): string {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' })
    formatters.set(timeZone, formatter)
  }
  const fields: Record<string, string> = {}
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== 'literal') fields[part.type] = part.value
  }
  return `${fields.year}-${fields.month}-${fields.day}`
}
