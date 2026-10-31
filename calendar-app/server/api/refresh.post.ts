// Forces an immediate sync of every calendar and answers when all have finished.
// The weather and the next alarm are fetched again at the same time, but they are not part of the answer.
// Each result carries only the safe error message, never a feed URL.
// With `remote.pin` set the request needs it in the `x-wallcal-pin` header (401 without it, 429 after too many wrong tries); the PIN middleware checks that first.
export default defineEventHandler(async () => {
  const [calendars] = await Promise.all([useSyncScheduler().refreshAll(), useWeather()?.refresh(), useAlarm()?.refresh()])
  return { calendars }
})
