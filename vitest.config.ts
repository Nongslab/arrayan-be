import { defineConfig } from 'vitest/config'

// Unit tests — tanpa database. Integration test (*.int.test.ts) dijalankan via vitest.int.config.ts.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**', '**/*.int.test.ts'],
  },
})
