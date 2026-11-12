import { describe, expect, it } from 'vitest'
import { eachDate } from '../../src/modules/leave/leave.rules.js'
import { buildDemoPlan, DEMO_EMAIL_DOMAIN, DEMO_NIK_PREFIX, isWorkingDay, workingDayFrom } from './plan.js'

// Kamis; Senin 2030-03-18 dijadikan hari libur
const TODAY = '2030-03-14'
const HOLIDAYS = new Set(['2030-03-18'])
const NOW = new Date('2030-03-14T10:00:00+07:00')
const plan = buildDemoPlan({ today: TODAY, now: NOW, holidays: HOLIDAYS })
const byKey = new Map(plan.employees.map((e) => [e.key, e]))
const jakartaDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d)

describe('rencana data demo', () => {
  it('deterministik', () => {
    expect(buildDemoPlan({ today: TODAY, now: NOW, holidays: HOLIDAYS })).toEqual(plan)
  })

  it('karyawan: penanda demo, NIK/email unik, atasan didefinisikan lebih dulu', () => {
    expect(plan.employees.length).toBeGreaterThanOrEqual(20)
    const niks = plan.employees.map((e) => e.nik)
    const emails = plan.employees.flatMap((e) => (e.email ? [e.email] : []))
    expect(new Set(niks).size).toBe(niks.length)
    expect(new Set(emails).size).toBe(emails.length)
    for (const nik of niks) expect(nik.startsWith(DEMO_NIK_PREFIX)).toBe(true)
    for (const email of emails) expect(email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true)

    const seen = new Set<string>()
    for (const e of plan.employees) {
      if (e.managerKey) expect(seen.has(e.managerKey)).toBe(true)
      seen.add(e.key)
    }
  })

  it('variasi status akun & kepegawaian untuk demo', () => {
    const accounts = new Set(plan.employees.map((e) => e.account))
    expect(accounts).toEqual(new Set(['ACTIVE', 'PENDING_ACTIVATION', 'DISABLED', 'NONE']))
    expect(plan.employees.some((e) => e.role === 'SUPER_ADMIN')).toBe(true)
    expect(plan.employees.some((e) => e.status === 'INACTIVE' && e.exitDate !== null)).toBe(true)
    // Probation yang berakhir ≤ 30 hari (widget pengingat probation)
    const ending = plan.employees.filter((e) => e.probationEndDate && e.probationEndDate >= TODAY && e.probationEndDate <= '2030-04-13')
    expect(ending.length).toBeGreaterThan(0)
    expect(plan.employees.filter((e) => e.employmentType !== 'PROBATION').every((e) => e.probationEndDate === null)).toBe(true)
  })

  it('ulang tahun hari ini & dalam seminggu', () => {
    const md = (d: string) => d.slice(5)
    expect(plan.employees.some((e) => md(e.birthDate) === '03-14')).toBe(true)
    expect(plan.employees.some((e) => md(e.birthDate) > '03-14' && md(e.birthDate) <= '03-21')).toBe(true)
  })

  it('cuti: hari kerja, berurutan, mencakup hari ini', () => {
    for (const l of plan.leaves) {
      expect(l.startDate <= l.endDate).toBe(true)
      expect(isWorkingDay(l.startDate, HOLIDAYS)).toBe(true)
      expect(byKey.has(l.employeeKey)).toBe(true)
    }
    const today = plan.leaves.filter((l) => l.startDate <= TODAY && l.endDate >= TODAY)
    expect(today.map((l) => l.leaveTypeCode).sort()).toEqual(['ANNUAL', 'SICK', 'SICK'])
  })

  it('absensi: hanya hari kerja, tidak di masa depan, tidak saat cuti, tidak setelah keluar', () => {
    expect(plan.attendance.length).toBeGreaterThan(300)
    const leaveDays = new Set(
      plan.leaves.filter((l) => l.status !== 'CANCELLED').flatMap((l) => eachDate(l.startDate, l.endDate).map((d) => `${l.employeeKey}:${d}`)),
    )
    for (const log of plan.attendance) {
      const date = jakartaDate(log.occurredAt)
      const e = byKey.get(log.employeeKey)!
      expect(isWorkingDay(date, HOLIDAYS)).toBe(true)
      expect(log.occurredAt.getTime()).toBeLessThanOrEqual(NOW.getTime())
      expect(date >= e.joinDate).toBe(true)
      if (e.exitDate) expect(date <= e.exitDate).toBe(true)
      expect(leaveDays.has(`${log.employeeKey}:${date}`)).toBe(false)
      if (e.account !== 'ACTIVE') expect(log.source).toBe('FINGERPRINT')
      expect(log.source === 'APP').toBe(log.gpsOffset !== null)
    }
    // Ada yang terlambat hari ini, dan belum ada clock-out (jam 10 pagi)
    const todayLogs = plan.attendance.filter((l) => jakartaDate(l.occurredAt) === TODAY)
    expect(todayLogs.some((l) => l.employeeKey === 'OPS_S3' && l.kind === 'IN')).toBe(true)
    expect(todayLogs.every((l) => l.kind === 'IN')).toBe(true)
  })

  it('training & event: ada yang lalu, mendatang, dan batal', () => {
    expect(plan.trainings.some((t) => t.date < TODAY && t.participants.some((p) => p.remarks))).toBe(true)
    expect(plan.trainings.some((t) => t.date > TODAY && t.status === 'SCHEDULED')).toBe(true)
    expect(plan.trainings.some((t) => t.status === 'CANCELLED')).toBe(true)
    for (const t of plan.trainings) for (const p of t.participants) expect(byKey.has(p.employeeKey)).toBe(true)
    expect(plan.events.every((e) => e.startDate > TODAY)).toBe(true)
  })
})

describe('workingDayFrom', () => {
  it('melewati akhir pekan & hari libur', () => {
    expect(workingDayFrom('2030-03-14', 0, HOLIDAYS)).toBe('2030-03-14')
    expect(workingDayFrom('2030-03-14', 2, HOLIDAYS)).toBe('2030-03-19') // Jum, (Sab, Min, Sen libur) → Sel
    expect(workingDayFrom('2030-03-16', 0, HOLIDAYS)).toBe('2030-03-19') // Sabtu → hari kerja berikutnya
    expect(workingDayFrom('2030-03-19', -1, HOLIDAYS)).toBe('2030-03-15')
  })
})
