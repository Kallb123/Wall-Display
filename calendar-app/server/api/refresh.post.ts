// Forces an immediate sync of every calendar and answers when all have finished.
// Each result carries only the safe error message, never a feed URL.
// The remote's PIN check arrives in PR 1.8; until then anyone on the network can call this.
export default defineEventHandler(async () => {
  return { calendars: await useSyncScheduler().refreshAll() }
})
