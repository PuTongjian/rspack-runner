import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.mjs'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
  },
})
