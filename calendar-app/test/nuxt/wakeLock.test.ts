import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { useWakeLock } from '~/composables/useWakeLock'

// The screen wake lock (PR 5.8): taken on mount, taken again when the page
// becomes visible, released on unmount, and harmless where there is none.

const Holder = defineComponent({
  setup() {
    useWakeLock()
    return () => null
  },
})

function fakeWakeLock() {
  const sentinels: { release: ReturnType<typeof vi.fn> }[] = []
  const request = vi.fn(async () => {
    const sentinel = { release: vi.fn(async () => {}) }
    sentinels.push(sentinel)
    return sentinel
  })
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
  return { request, sentinels }
}

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useWakeLock', () => {
  beforeEach(() => setVisibility('visible'))
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'wakeLock')
  })

  it('asks for the screen lock on mount, asks again when the page is visible again, and releases on unmount', async () => {
    const { request, sentinels } = fakeWakeLock()
    const wrapper = await mountSuspended(Holder)
    await flushPromises()
    expect(request).toHaveBeenCalledWith('screen')
    expect(request).toHaveBeenCalledTimes(1)

    // The browser drops the lock while the page is hidden.
    setVisibility('hidden')
    setVisibility('visible')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    await flushPromises()
    expect(sentinels[1]!.release).toHaveBeenCalledTimes(1)

    // Nothing is asked for once it is gone.
    setVisibility('hidden')
    setVisibility('visible')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does nothing where there is no wake lock API', async () => {
    const wrapper = await mountSuspended(Holder)
    setVisibility('visible')
    await flushPromises()
    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('carries on when the browser refuses the lock', async () => {
    const request = vi.fn(async () => {
      throw new DOMException('Not allowed', 'NotAllowedError')
    })
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })

    const wrapper = await mountSuspended(Holder)
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
    expect(() => wrapper.unmount()).not.toThrow()
  })
})
