import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT, BUILT_OUTPUT } from '../helpers/builtApp'

// Builds the app once for all the e2e tests (see test/helpers/builtApp.ts).
// Vitest runs this before the first e2e test file, and not at all when no e2e
// test is in the run. CI builds the app in a step of its own just before, and
// sets WALLCAL_E2E_PREBUILT so the build is not made twice.
export default function setup() {
  const server = join(BUILT_OUTPUT, 'server', 'index.mjs')
  if (process.env.WALLCAL_E2E_PREBUILT) {
    if (!existsSync(server)) throw new Error(`WALLCAL_E2E_PREBUILT is set but ${server} is not there. Run "pnpm build" first.`)
    return
  }
  execFileSync('pnpm', ['exec', 'nuxt', 'build'], { cwd: APP_ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
