/**
 * Engine status kehadiran harian (US-3.1) — fungsi murni, tanpa akses DB.
 * Satu sumber kebenaran untuk dashboard "Telat Hari Ini", rekap, dan ekspor,
 * apa pun sumber log-nya (aplikasi, mesin fingerprint, koreksi manual).
 */
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { isoWeekday } from '../leave/leave.rules.js'

export type AttendanceStatus =
  | 'PRESENT_ON_TIME'
  | 'LATE'
  | 'ABSENT'
  | 'ON_LEAVE'
  | 'SICK'
  | 'HOLIDAY'
  | 'DAY_OFF'
  | 'SCHEDULED'

export interface ShiftRule {
  startTime: string // HH:mm, waktu lokal kantor
  endTime: string
  lateToleranceMinutes: number
  workDays: readonly number[] // ISO 1 = Senin … 7 = Minggu
  isOvernight: boolean
}

export interface DayInput {
  date: string // yyyy-MM-dd (tanggal mulai shift)
  shift: ShiftRule
  timeZone: string
  /** Waktu log absensi (instant) milik karyawan di sekitar tanggal ini. */
  logs: readonly Date[]
  isHoliday: boolean
  /** Kategori cuti APPROVED yang mencakup tanggal ini (mis. 'ANNUAL', 'SICK'), atau null. */
  leaveCategory: string | null
  now: Date
}

export interface DayResult {
  date: string
  status: AttendanceStatus
  clockIn: Date | null
  clockOut: Date | null
  /** Menit terlambat dihitung dari jam mulai shift (0 bila tepat waktu). */
  lateMinutes: number
  scheduledStart: Date | null
  scheduledEnd: Date | null
}

/** Jendela pencocokan log terhadap shift: 4 jam sebelum mulai s.d. 8 jam setelah selesai. */
const WINDOW_BEFORE_MS = 4 * 60 * 60 * 1000
const WINDOW_AFTER_MS = 8 * 60 * 60 * 1000

/** Offset zona waktu (ms) pada instant tertentu, mis. Asia/Jakarta → +7 jam. */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** Tanggal + jam lokal (HH:mm) di zona `timeZone` → instant UTC. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [hour, minute] = time.split(':').map(Number)
  const naive = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    hour,
    minute,
  )
  const firstGuess = naive - timeZoneOffsetMs(new Date(naive), timeZone)
  // Koreksi sekali untuk zona dengan perubahan offset (DST); Asia/Jakarta tetap +07:00.
  return new Date(naive - timeZoneOffsetMs(new Date(firstGuess), timeZone))
}

/** Tanggal kalender (yyyy-MM-dd) suatu instant di zona tertentu. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant)
}

export function shiftBounds(date: string, shift: ShiftRule, timeZone: string) {
  const start = zonedTimeToUtc(date, shift.startTime, timeZone)
  const endDate = shift.isOvernight ? toDateOnly(addDays(fromDateOnly(date), 1)) : date
  const end = zonedTimeToUtc(endDate, shift.endTime, timeZone)
  return { start, end }
}

/**
 * Status satu hari. Urutan prioritas: cuti disetujui → hari libur → bukan hari kerja →
 * kehadiran dari log → belum waktunya (SCHEDULED) → ABSENT.
 */
export function evaluateDay(input: DayInput): DayResult {
  const { date, shift, timeZone } = input
  const { start, end } = shiftBounds(date, shift, timeZone)
  const windowStart = start.getTime() - WINDOW_BEFORE_MS
  const windowEnd = end.getTime() + WINDOW_AFTER_MS

  const inWindow = input.logs
    .filter((log) => log.getTime() >= windowStart && log.getTime() <= windowEnd)
    .sort((a, b) => a.getTime() - b.getTime())
  const clockIn = inWindow[0] ?? null
  const last = inWindow[inWindow.length - 1] ?? null
  const clockOut = last && clockIn && last.getTime() > clockIn.getTime() ? last : null

  const isWorkDay = shift.workDays.includes(isoWeekday(date))
  const base = { date, clockIn, clockOut, scheduledStart: isWorkDay ? start : null, scheduledEnd: isWorkDay ? end : null }

  if (input.leaveCategory) {
    return { ...base, status: input.leaveCategory === 'SICK' ? 'SICK' : 'ON_LEAVE', lateMinutes: 0 }
  }
  if (input.isHoliday) return { ...base, status: 'HOLIDAY', lateMinutes: 0 }
  if (!isWorkDay) return { ...base, status: 'DAY_OFF', lateMinutes: 0 }

  if (clockIn) {
    const deadline = start.getTime() + shift.lateToleranceMinutes * 60_000
    const late = clockIn.getTime() > deadline
    return {
      ...base,
      status: late ? 'LATE' : 'PRESENT_ON_TIME',
      lateMinutes: late ? Math.ceil((clockIn.getTime() - start.getTime()) / 60_000) : 0,
    }
  }

  // Belum ada log: masih bisa datang selama batas toleransi belum lewat.
  const deadline = start.getTime() + shift.lateToleranceMinutes * 60_000
  return { ...base, status: input.now.getTime() <= deadline ? 'SCHEDULED' : 'ABSENT', lateMinutes: 0 }
}
