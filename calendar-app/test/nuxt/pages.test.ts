import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import RemotePage from '~/pages/remote.vue'
import SettingsPage from '~/pages/settings/index.vue'

// The display page is no longer a stub: see display.test.ts and the Playwright tests.
describe('stub pages', () => {
  it.each([
    ['remote', RemotePage, 'Remote'],
    ['settings', SettingsPage, 'Settings'],
  ])('%s renders its heading', async (_name, page, heading) => {
    const wrapper = await mountSuspended(page)

    expect(wrapper.find('h1').text()).toBe(heading)
  })
})
