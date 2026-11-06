/** The size of the window, kept up to date as it is resized. */
export function useViewport(): Ref<{ width: number, height: number }> {
  const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
  const update = () => {
    viewport.value = { width: window.innerWidth, height: window.innerHeight }
  }
  window.addEventListener('resize', update)
  onScopeDispose(() => window.removeEventListener('resize', update))
  return viewport
}
