/** The current time, updated every `intervalMs` (a second by default) while the component lives. */
export function useNow(intervalMs = 1000): Ref<Date> {
  const now = ref(new Date())
  const timer = setInterval(() => {
    now.value = new Date()
  }, intervalMs)
  onScopeDispose(() => clearInterval(timer))
  return now
}
