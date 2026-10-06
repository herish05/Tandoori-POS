import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'electron/shared'),
      '@main': resolve(__dirname, 'electron/main'),
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    pool: 'forks',
    restoreMocks: true
  }
})
