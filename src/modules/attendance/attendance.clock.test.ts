import { describe, expect, it } from 'vitest'
import { shiftDateFor } from './attendance.clock.js'
import type { ShiftRule } from './attendance.engine.js'

const TZ = 'Asia/Jakarta'
const REGULAR: ShiftRule = { startTime: '08:00', endTime: '17:00', lateToleranceMinutes: 15, workDays: [1, 2, 3, 4, 5], isOvernight: false }
const NIGHT: ShiftRule = { startTime: '22:00', endTime: '06:00', lateToleranceMinutes: 10, workDays: [1, 2, 3, 4, 5], isOvernight: true }
const at = (local: string) => new Date(`${local}:00+07:00`)

describe('shiftDateFor', () => {
  it('shift reguler: tanggal hari ini', () => {
    expect(shiftDateFor(at('2026-11-16T07:55'), REGULAR, TZ)).toBe('2026-11-16')
    expect(shiftDateFor(at('2026-11-16T18:30'), REGULAR, TZ)).toBe('2026-11-16')
  })

  it('shift malam: clock-out pagi milik shift kemarin', () => {
    expect(shiftDateFor(at('2026-11-17T06:05'), NIGHT, TZ)).toBe('2026-11-16')
    expect(shiftDateFor(at('2026-11-16T21:50'), NIGHT, TZ)).toBe('2026-11-16')
  })

  it('di luar jendela mana pun → tanggal hari ini', () => {
    expect(shiftDateFor(at('2026-11-16T02:30'), REGULAR, TZ)).toBe('2026-11-16')
  })
})
