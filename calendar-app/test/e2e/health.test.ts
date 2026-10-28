import { describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'

describe('GET /api/health', async () => {
  await setup({ browser: false })

  it('reports ok with a numeric uptime', async () => {
    const body = await $fetch<{ status: string, uptime: number }>('/api/health')

    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })
})
