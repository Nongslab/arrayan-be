/**
 * Data demo untuk presentasi klien & pengembangan FE — HANYA dev.
 *
 *   npm run seed:demo           # buat ulang data demo (hapus demo lama dulu)
 *   npm run seed:demo -- --clear  # hanya hapus data demo
 *
 * Prasyarat: master data & role sudah ada (`npm run prisma:seed`).
 */
import { PrismaClient } from '@prisma/client'
import { todayInJakarta } from '../../src/modules/employee/employee.schema.js'
import { DEMO_PASSWORD } from './plan.js'
import { clearDemo, seedDemo } from './seeder.js'

if (process.env.NODE_ENV === 'production') {
  console.error('❌ seed:demo ditolak: NODE_ENV=production. Data demo hanya untuk lingkungan dev.')
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  if (process.argv.includes('--clear')) {
    const removed = await prisma.$transaction((tx) => clearDemo(tx), { timeout: 60_000 })
    console.log(`🧹 Data demo dihapus (${removed} karyawan beserta absensi, cuti, training & event demo).`)
    return
  }

  const today = todayInJakarta()
  const { removed, summary, plan } = await seedDemo(prisma, { today })
  const login = plan.employees.filter((e) => e.email && e.account === 'ACTIVE')
  const sample = (key: string) => login.find((e) => e.key === key)

  console.log(`🌱 Data demo per ${today}${removed ? ` (menggantikan ${removed} karyawan demo lama)` : ''}`)
  console.table(summary)
  console.log('Akun demo (password sama untuk semua):', DEMO_PASSWORD)
  console.table(
    ['HR_MGR', 'DIR', 'ENG_SM', 'ENG_MGR', 'ENG_SPV', 'ENG_S1']
      .map(sample)
      .filter((e) => e !== undefined)
      .map((e) => ({ nama: e.fullName, email: e.email, role: e.role })),
  )
  console.log(`Total ${login.length} akun aktif — lihat semua via GET /api/employees (login sebagai HR).`)
}

main()
  .catch((e) => {
    console.error('❌ seed:demo gagal:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
