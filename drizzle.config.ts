import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './electron/main/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true
})
