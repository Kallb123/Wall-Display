// Keeps the screen awake while the display is open (PR 5.8), so a tablet or
// phone showing the wall doesn't go to sleep. The browser drops the lock when
// the page is hidden, so it is taken again when the page is visible. Where there
// is no Screen Wake Lock API, or the browser refuses (low battery, not allowed),
// nothing happens: the wall still works, the device just sleeps as usual.

interface WakeLockHandle {
  release: () => Promise<void>
}
type WakeLockApi = { request: (type: 'screen') => Promise<WakeLockHandle> }

export function useWakeLock() {
  let lock: WakeLockHandle | null = null
  let active = false

  async function acquire() {
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
    if (!active || !api || lock) return
    try {
      const taken = await api.request('screen')
      // Unmounted while the request was out: don't hold on to it.
      if (!active) {
        await taken.release().catch(() => {})
        return
      }
      lock = taken
    } catch {
      // Refused: carry on without it.
    }
  }

  function onVisibility() {
    // A hidden page's lock is already gone; forget it so a visible page asks again.
    if (document.visibilityState === 'visible') {
      lock = null
      void acquire()
    }
  }

  onMounted(() => {
    active = true
    document.addEventListener('visibilitychange', onVisibility)
    void acquire()
  })

  onBeforeUnmount(() => {
    active = false
    document.removeEventListener('visibilitychange', onVisibility)
    const held = lock
    lock = null
    void held?.release().catch(() => {})
  })
}
