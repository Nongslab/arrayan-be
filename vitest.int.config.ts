import 'dotenv/config'
import { defineConfig } from 'vitest/config'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

// Integration tests — butuh PostgreSQL. Selalu memakai TEST_DATABASE_URL (bukan DB dev).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {}),
      NODE_ENV: 'test',
    },
  },
})
