import { describe, expect, it } from 'vitest'
import { birthdayInYear, birthdaysInRange } from './employee.birthdays.js'

const d = (value: string) => new Date(`${value}T00:00:00.000Z`)
const person = (name: string, birth: string) => ({ name, birthDate: d(birth) })

describe('employee birthdays', () => {
  it('29 Februari dirayakan 28 Februari di tahun non-kabisat', () => {
    expect(birthdayInYear(d('2000-02-29'), 2027)).toBe('2027-02-28')
    expect(birthdayInYear(d('2000-02-29'), 2028)).toBe('2028-02-29')
  })

  it('mengambil ulang tahun dalam rentang, terurut, tanpa tahun lahir', () => {
    const rows = [person('Citra', '1990-11-20'), person('Andi', '1985-11-13'), person('Budi', '1992-12-01')]
    const result = birthdaysInRange(rows, '2026-11-13', '2026-11-30')
    expect(result.map((r) => [r.employee.name, r.date, r.birthday])).toEqual([
      ['Andi', '2026-11-13', '11-13'],
      ['Citra', '2026-11-20', '11-20'],
    ])
  })

  it('rentang melewati pergantian tahun', () => {
    const rows = [person('Dewi', '1995-12-30'), person('Eko', '1993-01-02'), person('Fajar', '1990-06-01')]
    const result = birthdaysInRange(rows, '2026-12-25', '2027-01-05')
    expect(result.map((r) => r.date)).toEqual(['2026-12-30', '2027-01-02'])
  })

  it('batas rentang inklusif', () => {
    const rows = [person('Gita', '1991-03-10')]
    expect(birthdaysInRange(rows, '2026-03-10', '2026-03-10')).toHaveLength(1)
    expect(birthdaysInRange(rows, '2026-03-11', '2026-03-31')).toHaveLength(0)
  })
})
