/**
 * Menulis rencana data demo (plan.ts) ke database. Idempoten: data demo lama dihapus dulu
 * (berdasarkan penanda), data lain tidak disentuh. Semua dalam satu transaksi.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { fromDateOnly, toDateOnly } from '../../src/lib/dates.js'
import { dayCountingFor, leaveDaysByYear, totalDays } from '../../src/modules/leave/leave.rules.js'
import {
  buildDemoPlan,
  DEMO_EMAIL_DOMAIN,
  DEMO_MARKER,
  DEMO_NIK_PREFIX,
  DEMO_PASSWORD,
  hm,
  jakarta,
  WORK_DAYS,
  type DemoPlan,
} from './plan.js'

type Db = Prisma.TransactionClient

export interface DemoSummary {
  employees: number
  accounts: number
  leaves: number
  attendanceLogs: number
  trainings: number
  events: number
}

/** Hapus seluruh data demo. Mengembalikan jumlah karyawan demo yang dihapus. */
export async function clearDemo(db: Db): Promise<number> {
  const ids = (await db.employee.findMany({ where: { nik: { startsWith: DEMO_NIK_PREFIX } }, select: { id: true } })).map((e) => e.id)
  const byEmployee = { where: { employeeId: { in: ids } } }
  await db.attendanceLog.deleteMany(byEmployee)
  await db.leaveRequest.deleteMany(byEmployee)
  await db.leaveBalanceAdjustment.deleteMany(byEmployee)
  await db.trainingParticipant.deleteMany(byEmployee)
  await db.training.deleteMany({ where: { description: { endsWith: DEMO_MARKER } } })
  await db.calendarEvent.deleteMany({ where: { description: { endsWith: DEMO_MARKER } } })
  await db.employee.deleteMany({ where: { id: { in: ids } } })
  await db.user.deleteMany({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } })
  return ids.length
}

async function lookup<T extends { code: string; id: string }>(label: string, rows: Promise<T[]>): Promise<Map<string, T>> {
  const map = new Map((await rows).map((r) => [r.code, r]))
  if (map.size === 0) throw new Error(`Master ${label} kosong — jalankan "npm run prisma:seed" terlebih dahulu`)
  return map
}

function need<T>(map: Map<string, T>, code: string, label: string): T {
  const value = map.get(code)
  if (!value) throw new Error(`Master ${label} "${code}" tidak ditemukan — jalankan "npm run prisma:seed" terlebih dahulu`)
  return value
}

async function writePlan(db: Db, plan: DemoPlan, passwordHash: string, holidays: ReadonlySet<string>): Promise<DemoSummary> {
  const [roles, jobs, depts, offices, shifts, leaveTypes, categories] = await Promise.all([
    lookup('role', db.role.findMany({ select: { id: true, code: true } })),
    lookup('jabatan', db.jobTitle.findMany({ select: { id: true, code: true } })),
    lookup('departemen', db.department.findMany({ select: { id: true, code: true } })),
    lookup('lokasi kantor', db.officeLocation.findMany({ select: { id: true, code: true, latitude: true, longitude: true } })),
    lookup('shift', db.workShift.findMany({ select: { id: true, code: true } })),
    lookup('jenis cuti', db.leaveType.findMany({ select: { id: true, code: true, category: true } })),
    lookup('kategori training', db.trainingCategory.findMany({ select: { id: true, code: true } })),
  ])
  const office = need(offices, 'HO', 'lokasi kantor')
  const shift = need(shifts, 'REGULAR', 'shift')

  // Karyawan (atasan selalu didefinisikan sebelum bawahan)
  const employeeIds = new Map<string, string>()
  let accounts = 0
  for (const e of plan.employees) {
    let userId: string | null = null
    if (e.email) {
      const user = await db.user.create({
        data: {
          email: e.email,
          passwordHash: e.account === 'PENDING_ACTIVATION' ? null : passwordHash,
          status: e.account === 'NONE' ? 'ACTIVE' : e.account,
          roleId: need(roles, e.role, 'role').id,
        },
      })
      userId = user.id
      accounts++
    }
    const managerId = e.managerKey ? employeeIds.get(e.managerKey) : null
    if (e.managerKey && !managerId) throw new Error(`Atasan ${e.managerKey} harus didefinisikan sebelum ${e.key}`)
    const row = await db.employee.create({
      data: {
        userId,
        nik: e.nik,
        fullName: e.fullName,
        gender: e.gender,
        birthDate: fromDateOnly(e.birthDate),
        phone: e.phone,
        employmentType: e.employmentType,
        joinDate: fromDateOnly(e.joinDate),
        probationEndDate: e.probationEndDate ? fromDateOnly(e.probationEndDate) : null,
        status: e.status,
        exitDate: e.exitDate ? fromDateOnly(e.exitDate) : null,
        jobTitleId: need(jobs, e.jobTitleCode, 'jabatan').id,
        departmentId: need(depts, e.departmentCode, 'departemen').id,
        officeLocationId: office.id,
        workShiftId: shift.id,
        managerId: managerId ?? null,
      },
    })
    employeeIds.set(e.key, row.id)
  }
  const idOf = (key: string) => need(employeeIds, key, 'karyawan demo')

  // Cuti — hari dihitung dengan aturan yang sama dengan API
  for (const l of plan.leaves) {
    const type = need(leaveTypes, l.leaveTypeCode, 'jenis cuti')
    const perYear = leaveDaysByYear({
      start: l.startDate,
      end: l.endDate,
      counting: dayCountingFor(type.category),
      workDays: WORK_DAYS,
      holidays,
    })
    await db.leaveRequest.create({
      data: {
        employeeId: idOf(l.employeeKey),
        leaveTypeId: type.id,
        startDate: fromDateOnly(l.startDate),
        endDate: fromDateOnly(l.endDate),
        days: totalDays(perYear),
        daysByYear: Object.fromEntries(perYear),
        reason: l.reason,
        status: l.status,
        ...(l.status === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: l.cancelReason ?? null } : {}),
      },
    })
  }

  for (const a of plan.adjustments) {
    await db.leaveBalanceAdjustment.create({
      data: { employeeId: idOf(a.employeeKey), leaveTypeId: need(leaveTypes, a.leaveTypeCode, 'jenis cuti').id, year: a.year, days: a.days, reason: a.reason },
    })
  }

  // Absensi
  const lat = Number(office.latitude)
  const lng = Number(office.longitude)
  await db.attendanceLog.createMany({
    data: plan.attendance.map((log) => ({
      employeeId: idOf(log.employeeKey),
      occurredAt: log.occurredAt,
      source: log.source,
      kind: log.kind,
      deviceCode: log.deviceCode,
      ...(log.gpsOffset
        ? {
            verification: 'GPS' as const,
            latitude: (lat + log.gpsOffset.lat).toFixed(6),
            longitude: (lng + log.gpsOffset.lng).toFixed(6),
            accuracyMeters: 10,
          }
        : {}),
    })),
  })

  // Training
  for (const t of plan.trainings) {
    await db.training.create({
      data: {
        title: t.title,
        description: t.description,
        categoryId: need(categories, t.categoryCode, 'kategori training').id,
        organizer: t.organizer,
        location: t.location,
        startAt: jakarta(t.date, hm(t.startTime)),
        endAt: jakarta(t.date, hm(t.endTime)),
        status: t.status,
        participants: {
          create: t.participants.map((p) => ({
            employeeId: idOf(p.employeeKey),
            attended: p.attended,
            rating: p.rating,
            remarks: p.remarks,
            remarkedAt: p.remarks ? jakarta(t.date, hm(t.endTime) + 60) : null,
          })),
        },
      },
    })
  }

  await db.calendarEvent.createMany({
    data: plan.events.map((e) => ({ ...e, startDate: fromDateOnly(e.startDate), endDate: fromDateOnly(e.endDate) })),
  })

  return {
    employees: plan.employees.length,
    accounts,
    leaves: plan.leaves.length,
    attendanceLogs: plan.attendance.length,
    trainings: plan.trainings.length,
    events: plan.events.length,
  }
}

export interface SeedDemoOptions {
  /** Hari ini (yyyy-MM-dd, Asia/Jakarta) */
  today: string
  now?: Date
}

export async function seedDemo(prisma: PrismaClient, options: SeedDemoOptions) {
  const now = options.now ?? new Date()
  const holidayRows = await prisma.holiday.findMany({ where: { isActive: true }, select: { date: true } })
  const holidays = new Set(holidayRows.map((h) => toDateOnly(h.date)))
  const plan = buildDemoPlan({ today: options.today, now, holidays })
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  return prisma.$transaction(
    async (tx) => {
      const removed = await clearDemo(tx)
      const summary = await writePlan(tx, plan, passwordHash, holidays)
      return { removed, summary, plan }
    },
    { timeout: 120_000, maxWait: 10_000 },
  )
}
