import { describe, expect, it } from 'vitest'
import { addDays, addMonths, fromDateOnly, toDateOnly } from './dates.js'

const add = (date: string, months: number) => toDateOnly(addMonths(fromDateOnly(date), months))

describe('dates', () => {
  it('addMonths biasa & lintas tahun', () => {
    expect(add('2026-01-15', 6)).toBe('2026-07-15')
    expect(add('2026-09-10', 6)).toBe('2027-03-10')
  })

  it('addMonths membulatkan ke akhir bulan, tidak meluber', () => {
    expect(add('2026-08-31', 6)).toBe('2027-02-28')
    expect(add('2027-08-31', 6)).toBe('2028-02-29')
    expect(add('2026-03-31', 1)).toBe('2026-04-30')
  })

  it('addDays & konversi', () => {
    expect(toDateOnly(addDays(fromDateOnly('2026-12-30'), 3))).toBe('2027-01-02')
  })
})
