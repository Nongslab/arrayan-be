/**
 * Aturan murni modul cuti (US-5.1, US-5.2). Tanpa akses DB → mudah di-unit-test.
 * Tanggal selalu yyyy-MM-dd (kalender, UTC).
 */
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'

/** Hari kerja ISO-8601 (1 = Senin … 7 = Minggu) dari tanggal yyyy-MM-dd. */
export function isoWeekday(date: string): number {
  const day = fromDateOnly(date).getUTCDay()
  return day === 0 ? 7 : day
}

/** Semua tanggal dalam rentang inklusif. */
export function eachDate(start: string, end: string): string[] {
  const dates: string[] = []
  for (let d = fromDateOnly(start); toDateOnly(d) <= end; d = addDays(d, 1)) dates.push(toDateOnly(d))
  return dates
}

export type DayCounting = 'WORKING_DAYS' | 'CALENDAR_DAYS'

/**
 * Cara menghitung hari per kategori cuti. Cuti melahirkan dihitung hari kalender
 * (praktik UU Ketenagakerjaan: 1,5 bulan sebelum + 1,5 bulan sesudah); lainnya hari kerja.
 */
export function dayCountingFor(category: string): DayCounting {
  return category === 'MATERNITY' ? 'CALENDAR_DAYS' : 'WORKING_DAYS'
}

/**
 * Hari cuti yang terpakai per tahun kalender. Hari kerja = sesuai `workDays` shift dan bukan
 * hari libur (termasuk cuti bersama, yang sudah memotong saldo tersendiri).
 */
export function leaveDaysByYear(input: {
  start: string
  end: string
  counting: DayCounting
  workDays: readonly number[]
  holidays: ReadonlySet<string>
}): Map<number, number> {
  const perYear = new Map<number, number>()
  for (const date of eachDate(input.start, input.end)) {
    const counts =
      input.counting === 'CALENDAR_DAYS' ||
      (input.workDays.includes(isoWeekday(date)) && !input.holidays.has(date))
    if (!counts) continue
    const year = Number(date.slice(0, 4))
    perYear.set(year, (perYear.get(year) ?? 0) + 1)
  }
  return perYear
}

export function totalDays(perYear: ReadonlyMap<number, number>): number {
  let total = 0
  for (const days of perYear.values()) total += days
  return total
}

/**
 * Kebijakan jatah tahunan — SATU-SATUNYA tempat aturan Q-5 (prorata, carry-over, tanggal reset).
 * Default sementara (menunggu keputusan klien): jatah penuh `defaultQuota` per tahun kalender,
 * tanpa prorata, tanpa carry-over; 0 bila karyawan belum bergabung pada tahun tersebut.
 */
export function entitlementFor(input: { defaultQuota: number; year: number; joinDate: string }): number {
  if (Number(input.joinDate.slice(0, 4)) > input.year) return 0
  return input.defaultQuota
}

/** Cuti bersama yang memotong cuti tahunan: hari kerja karyawan, sejak tanggal masuk. */
export function collectiveLeaveDays(input: {
  dates: readonly string[]
  year: number
  workDays: readonly number[]
  joinDate: string
}): number {
  return input.dates.filter(
    (date) =>
      Number(date.slice(0, 4)) === input.year &&
      date >= input.joinDate &&
      input.workDays.includes(isoWeekday(date)),
  ).length
}

export interface BalanceFigures {
  entitlement: number
  adjustments: number
  collectiveLeave: number
  used: number
  pending: number
}

export function availableDays(b: BalanceFigures): number {
  return b.entitlement + b.adjustments - b.collectiveLeave - b.used - b.pending
}

/** Dua rentang tanggal (inklusif) bertumpang tindih? */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd
}
