import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'

describe('GET /api/health', async () => {
  // A production build reads /config/config.yaml and /data by default, so point
  // it at the dev config and a throwaway data folder.
  const dataDir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: fileURLToPath(new URL('../../config.dev.yaml', import.meta.url)),
      WALLCAL_DATA_DIR: dataDir,
    },
  })

  it('reports ok with a numeric uptime and a working database', async () => {
    const body = await $fetch<{ status: string, uptime: number, db: string }>('/api/health')

    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(body.uptime).toBeGreaterThanOrEqual(0)
    expect(body.db).toBe('ok')
  })

  it('creates the database in the data folder', () => {
    expect(existsSync(join(dataDir, 'wallcal.db'))).toBe(true)
  })
})
