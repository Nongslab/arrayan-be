import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { eachDate } from '../leave/leave.rules.js'
import { evaluateDay, type AttendanceStatus, type DayResult, type ShiftRule } from './attendance.engine.js'

const DEFAULT_TIME_ZONE = 'Asia/Jakarta'

/** Dipakai bila karyawan belum punya shift — sama dengan shift REGULAR di seed. */
export const FALLBACK_SHIFT: ShiftRule = {
  startTime: '08:00',
  endTime: '17:00',
  lateToleranceMinutes: 15,
  workDays: [1, 2, 3, 4, 5],
  isOvernight: false,
}

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'PRESENT_ON_TIME',
  'LATE',
  'ABSENT',
  'ON_LEAVE',
  'SICK',
  'HOLIDAY',
  'DAY_OFF',
  'SCHEDULED',
]

export interface AttendanceDay {
  date: string
  status: AttendanceStatus
  clockIn: string | null
  clockOut: string | null
  lateMinutes: number
  scheduledStart: string | null
  scheduledEnd: string | null
}

function serializeDay(day: DayResult): AttendanceDay {
  return {
    date: day.date,
    status: day.status,
    clockIn: day.clockIn?.toISOString() ?? null,
    clockOut: day.clockOut?.toISOString() ?? null,
    lateMinutes: day.lateMinutes,
    scheduledStart: day.scheduledStart?.toISOString() ?? null,
    scheduledEnd: day.scheduledEnd?.toISOString() ?? null,
  }
}

export function summarize(days: readonly AttendanceDay[]) {
  const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) as Record<AttendanceStatus, number>
  let totalLateMinutes = 0
  for (const day of days) {
    counts[day.status] += 1
    totalLateMinutes += day.lateMinutes
  }
  return { ...counts, totalLateMinutes }
}

const employeeSelect = {
  id: true,
  nik: true,
  fullName: true,
  joinDate: true,
  exitDate: true,
  jobTitle: { select: { id: true, code: true, name: true, level: true } },
  department: { select: { id: true, code: true, name: true } },
  workShift: {
    select: { startTime: true, endTime: true, lateToleranceMinutes: true, workDays: true, isOvernight: true },
  },
  officeLocation: { select: { timezone: true } },
} satisfies Prisma.EmployeeSelect

type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>

/** Karyawan yang bekerja setidaknya sehari dalam rentang (termasuk yang keluar di tengah rentang). */
function employedWithin(from: string, to: string): Prisma.EmployeeWhereInput {
  return {
    joinDate: { lte: addDays(fromDateOnly(to), 1) },
    OR: [{ exitDate: null }, { exitDate: { gte: fromDateOnly(from) } }],
  }
}

/**
 * Status harian banyak karyawan sekaligus (query di-batch: 1 query per jenis data).
 * Dihitung saat dibaca dari log + shift + hari libur + cuti APPROVED.
 */
async function computeFor(employees: EmployeeRow[], from: string, to: string, now: Date) {
  const ids = employees.map((e) => e.id)
  const [holidays, leaves, logs] = await Promise.all([
    prisma.holiday.findMany({
      where: { isActive: true, date: { gte: fromDateOnly(from), lte: fromDateOnly(to) } },
      select: { date: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: ids },
        status: 'APPROVED',
        startDate: { lte: fromDateOnly(to) },
        endDate: { gte: fromDateOnly(from) },
      },
      select: { employeeId: true, startDate: true, endDate: true, leaveType: { select: { category: true } } },
    }),
    // Rentang longgar (±2 hari) agar shift malam & perbedaan zona waktu tetap tertangkap.
    prisma.attendanceLog.findMany({
      where: {
        employeeId: { in: ids },
        occurredAt: { gte: addDays(fromDateOnly(from), -2), lte: addDays(fromDateOnly(to), 2) },
      },
      select: { employeeId: true, occurredAt: true },
    }),
  ])

  const holidaySet = new Set(holidays.map((h) => toDateOnly(h.date)))
  const logsByEmployee = new Map<string, Date[]>()
  for (const log of logs) {
    logsByEmployee.set(log.employeeId, [...(logsByEmployee.get(log.employeeId) ?? []), log.occurredAt])
  }
  const dates = eachDate(from, to)

  return new Map(
    employees.map((employee) => {
      const shift: ShiftRule = employee.workShift ?? FALLBACK_SHIFT
      const timeZone = employee.officeLocation?.timezone ?? DEFAULT_TIME_ZONE
      const joinDate = toDateOnly(employee.joinDate)
      const exitDate = employee.exitDate ? toDateOnly(employee.exitDate) : null
      const ownLeaves = leaves.filter((l) => l.employeeId === employee.id)
      const leaveFor = (date: string) =>
        ownLeaves.find((l) => toDateOnly(l.startDate) <= date && date <= toDateOnly(l.endDate))?.leaveType.category ??
        null

      const days = dates
        .filter((date) => date >= joinDate && (!exitDate || date <= exitDate))
        .map((date) =>
          serializeDay(
            evaluateDay({
              date,
              shift,
              timeZone,
              logs: logsByEmployee.get(employee.id) ?? [],
              isHoliday: holidaySet.has(date),
              leaveCategory: leaveFor(date),
              now,
            }),
          ),
        )
      return [employee.id, days] as const
    }),
  )
}

function employeeSummary(employee: EmployeeRow) {
  return {
    id: employee.id,
    nik: employee.nik,
    fullName: employee.fullName,
    jobTitle: employee.jobTitle,
    department: employee.department,
  }
}

/** Status harian satu karyawan. */
export async function attendanceDays(employeeId: string, from: string, to: string, now = new Date()) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: employeeSelect })
  if (!employee) throw new HttpError(404, 'Karyawan tidak ditemukan')
  return (await computeFor([employee], from, to, now)).get(employee.id)!
}

/** Seluruh bawahan (semua level) dari karyawan `rootId`, tidak termasuk dirinya. */
export async function descendantIds(rootId: string): Promise<string[]> {
  const all = await prisma.employee.findMany({ select: { id: true, managerId: true } })
  const childrenOf = new Map<string, string[]>()
  for (const e of all) {
    if (!e.managerId) continue
    childrenOf.set(e.managerId, [...(childrenOf.get(e.managerId) ?? []), e.id])
  }
  const result = new Set<string>()
  const stack = [...(childrenOf.get(rootId) ?? [])]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (result.has(id) || id === rootId) continue // aman terhadap data siklus
    result.add(id)
    stack.push(...(childrenOf.get(id) ?? []))
  }
  return [...result]
}

export interface RecapOptions {
  from: string
  to: string
  includeDays: boolean
  page: number
  limit: number
  now?: Date
}

/** Rekap per karyawan untuk sekumpulan karyawan (filter where), urut nama, berpaginasi. */
export async function attendanceRecap(where: Prisma.EmployeeWhereInput, options: RecapOptions) {
  const filter: Prisma.EmployeeWhereInput = { AND: [where, employedWithin(options.from, options.to)] }
  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where: filter,
      select: employeeSelect,
      orderBy: [{ fullName: 'asc' }, { nik: 'asc' }],
      skip: (options.page - 1) * options.limit,
      take: options.limit,
    }),
    prisma.employee.count({ where: filter }),
  ])

  const daysById = await computeFor(employees, options.from, options.to, options.now ?? new Date())
  return {
    data: employees.map((employee) => {
      const days = daysById.get(employee.id) ?? []
      return {
        employee: employeeSummary(employee),
        summary: summarize(days),
        ...(options.includeDays ? { days } : {}),
      }
    }),
    meta: { from: options.from, to: options.to, page: options.page, limit: options.limit, total },
  }
}

/** Karyawan aktif yang berstatus LATE pada `date` (sumber widget "Yang Telat Hari Ini"). */
export async function lateEmployeesOn(date: string, now = new Date()) {
  const employees = await prisma.employee.findMany({
    where: { AND: [{ status: 'ACTIVE' }, employedWithin(date, date)] },
    select: employeeSelect,
    orderBy: [{ fullName: 'asc' }, { nik: 'asc' }],
  })
  const daysById = await computeFor(employees, date, date, now)
  return employees.flatMap((employee) => {
    const day = daysById.get(employee.id)?.[0]
    return day?.status === 'LATE'
      ? [{ employee: employeeSummary(employee), lateMinutes: day.lateMinutes, clockIn: day.clockIn }]
      : []
  })
}
