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

/**
 * Status kehadiran harian karyawan pada rentang [from, to] (yyyy-MM-dd, tanggal lokal kantor).
 * Dihitung saat dibaca dari log mentah + shift + hari libur + cuti APPROVED, sehingga selalu
 * konsisten bila cuti/hari libur/shift berubah. Tanggal sebelum masuk / sesudah keluar tidak disertakan.
 */
export async function attendanceDays(employeeId: string, from: string, to: string, now = new Date()) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      joinDate: true,
      exitDate: true,
      workShift: {
        select: { startTime: true, endTime: true, lateToleranceMinutes: true, workDays: true, isOvernight: true },
      },
      officeLocation: { select: { timezone: true } },
    },
  })
  if (!employee) throw new HttpError(404, 'Karyawan tidak ditemukan')

  const shift: ShiftRule = employee.workShift ?? FALLBACK_SHIFT
  const timeZone = employee.officeLocation?.timezone ?? DEFAULT_TIME_ZONE
  const joinDate = toDateOnly(employee.joinDate)
  const exitDate = employee.exitDate ? toDateOnly(employee.exitDate) : null

  const [holidays, leaves, logs] = await Promise.all([
    prisma.holiday.findMany({
      where: { isActive: true, date: { gte: fromDateOnly(from), lte: fromDateOnly(to) } },
      select: { date: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        startDate: { lte: fromDateOnly(to) },
        endDate: { gte: fromDateOnly(from) },
      },
      select: { startDate: true, endDate: true, leaveType: { select: { category: true } } },
    }),
    // Rentang longgar (±2 hari) agar shift malam & perbedaan zona waktu tetap tertangkap.
    prisma.attendanceLog.findMany({
      where: { employeeId, occurredAt: { gte: addDays(fromDateOnly(from), -2), lte: addDays(fromDateOnly(to), 2) } },
      select: { occurredAt: true },
    }),
  ])

  const holidaySet = new Set(holidays.map((h) => toDateOnly(h.date)))
  const logTimes = logs.map((l) => l.occurredAt)
  const leaveFor = (date: string) =>
    leaves.find((l) => toDateOnly(l.startDate) <= date && date <= toDateOnly(l.endDate))?.leaveType.category ?? null

  return eachDate(from, to)
    .filter((date) => date >= joinDate && (!exitDate || date <= exitDate))
    .map((date) =>
      serializeDay(
        evaluateDay({
          date,
          shift,
          timeZone,
          logs: logTimes,
          isHoliday: holidaySet.has(date),
          leaveCategory: leaveFor(date),
          now,
        }),
      ),
    )
}
