// How long the display waits before reconnecting its socket. Pure: no Nuxt or Vue imports.

const BASE_MS = 1000
const MAX_MS = 30_000
/** Up to this fraction either side, so displays that lost the server together don't all return together. */
const JITTER = 0.2

/**
 * The wait before reconnect attempt number `attempt` (0 for the first): 1 s,
 * 2 s, 4 s and so on, up to 30 s, give or take 20 %. `random` is for tests.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const delay = Math.min(BASE_MS * 2 ** Math.max(0, attempt), MAX_MS)
  return Math.round(delay * (1 + (random() * 2 - 1) * JITTER))
}
