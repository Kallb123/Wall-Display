import { fileURLToPath } from 'node:url'

// The e2e tests (test/e2e) all run against one production build, `.output`,
// which test/e2e/globalSetup.ts makes once before any of them starts. Left to
// itself `setup()` from @nuxt/test-utils builds the app again for every
// `describe` that calls it, some twenty times over, and with several of those
// builds running side by side a slow machine took minutes and now and then ran
// past the setup's time limit.

/** The app's folder, calendar-app. */
export const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Where `nuxt build` puts the server the tests start. */
export const BUILT_OUTPUT = fileURLToPath(new URL('../../.output', import.meta.url))

/**
 * What every e2e `setup()` starts with: no browser, and the server from the
 * build that is already there and not a build of its own. Spread it first and
 * add the test's `env`.
 */
export const builtApp = {
  browser: false,
  build: false,
  nuxtConfig: { nitro: { output: { dir: BUILT_OUTPUT } } },
} as const
