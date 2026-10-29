import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SettingsPage from '~/pages/settings/index.vue'

// The display and remote pages are no longer stubs: see display.test.ts, remote.test.ts and the Playwright tests.
describe('stub pages', () => {
  it.each([
    ['settings', SettingsPage, 'Settings'],
  ])('%s renders its heading', async (_name, page, heading) => {
    const wrapper = await mountSuspended(page)

    expect(wrapper.find('h1').text()).toBe(heading)
  })
})
