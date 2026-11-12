import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import {
  DEPARTMENTS,
  JOB_TITLES,
  OFFICE_LOCATIONS,
  WORK_SHIFTS,
  LEAVE_TYPES,
  HOLIDAYS,
  TRAINING_CATEGORIES,
  KPI_TEMPLATES,
  SUPER_ADMIN_ASSIGNMENT,
} from './seed-data/master.js'

const prisma = new PrismaClient()

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

/**
 * Timpa master data yang sudah ada dengan nilai seed?
 * - Dev/test (default): ya — seed selalu sesuai definisi di seed-data.
 * - Production (default): tidak — hanya menambah yang belum ada, agar perubahan
 *   HR lewat API (mis. nama departemen) tidak kembali ke nilai awal saat seed diulang.
 * Bisa dipaksa via SEED_OVERWRITE_MASTER=true|false.
 */
const OVERWRITE_MASTER = process.env.SEED_OVERWRITE_MASTER
  ? process.env.SEED_OVERWRITE_MASTER === 'true'
  : !IS_PRODUCTION

/** Data `update` untuk upsert: data seed bila boleh menimpa, kosong bila hanya create. */
function upd<T extends object>(data: T): T | Record<string, never> {
  return OVERWRITE_MASTER ? data : {}
}

const DEV_SUPER_ADMIN = { email: 'superadmin@arrayan.com', password: 'Password123!' }
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,72}$/

/**
 * Kredensial Super Admin awal. Production WAJIB dari env (SUPER_ADMIN_EMAIL,
 * SUPER_ADMIN_PASSWORD ≥ 12 karakter, huruf besar/kecil, angka, simbol);
 * dev/test memakai default bila env kosong.
 */
function superAdminCredentials(): { email: string; password: string; isDefault: boolean } {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.SUPER_ADMIN_PASSWORD

  if (IS_PRODUCTION) {
    const problems: string[] = []
    if (!email) problems.push('SUPER_ADMIN_EMAIL wajib diisi')
    if (!password) problems.push('SUPER_ADMIN_PASSWORD wajib diisi')
    else if (!STRONG_PASSWORD.test(password)) {
      problems.push('SUPER_ADMIN_PASSWORD minimal 12 karakter dengan huruf besar, huruf kecil, angka, dan simbol')
    }
    if (problems.length > 0) throw new Error(`Seed production ditolak:\n  - ${problems.join('\n  - ')}`)
  }

  return {
    email: email || DEV_SUPER_ADMIN.email,
    password: password || DEV_SUPER_ADMIN.password,
    isDefault: !password,
  }
}

/** Upsert seluruh master data berdasarkan `code` (idempotent). */
async function seedMasterData() {
  console.log(`Inserting master data (${OVERWRITE_MASTER ? 'overwrite' : 'create-only'})...`)

  const deptIds = new Map<string, string>()
  for (const { parentCode, ...dept } of DEPARTMENTS) {
    const parentId = parentCode ? deptIds.get(parentCode) : undefined
    const row = await prisma.department.upsert({
      where: { code: dept.code },
      update: upd({ ...dept, parentId: parentId ?? null }),
      create: { ...dept, parentId },
    })
    deptIds.set(row.code, row.id)
  }

  const jobIds = new Map<string, string>()
  for (const job of JOB_TITLES) {
    const row = await prisma.jobTitle.upsert({ where: { code: job.code }, update: upd(job), create: job })
    jobIds.set(row.code, row.id)
  }

  for (const office of OFFICE_LOCATIONS) {
    await prisma.officeLocation.upsert({ where: { code: office.code }, update: upd(office), create: office })
  }

  for (const shift of WORK_SHIFTS) {
    await prisma.workShift.upsert({ where: { code: shift.code }, update: upd(shift), create: shift })
  }

  for (const leaveType of LEAVE_TYPES) {
    await prisma.leaveType.upsert({ where: { code: leaveType.code }, update: upd(leaveType), create: leaveType })
  }

  for (const { date, ...holiday } of HOLIDAYS) {
    const data = { ...holiday, date: new Date(`${date}T00:00:00.000Z`) }
    await prisma.holiday.upsert({ where: { code: holiday.code }, update: upd(data), create: data })
  }

  for (const category of TRAINING_CATEGORIES) {
    await prisma.trainingCategory.upsert({ where: { code: category.code }, update: upd(category), create: category })
  }

  for (const { jobTitleCode, departmentCode, indicators, ...template } of KPI_TEMPLATES) {
    const data = {
      ...template,
      jobTitleId: jobTitleCode ? jobIds.get(jobTitleCode) ?? null : null,
      departmentId: departmentCode ? deptIds.get(departmentCode) ?? null : null,
    }
    const indicatorRows = indicators.map((indicator, index) => ({ ...indicator, sortOrder: index }))
    // Indikator template seed diganti utuh setiap seed agar selalu sesuai definisi
    await prisma.kpiTemplate.upsert({
      where: { code: template.code },
      update: upd({ ...data, indicators: { deleteMany: {}, create: indicatorRows } }),
      create: { ...data, indicators: { create: indicatorRows } },
    })
  }

  console.log(
    `  departments=${DEPARTMENTS.length} jobTitles=${JOB_TITLES.length} offices=${OFFICE_LOCATIONS.length} ` +
      `shifts=${WORK_SHIFTS.length} leaveTypes=${LEAVE_TYPES.length} holidays=${HOLIDAYS.length} ` +
      `trainingCategories=${TRAINING_CATEGORIES.length} kpiTemplates=${KPI_TEMPLATES.length}`,
  )
}

/**
 * Profil karyawan untuk akun Super Admin. Jika sudah ada, hanya FK master yang
 * masih kosong yang diisi — perubahan yang dibuat admin lewat aplikasi tidak ditimpa.
 */
async function seedSuperAdminEmployee(userId: string) {
  const [jobTitle, department, officeLocation, workShift] = await Promise.all([
    prisma.jobTitle.findUniqueOrThrow({ where: { code: SUPER_ADMIN_ASSIGNMENT.jobTitleCode } }),
    prisma.department.findUniqueOrThrow({ where: { code: SUPER_ADMIN_ASSIGNMENT.departmentCode } }),
    prisma.officeLocation.findUniqueOrThrow({ where: { code: SUPER_ADMIN_ASSIGNMENT.officeLocationCode } }),
    prisma.workShift.findUniqueOrThrow({ where: { code: SUPER_ADMIN_ASSIGNMENT.workShiftCode } }),
  ])

  const existing = await prisma.employee.findUnique({ where: { nik: 'ADM-001' } })
  if (!existing) {
    await prisma.employee.create({
      data: {
        nik: 'ADM-001',
        fullName: 'Super Administrator HR',
        employmentType: 'KARTAP',
        userId,
        jobTitleId: jobTitle.id,
        departmentId: department.id,
        officeLocationId: officeLocation.id,
        workShiftId: workShift.id,
      },
    })
    return
  }

  await prisma.employee.update({
    where: { id: existing.id },
    data: {
      userId: existing.userId ?? userId,
      departmentId: existing.departmentId ?? department.id,
      officeLocationId: existing.officeLocationId ?? officeLocation.id,
      workShiftId: existing.workShiftId ?? workShift.id,
    },
  })
}

const DEFAULT_ROLES = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Admin / HR GA',
    description: 'Akses penuh ke seluruh modul, pengaturan sistem, kelola data karyawan',
    permissions: ['all'],
  },
  {
    code: 'MANAGEMENT',
    name: 'Management',
    description: 'Top Hierarchy. Read-only across all divisions & approval cuti',
    permissions: ['leave.approve', 'company.read_all'],
  },
  {
    code: 'SR_MANAGER',
    name: 'Senior Manager',
    description: 'Kelola divisi utama, approval izin/cuti bawahan, review KPI divisi',
    permissions: ['leave.approve', 'kpi.review'],
  },
  {
    code: 'MANAGER',
    name: 'Manager',
    description: 'Kelola sub-divisi/tim bawahan, approval izin/cuti bawahan, review KPI tim',
    permissions: ['leave.approve', 'kpi.review'],
  },
  {
    code: 'SUPERVISOR',
    name: 'Supervisor',
    description: 'Mengawasi staf langsung, approval izin/cuti bawahan, evaluasi kinerja tim',
    permissions: ['leave.approve', 'kpi.evaluate'],
  },
  {
    code: 'STAFF',
    name: 'Staff / Karyawan',
    description: 'Pengajuan cuti/izin/reimburse, jadwal training pribadi, cek kuota',
    permissions: ['leave.create', 'reimburse.create', 'profile.read'],
  },
]

async function main() {
  console.log('🌱 Starting database seeding...')

  // 1. Seed Roles
  console.log('Inserting default roles...')
  for (const role of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description, permissions: role.permissions },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
      },
    })
  }

  // 2. Seed Master Data
  await seedMasterData()

  // 3. Seed Default Super Admin Account
  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { code: 'SUPER_ADMIN' },
  })

  const credentials = superAdminCredentials()
  const existingAdmin = await prisma.user.findUnique({ where: { email: credentials.email } })

  // Akun yang sudah ada tidak diubah (password tidak pernah ditimpa oleh seed).
  const adminUser =
    existingAdmin ??
    (await prisma.user.create({
      data: {
        email: credentials.email,
        passwordHash: await bcrypt.hash(credentials.password, 10),
        roleId: superAdminRole.id,
      },
    }))

  await seedSuperAdminEmployee(adminUser.id)

  console.log('✅ Seeding completed!')
  console.log('----------------------------------------------------')
  console.log(`Super Admin Email    : ${adminUser.email}${existingAdmin ? ' (sudah ada, tidak diubah)' : ''}`)
  if (!existingAdmin) {
    // Password hanya dicetak bila memakai default dev — password dari env tidak pernah dicetak.
    console.log(`Super Admin Password : ${credentials.isDefault ? credentials.password : '(dari SUPER_ADMIN_PASSWORD)'}`)
  }
  console.log('----------------------------------------------------')
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

