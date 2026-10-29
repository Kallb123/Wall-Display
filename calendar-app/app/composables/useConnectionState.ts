import { connectionState } from '~/utils/remote'
import type { ConnectionState } from '~/utils/remote'
import type { SocketStatus } from '~/composables/useDisplaySocket'

/**
 * What the remote's connection pill says (`connectionState` makes the call).
 * This keeps the time the socket has been down, ticking once a second only
 * while it is, and whether the phone says it has a network. Like
 * OfflineBadge, a normal page load never flashes Offline: the first connection
 * is Reconnecting until `OFFLINE_AFTER_MS` has passed.
 */
export function useConnectionState(status: MaybeRefOrGetter<SocketStatus>): Ref<ConnectionState> {
  const open = computed(() => toValue(status) === 'open')
  const online = ref(true)
  const notOpenMs = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined

  // Connecting and closed count the same: the clock runs until the socket is open again.
  watch(open, (isOpen) => {
    clearInterval(timer)
    timer = undefined
    notOpenMs.value = 0
    if (isOpen) return
    const since = Date.now()
    timer = setInterval(() => {
      notOpenMs.value = Date.now() - since
    }, 1000)
  }, { immediate: true })

  const update = () => {
    online.value = navigator.onLine
  }
  onMounted(() => {
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
  })
  onScopeDispose(() => {
    clearInterval(timer)
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })

  return computed(() => connectionState({ open: open.value, online: online.value, notOpenMs: notOpenMs.value }))
}
