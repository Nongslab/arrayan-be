import { describe, expect, it } from 'vitest'
import {
  availableDays,
  collectiveLeaveDays,
  dayCountingFor,
  entitlementFor,
  isoWeekday,
  leaveDaysByYear,
  rangesOverlap,
  totalDays,
} from './leave.rules.js'

const MON_FRI = [1, 2, 3, 4, 5]

describe('leave.rules', () => {
  it('isoWeekday', () => {
    expect(isoWeekday('2026-11-16')).toBe(1) // Senin
    expect(isoWeekday('2026-11-22')).toBe(7) // Minggu
  })

  it('hari kerja: lewati akhir pekan & hari libur', () => {
    // Senin 2026-08-10 s.d. Rabu 2026-08-19, 17 Agustus libur
    const days = leaveDaysByYear({
      start: '2026-08-10',
      end: '2026-08-19',
      counting: 'WORKING_DAYS',
      workDays: MON_FRI,
      holidays: new Set(['2026-08-17']),
    })
    expect(totalDays(days)).toBe(7)
  })

  it('shift 6 hari kerja menghitung Sabtu', () => {
    const days = leaveDaysByYear({
      start: '2026-11-16',
      end: '2026-11-22',
      counting: 'WORKING_DAYS',
      workDays: [1, 2, 3, 4, 5, 6],
      holidays: new Set(),
    })
    expect(totalDays(days)).toBe(6)
  })

  it('hari kalender (melahirkan) menghitung semua hari', () => {
    expect(dayCountingFor('MATERNITY')).toBe('CALENDAR_DAYS')
    expect(dayCountingFor('ANNUAL')).toBe('WORKING_DAYS')
    const days = leaveDaysByYear({
      start: '2026-11-16',
      end: '2026-11-22',
      counting: 'CALENDAR_DAYS',
      workDays: MON_FRI,
      holidays: new Set(['2026-11-17']),
    })
    expect(totalDays(days)).toBe(7)
  })

  it('pengajuan lintas tahun dibagi per tahun', () => {
    const days = leaveDaysByYear({
      start: '2026-12-28',
      end: '2027-01-05',
      counting: 'WORKING_DAYS',
      workDays: MON_FRI,
      holidays: new Set(['2027-01-01']),
    })
    expect(Object.fromEntries(days)).toEqual({ 2026: 4, 2027: 2 })
  })

  it('rentang tanpa hari kerja → 0', () => {
    const days = leaveDaysByYear({
      start: '2026-11-21',
      end: '2026-11-22',
      counting: 'WORKING_DAYS',
      workDays: MON_FRI,
      holidays: new Set(),
    })
    expect(totalDays(days)).toBe(0)
  })

  it('jatah default: penuh per tahun, 0 sebelum bergabung', () => {
    expect(entitlementFor({ defaultQuota: 12, year: 2026, joinDate: '2026-10-01' })).toBe(12)
    expect(entitlementFor({ defaultQuota: 12, year: 2025, joinDate: '2026-10-01' })).toBe(0)
  })

  it('cuti bersama: hanya hari kerja, tahun terkait, dan sejak bergabung', () => {
    const dates = ['2026-06-02', '2026-12-24', '2026-12-26', '2027-01-02']
    expect(collectiveLeaveDays({ dates, year: 2026, workDays: MON_FRI, joinDate: '2026-01-01' })).toBe(2) // 26 Des Sabtu
    expect(collectiveLeaveDays({ dates, year: 2026, workDays: MON_FRI, joinDate: '2026-07-01' })).toBe(1)
  })

  it('saldo tersedia', () => {
    expect(availableDays({ entitlement: 12, adjustments: 2, collectiveLeave: 2, used: 3, pending: 1 })).toBe(8)
  })

  it('tumpang tindih rentang', () => {
    expect(rangesOverlap('2026-11-10', '2026-11-12', '2026-11-12', '2026-11-14')).toBe(true)
    expect(rangesOverlap('2026-11-10', '2026-11-12', '2026-11-13', '2026-11-14')).toBe(false)
  })
})
