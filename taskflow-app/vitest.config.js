import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      reporter: ['text', 'lcov'],
      exclude: ['node_modules/', 'src/tracing.js'],
    },
  },
})
