import { defineConfig } from '@playwright/test'

// The visual tests for /display (test/visual). They run against the built
// server, so run `pnpm build` first. The Playwright version is pinned in
// package.json so the Chromium here, and in CI, renders the same pixels as the
// one the baselines in test/visual/*-snapshots were made with.
const PORT = 3999

export default defineConfig({
  testDir: 'test/visual',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // The stage is 2560×1440, so that is the window it is judged in.
    viewport: { width: 2560, height: 1440 },
    deviceScaleFactor: 1,
    timezoneId: 'Europe/London',
    locale: 'en-GB',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // A fresh database each run, so nothing carries over between runs.
    command: 'rm -rf .data/visual && node .output/server/index.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      WALLCAL_CONFIG_FILE: 'test/visual/config.visual.yaml',
      WALLCAL_DATA_DIR: '.data/visual',
    },
  },
})
