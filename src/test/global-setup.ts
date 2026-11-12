import 'dotenv/config'
import { execSync } from 'node:child_process'

/**
 * Menyiapkan database integration test: migrate deploy + seed (idempotent).
 * Menolak berjalan bila TEST_DATABASE_URL kosong atau nama DB tidak mengandung "test",
 * agar DB development/production tidak pernah tersentuh.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error('TEST_DATABASE_URL wajib diisi untuk integration test. Lihat .env.example.')
  }

  const dbName = new URL(url).pathname.replace(/^\//, '')
  if (!dbName.includes('test')) {
    throw new Error(`TEST_DATABASE_URL harus menunjuk DB khusus test (nama mengandung "test"), didapat "${dbName}".`)
  }

  const env = { ...process.env, DATABASE_URL: url }
  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' })
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'inherit' })
}
