import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'

// With no `photos` block, or one whose folder is not there (as in the Docker CI
// job, which copies only config.dev.yaml), the app starts and the photo
// routes answer that there is nothing to show.
describe.each([
  ['no photos block', (config: string) => config.slice(0, config.indexOf('\n# Photo frame mode'))],
  ['a photos folder that does not exist', (config: string) => config],
])('with %s', async (_name, change) => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  // The photos path stays relative, so it is looked for beside this temporary config file, where there is nothing.
  writeFileSync(configFile, change(readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)))

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  it('starts', async () => {
    expect((await $fetch<{ status: string }>('/api/health')).status).toBe('ok')
  })

  it('has no photo to give', async () => {
    expect(await $fetch('/api/photos/next?display=hallway')).toEqual({ photo: null })
    // Asked again, and after the first listing has had time to fail.
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(await $fetch('/api/photos/next?display=hallway')).toEqual({ photo: null })
  })

  it('still checks the display', async () => {
    expect((await fetch('/api/photos/next')).status).toBe(400)
    expect((await fetch('/api/photos/next?display=attic')).status).toBe(404)
  })

  it('serves no photo', async () => {
    expect((await fetch(`/photos/${'0'.repeat(64)}.webp`)).status).toBe(404)
  })
})
