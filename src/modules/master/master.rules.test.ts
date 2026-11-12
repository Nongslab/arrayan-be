import { describe, expect, it } from 'vitest'
import {
  checkKpiIndicators,
  checkWorkShift,
  hasAtMostTwoDecimals,
  isValidDateOnly,
  isValidTimezone,
  wouldCreateDepartmentCycle,
} from './master.rules.js'

describe('master.rules', () => {
  describe('checkWorkShift', () => {
    it('menerima shift reguler', () => {
      expect(checkWorkShift({ startTime: '08:00', endTime: '17:00', isOvernight: false })).toBeNull()
    })

    it('menerima shift malam lintas tengah malam bila isOvernight', () => {
      expect(checkWorkShift({ startTime: '22:00', endTime: '06:00', isOvernight: true })).toBeNull()
    })

    it('menolak shift lintas tengah malam tanpa isOvernight', () => {
      expect(checkWorkShift({ startTime: '22:00', endTime: '06:00', isOvernight: false })).toMatch(/isOvernight/)
    })

    it('menolak isOvernight pada shift siang', () => {
      expect(checkWorkShift({ startTime: '08:00', endTime: '17:00', isOvernight: true })).toMatch(/isOvernight/)
    })

    it('menolak jam mulai = jam selesai', () => {
      expect(checkWorkShift({ startTime: '08:00', endTime: '08:00', isOvernight: false })).toMatch(/tidak boleh sama/)
    })
  })

  describe('checkKpiIndicators', () => {
    it('menerima total bobot 100 dengan desimal', () => {
      expect(
        checkKpiIndicators([
          { name: 'A', type: 'QUANTITATIVE', weight: 33.33, target: 10 },
          { name: 'B', type: 'QUANTITATIVE', weight: 33.33, target: 5 },
          { name: 'C', type: 'QUALITATIVE', weight: 33.34 },
        ]),
      ).toBeNull()
    })

    it('menolak total bobot ≠ 100', () => {
      expect(checkKpiIndicators([{ name: 'A', type: 'QUALITATIVE', weight: 90 }])).toMatch(/harus 100/)
    })

    it('menolak indikator kosong', () => {
      expect(checkKpiIndicators([])).toMatch(/minimal/)
    })

    it('QUANTITATIVE wajib target', () => {
      expect(checkKpiIndicators([{ name: 'A', type: 'QUANTITATIVE', weight: 100 }])).toMatch(/wajib memiliki target/)
    })

    it('QUALITATIVE tidak boleh punya target', () => {
      expect(checkKpiIndicators([{ name: 'A', type: 'QUALITATIVE', weight: 100, target: 3 }])).toMatch(
        /tidak boleh memiliki target/,
      )
    })
  })

  describe('wouldCreateDepartmentCycle', () => {
    // HQ → ENG → ENG_FE
    const parentOf = new Map<string, string | null>([
      ['HQ', null],
      ['ENG', 'HQ'],
      ['ENG_FE', 'ENG'],
      ['FIN', 'HQ'],
    ])

    it('false untuk pindah ke cabang lain', () => {
      expect(wouldCreateDepartmentCycle(parentOf, 'ENG_FE', 'FIN')).toBe(false)
    })

    it('true bila parent = diri sendiri', () => {
      expect(wouldCreateDepartmentCycle(parentOf, 'ENG', 'ENG')).toBe(true)
    })

    it('true bila parent adalah keturunannya', () => {
      expect(wouldCreateDepartmentCycle(parentOf, 'HQ', 'ENG_FE')).toBe(true)
    })

    it('false untuk departemen baru (id belum ada di peta)', () => {
      expect(wouldCreateDepartmentCycle(parentOf, 'NEW', 'ENG_FE')).toBe(false)
    })
  })

  describe('helpers', () => {
    it('isValidDateOnly', () => {
      expect(isValidDateOnly('2026-08-17')).toBe(true)
      expect(isValidDateOnly('2026-02-30')).toBe(false)
      expect(isValidDateOnly('17-08-2026')).toBe(false)
    })

    it('isValidTimezone', () => {
      expect(isValidTimezone('Asia/Jakarta')).toBe(true)
      expect(isValidTimezone('Mars/Olympus')).toBe(false)
    })

    it('hasAtMostTwoDecimals', () => {
      expect(hasAtMostTwoDecimals(33.33)).toBe(true)
      expect(hasAtMostTwoDecimals(33.333)).toBe(false)
    })
  })
})
