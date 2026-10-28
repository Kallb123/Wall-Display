import { cpSync } from 'node:fs'
import { join } from 'node:path'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-28',
  ssr: false,
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/test-utils/module'],
  typescript: {
    strict: true,
    typeCheck: false,
  },
  nitro: {
    preset: 'node-server',
    hooks: {
      // The SQL migrations are read from disk at boot, so ship them with the
      // bundle: .output/server/db/migrations (see server/db/paths.ts).
      compiled(nitro) {
        cpSync(
          join(nitro.options.rootDir, 'server', 'db', 'migrations'),
          join(nitro.options.output.serverDir, 'db', 'migrations'),
          { recursive: true },
        )
      },
    },
  },
})
