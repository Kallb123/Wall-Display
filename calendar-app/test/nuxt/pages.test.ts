import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DisplayPage from '~/pages/display.vue'
import RemotePage from '~/pages/remote.vue'
import SettingsPage from '~/pages/settings/index.vue'

describe('stub pages', () => {
  it.each([
    ['display', DisplayPage, 'Display'],
    ['remote', RemotePage, 'Remote'],
    ['settings', SettingsPage, 'Settings'],
  ])('%s renders its heading', async (_name, page, heading) => {
    const wrapper = await mountSuspended(page)

    expect(wrapper.find('h1').text()).toBe(heading)
  })
})
