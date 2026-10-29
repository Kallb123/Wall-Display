/**
 * The phone's light or dark setting (`prefers-color-scheme`), kept up to date
 * while the scope lives. Light where the browser can't say. The remote page
 * picks its theme with it (architecture §7.5); the wall never does, as its
 * theme is set per display in config.
 */
export function useColourScheme(): Ref<'light' | 'dark'> {
  const scheme = ref<'light' | 'dark'>('light')
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

  const update = () => {
    scheme.value = query?.matches ? 'dark' : 'light'
  }
  update()
  query?.addEventListener('change', update)
  onScopeDispose(() => query?.removeEventListener('change', update))

  return scheme
}
