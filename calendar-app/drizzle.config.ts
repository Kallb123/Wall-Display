import { defineConfig } from 'drizzle-kit'

// Used by `pnpm db:generate` only. The app applies the generated migrations itself, at boot.
export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
})
