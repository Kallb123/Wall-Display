import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'

describe('GET /api/health', async () => {
  // A production build reads /config/config.yaml by default, so point it at the dev config.
  await setup({
    browser: false,
    env: { WALLCAL_CONFIG_FILE: fileURLToPath(new URL('../../config.dev.yaml', import.meta.url)) },
  })

  it('reports ok with a numeric uptime', async () => {
    const body = await $fetch<{ status: string, uptime: number }>('/api/health')

    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })
})
