import { describe, it, expect } from 'vitest'
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
} from './master.js'

const CODE_PATTERN = /^[A-Z0-9]+(_[A-Z0-9]+)*$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

const masters = {
  DEPARTMENTS,
  JOB_TITLES,
  OFFICE_LOCATIONS,
  WORK_SHIFTS,
  LEAVE_TYPES,
  HOLIDAYS,
  TRAINING_CATEGORIES,
  KPI_TEMPLATES,
}

describe('seed master data', () => {
  for (const [name, rows] of Object.entries(masters)) {
    it(`${name}: code unik & format UPPER_SNAKE`, () => {
      const codes = rows.map((r) => r.code)
      expect(new Set(codes).size).toBe(codes.length)
      for (const code of codes) expect(code).toMatch(CODE_PATTERN)
    })
  }

  it('department parent selalu didefinisikan lebih dulu', () => {
    const seen = new Set<string>()
    for (const d of DEPARTMENTS) {
      if (d.parentCode) expect(seen.has(d.parentCode)).toBe(true)
      seen.add(d.code)
    }
  })

  it('work shift memakai format HH:mm & hari ISO 1–7', () => {
    for (const s of WORK_SHIFTS) {
      expect(s.startTime).toMatch(TIME_PATTERN)
      expect(s.endTime).toMatch(TIME_PATTERN)
      for (const d of s.workDays) {
        expect(d).toBeGreaterThanOrEqual(1)
        expect(d).toBeLessThanOrEqual(7)
      }
    }
  })

  it('office location berkoordinat valid & radius positif', () => {
    for (const o of OFFICE_LOCATIONS) {
      expect(Math.abs(o.latitude)).toBeLessThanOrEqual(90)
      expect(Math.abs(o.longitude)).toBeLessThanOrEqual(180)
      expect(o.radiusMeters).toBeGreaterThan(0)
    }
  })

  it('holiday bertanggal ISO valid', () => {
    for (const h of HOLIDAYS) {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(new Date(h.date).getTime())).toBe(false)
    }
  })

  it('KPI template: total bobot indikator = 100 & referensi valid', () => {
    const jobCodes = new Set(JOB_TITLES.map((j) => j.code))
    const deptCodes = new Set(DEPARTMENTS.map((d) => d.code))
    for (const t of KPI_TEMPLATES) {
      const total = t.indicators.reduce((sum, i) => sum + i.weight, 0)
      expect(total).toBe(100)
      if (t.jobTitleCode) expect(jobCodes.has(t.jobTitleCode)).toBe(true)
      if (t.departmentCode) expect(deptCodes.has(t.departmentCode)).toBe(true)
      for (const i of t.indicators) {
        if (i.type === 'QUALITATIVE') expect(i.target).toBeUndefined()
      }
    }
  })

  it('penugasan Super Admin merujuk master yang ada', () => {
    expect(JOB_TITLES.some((j) => j.code === SUPER_ADMIN_ASSIGNMENT.jobTitleCode)).toBe(true)
    expect(DEPARTMENTS.some((d) => d.code === SUPER_ADMIN_ASSIGNMENT.departmentCode)).toBe(true)
    expect(OFFICE_LOCATIONS.some((o) => o.code === SUPER_ADMIN_ASSIGNMENT.officeLocationCode)).toBe(true)
    expect(WORK_SHIFTS.some((s) => s.code === SUPER_ADMIN_ASSIGNMENT.workShiftCode)).toBe(true)
  })
})
