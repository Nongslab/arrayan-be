import { describe, expect, it } from 'vitest'
import { evaluateDay, localDate, shiftBounds, zonedTimeToUtc, type DayInput, type ShiftRule } from './attendance.engine.js'

const TZ = 'Asia/Jakarta'
const REGULAR: ShiftRule = { startTime: '08:00', endTime: '17:00', lateToleranceMinutes: 15, workDays: [1, 2, 3, 4, 5], isOvernight: false }
const NIGHT: ShiftRule = { startTime: '22:00', endTime: '06:00', lateToleranceMinutes: 10, workDays: [1, 2, 3, 4, 5], isOvernight: true }
/** Waktu lokal Jakarta → instant. */
const at = (local: string) => new Date(`${local}:00+07:00`)

function day(overrides: Partial<DayInput>): DayInput {
  return {
    date: '2026-11-16', // Senin
    shift: REGULAR,
    timeZone: TZ,
    logs: [],
    isHoliday: false,
    leaveCategory: null,
    now: at('2026-11-20T12:00'),
    ...overrides,
  }
}

describe('zona waktu', () => {
  it('jam lokal Jakarta → UTC', () => {
    expect(zonedTimeToUtc('2026-11-16', '08:00', TZ).toISOString()).toBe('2026-11-16T01:00:00.000Z')
    expect(zonedTimeToUtc('2026-11-16', '05:30', TZ).toISOString()).toBe('2026-11-15T22:30:00.000Z')
  })

  it('zona lain (Makassar +08:00)', () => {
    expect(zonedTimeToUtc('2026-11-16', '08:00', 'Asia/Makassar').toISOString()).toBe('2026-11-16T00:00:00.000Z')
  })

  it('tanggal lokal dari instant', () => {
    expect(localDate(new Date('2026-11-16T18:00:00Z'), TZ)).toBe('2026-11-17')
  })

  it('shift malam berakhir keesokan hari', () => {
    const { start, end } = shiftBounds('2026-11-16', NIGHT, TZ)
    expect(start.toISOString()).toBe('2026-11-16T15:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-16T23:00:00.000Z')
  })
})

describe('evaluateDay', () => {
  it('tepat waktu termasuk tepat di batas toleransi', () => {
    const r = evaluateDay(day({ logs: [at('2026-11-16T08:15'), at('2026-11-16T17:05')] }))
    expect(r).toMatchObject({ status: 'PRESENT_ON_TIME', lateMinutes: 0 })
    expect(r.clockOut?.toISOString()).toBe(at('2026-11-16T17:05').toISOString())
  })

  it('terlambat dihitung dari jam mulai shift', () => {
    const r = evaluateDay(day({ logs: [at('2026-11-16T08:16')] }))
    expect(r).toMatchObject({ status: 'LATE', lateMinutes: 16, clockOut: null })
  })

  it('log pertama = masuk, log terakhir = pulang (log ganda di tengah diabaikan)', () => {
    const r = evaluateDay(day({ logs: [at('2026-11-16T12:00'), at('2026-11-16T07:50'), at('2026-11-16T17:30')] }))
    expect(r.clockIn?.toISOString()).toBe(at('2026-11-16T07:50').toISOString())
    expect(r.clockOut?.toISOString()).toBe(at('2026-11-16T17:30').toISOString())
  })

  it('log hari lain tidak terhitung', () => {
    const r = evaluateDay(day({ logs: [at('2026-11-17T08:00')] }))
    expect(r.status).toBe('ABSENT')
  })

  it('tanpa log: SCHEDULED sebelum batas, ABSENT sesudahnya', () => {
    expect(evaluateDay(day({ now: at('2026-11-16T08:10') })).status).toBe('SCHEDULED')
    expect(evaluateDay(day({ now: at('2026-11-16T08:16') })).status).toBe('ABSENT')
    expect(evaluateDay(day({ now: at('2026-11-10T09:00') })).status).toBe('SCHEDULED') // tanggal di masa depan
  })

  it('cuti & sakit mengalahkan status lain', () => {
    expect(evaluateDay(day({ leaveCategory: 'ANNUAL' })).status).toBe('ON_LEAVE')
    expect(evaluateDay(day({ leaveCategory: 'SICK', logs: [at('2026-11-16T09:00')] })).status).toBe('SICK')
  })

  it('hari libur & bukan hari kerja', () => {
    expect(evaluateDay(day({ isHoliday: true })).status).toBe('HOLIDAY')
    const sunday = evaluateDay(day({ date: '2026-11-22' }))
    expect(sunday).toMatchObject({ status: 'DAY_OFF', scheduledStart: null })
  })

  it('shift malam: masuk 22:20 terlambat, pulang esok pagi dihitung di tanggal mulai', () => {
    const r = evaluateDay(day({ shift: NIGHT, logs: [at('2026-11-16T22:20'), at('2026-11-17T06:10')] }))
    expect(r).toMatchObject({ status: 'LATE', lateMinutes: 20 })
    expect(r.clockOut?.toISOString()).toBe(at('2026-11-17T06:10').toISOString())
  })

  it('shift malam: log pagi milik shift sebelumnya, bukan shift hari ini', () => {
    const r = evaluateDay(day({ shift: NIGHT, date: '2026-11-17', logs: [at('2026-11-17T06:10')] }))
    expect(r.status).toBe('ABSENT')
  })
})
