import { addMonths, toDateOnly } from '../../lib/dates.js'

/** Lama masa probation standar (PRD Module 1). */
export const PROBATION_MONTHS = 6

export type EmploymentType = 'PROBATION' | 'KARTAP' | 'PKL'

export function defaultProbationEnd(joinDate: Date): Date {
  return addMonths(joinDate, PROBATION_MONTHS)
}

export interface ProbationInput {
  employmentType: EmploymentType
  joinDate: Date
  /** undefined = tidak dikirim; null = dikosongkan; Date = diatur manual. */
  requested: Date | null | undefined
  /** Data sebelum perubahan (hanya untuk update). */
  before?: { joinDate: Date; probationEndDate: Date | null }
}

export type ProbationResult = { ok: true; value: Date | null | undefined } | { ok: false; message: string }

/**
 * Tentukan `probationEndDate` baru (`value: undefined` = tidak diubah).
 * - PROBATION tanpa nilai manual → joinDate + 6 bulan. Pada update, dihitung ulang hanya bila
 *   nilai lama kosong atau masih sama dengan default lama (nilai yang diatur manual HR dipertahankan).
 * - Nilai manual hanya untuk PROBATION, wajib setelah joinDate.
 * - Bukan PROBATION: nilai lama dipertahankan sebagai riwayat (mis. setelah diangkat KARTAP).
 */
export function resolveProbationEnd(input: ProbationInput): ProbationResult {
  const { employmentType, joinDate, requested, before } = input

  if (requested !== undefined && requested !== null) {
    if (employmentType !== 'PROBATION') {
      return { ok: false, message: 'probationEndDate hanya untuk employmentType PROBATION' }
    }
    if (requested <= joinDate) return { ok: false, message: 'probationEndDate harus setelah joinDate' }
    return { ok: true, value: requested }
  }

  if (requested === null) {
    if (employmentType === 'PROBATION') {
      return { ok: false, message: 'probationEndDate wajib untuk karyawan PROBATION' }
    }
    return { ok: true, value: null }
  }

  if (employmentType !== 'PROBATION') return { ok: true, value: before ? undefined : null }

  if (!before) return { ok: true, value: defaultProbationEnd(joinDate) }

  const previousDefault = toDateOnly(defaultProbationEnd(before.joinDate))
  const wasDefaultOrEmpty =
    before.probationEndDate === null || toDateOnly(before.probationEndDate) === previousDefault
  if (!wasDefaultOrEmpty) return { ok: true, value: undefined }

  const next = defaultProbationEnd(joinDate)
  return before.probationEndDate && toDateOnly(before.probationEndDate) === toDateOnly(next)
    ? { ok: true, value: undefined }
    : { ok: true, value: next }
}
