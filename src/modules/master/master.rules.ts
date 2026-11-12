/**
 * Aturan bisnis master data yang tidak bisa dijamin constraint database
 * (docs/MASTER_DATA.md §8). Fungsi murni → mudah di-unit-test.
 * Setiap fungsi `check*` mengembalikan pesan error, atau `null` bila valid.
 */

export const CODE_PATTERN = /^[A-Z0-9]+(_[A-Z0-9]+)*$/
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const BSSID_PATTERN = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/

export function isValidDateOnly(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-9
}

/** Shift: jam mulai ≠ selesai; jika selesai ≤ mulai (lewat tengah malam) wajib `isOvernight`. */
export function checkWorkShift(shift: { startTime: string; endTime: string; isOvernight: boolean }): string | null {
  if (shift.startTime === shift.endTime) {
    return 'startTime dan endTime tidak boleh sama'
  }
  if (shift.endTime < shift.startTime && !shift.isOvernight) {
    return 'endTime lebih awal dari startTime: set isOvernight = true untuk shift lintas tengah malam'
  }
  if (shift.endTime > shift.startTime && shift.isOvernight) {
    return 'isOvernight = true hanya untuk shift dengan endTime lebih awal dari startTime'
  }
  return null
}

export interface KpiIndicatorRuleInput {
  name: string
  type: 'QUANTITATIVE' | 'QUALITATIVE'
  weight: number
  target?: number | null
}

/** KPI: total bobot = 100; QUANTITATIVE wajib target; QUALITATIVE tanpa target. */
export function checkKpiIndicators(indicators: KpiIndicatorRuleInput[]): string | null {
  if (indicators.length === 0) {
    return 'Template KPI minimal memiliki 1 indikator'
  }

  const totalCents = indicators.reduce((sum, indicator) => sum + Math.round(indicator.weight * 100), 0)
  if (totalCents !== 10_000) {
    return `Total bobot indikator harus 100 (saat ini ${totalCents / 100})`
  }

  for (const indicator of indicators) {
    const hasTarget = indicator.target !== undefined && indicator.target !== null
    if (indicator.type === 'QUANTITATIVE' && !hasTarget) {
      return `Indikator "${indicator.name}" bertipe QUANTITATIVE wajib memiliki target`
    }
    if (indicator.type === 'QUALITATIVE' && hasTarget) {
      return `Indikator "${indicator.name}" bertipe QUALITATIVE tidak boleh memiliki target`
    }
  }
  return null
}

/**
 * Departemen: apakah menjadikan `newParentId` sebagai parent dari `id` membentuk siklus?
 * `parentOf` = peta id → parentId seluruh departemen (data master kecil, cukup dimuat sekali).
 */
export function wouldCreateDepartmentCycle(
  parentOf: ReadonlyMap<string, string | null>,
  id: string,
  newParentId: string,
): boolean {
  const visited = new Set<string>()
  let current: string | null | undefined = newParentId
  while (current) {
    if (current === id || visited.has(current)) return true
    visited.add(current)
    current = parentOf.get(current) ?? null
  }
  return false
}
