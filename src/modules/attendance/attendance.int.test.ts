import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { bearer, createTestApp, createUserWithRole, loginAs, uniqueSuffix } from '../../test/helpers.js'
import { todayInJakarta } from '../employee/employee.schema.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `IATT-${SUFFIX}-${name}`
const email = (name: string) => `iatt.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!

/**
 * Senin minimal 14 hari sebelum hari ini (semua tanggal uji sudah lewat) yang minggunya
 * (Senin s.d. Senin berikutnya) bebas hari libur — agar test tidak bergantung pada kalender.
 */
async function pastMondayWithoutHolidays(): Promise<string> {
  const holidays = new Set(
    (await prisma.holiday.findMany({ where: { isActive: true }, select: { date: true } })).map((h) => toDateOnly(h.date)),
  )
  let d = addDays(fromDateOnly(todayInJakarta()), -14)
  for (;;) {
    while (d.getUTCDay() !== 1) d = addDays(d, -1)
    const week = Array.from({ length: 8 }, (_, i) => toDateOnly(addDays(d, i)))
    if (!week.some((date) => holidays.has(date))) return toDateOnly(d)
    d = addDays(d, -1)
  }
}
let MON = ''
const day = (offset: number) => toDateOnly(addDays(fromDateOnly(MON), offset))
/** Waktu lokal Jakarta pada hari ke-`offset`. */
const at = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00+07:00`)

interface Day {
  date: string
  status: string
  lateMinutes: number
  clockIn: string | null
  clockOut: string | null
}

describe('kehadiran harian (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let staffTitleId: string
  let holidayId: string

  async function employeeWithLogin(name: string, extra: Record<string, unknown> = {}) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: {
        nik: nik(name),
        fullName: `Hadir ${name}`,
        employmentType: 'KARTAP',
        joinDate: day(0),
        jobTitleId: staffTitleId,
        account: { email: email(name) },
        ...extra,
      },
    })
    expect(created.statusCode).toBe(201)
    await app.inject({
      method: 'POST',
      url: '/api/auth/activate',
      payload: { token: tokenFrom(created.json().invitation.devActivationLink), password: 'HadirAman123!' },
    })
    return {
      id: created.json().data.id as string,
      auth: bearer(await loginAs(app, { email: email(name), password: 'HadirAman123!' })),
    }
  }

  const logs = (employeeId: string, times: Date[]) =>
    prisma.attendanceLog.createMany({ data: times.map((occurredAt) => ({ employeeId, occurredAt, source: 'MANUAL' as const })) })

  const myDays = async (auth: Record<string, string>, from: string, to: string) => {
    const res = await app.inject({ method: 'GET', url: `/api/attendance/me?from=${from}&to=${to}`, headers: auth })
    expect(res.statusCode).toBe(200)
    return res.json() as { data: Day[]; summary: Record<string, number> }
  }

  beforeAll(async () => {
    app = await createTestApp()
    MON = await pastMondayWithoutHolidays()
    admin = bearer(await loginAs(app))
    staffTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
    holidayId = (
      await prisma.holiday.create({
        data: { code: `IATT_${SUFFIX}`, name: 'Libur Uji', date: fromDateOnly(day(7)), kind: 'COMPANY' },
      })
    ).id
  })

  afterAll(async () => {
    const ids = (await prisma.employee.findMany({ where: { nik: { startsWith: 'IATT-' } }, select: { id: true } })).map((e) => e.id)
    await prisma.attendanceLog.deleteMany({ where: { employeeId: { in: ids } } })
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } })
    await prisma.employee.deleteMany({ where: { id: { in: ids } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await prisma.holiday.delete({ where: { id: holidayId } })
    await prisma.workShift.deleteMany({ where: { code: { startsWith: 'IATT_' } } })
    await app.close()
    await prisma.$disconnect()
  })

  it('status satu minggu: tepat waktu, terlambat, absen, cuti, sakit, akhir pekan, libur', async () => {
    const user = await employeeWithLogin('WEEK')
    await logs(user.id, [at(0, '07:55'), at(0, '17:10'), at(1, '08:20'), at(1, '17:00')])

    const leaveTypes = Object.fromEntries((await prisma.leaveType.findMany()).map((t) => [t.code, t.id]))
    for (const [code, offset] of [['ANNUAL', 3], ['SICK', 4]] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/leaves',
        headers: user.auth,
        payload: { leaveTypeId: leaveTypes[code], startDate: day(offset), endDate: day(offset) },
      })
      expect(res.statusCode).toBe(201)
      await prisma.leaveRequest.update({ where: { id: res.json().data.id }, data: { status: 'APPROVED' } })
    }

    // Mulai sehari sebelum tanggal masuk → tanggal itu tidak ditampilkan
    const { data, summary } = await myDays(user.auth, day(-1), day(7))
    expect(data.map((d) => [d.date, d.status, d.lateMinutes])).toEqual([
      [day(0), 'PRESENT_ON_TIME', 0],
      [day(1), 'LATE', 20],
      [day(2), 'ABSENT', 0],
      [day(3), 'ON_LEAVE', 0],
      [day(4), 'SICK', 0],
      [day(5), 'DAY_OFF', 0],
      [day(6), 'DAY_OFF', 0],
      [day(7), 'HOLIDAY', 0],
    ])
    expect(data[0]!.clockIn).toBe(at(0, '07:55').toISOString())
    expect(data[0]!.clockOut).toBe(at(0, '17:10').toISOString())
    expect(summary).toMatchObject({ PRESENT_ON_TIME: 1, LATE: 1, ABSENT: 1, ON_LEAVE: 1, SICK: 1, DAY_OFF: 2, HOLIDAY: 1, totalLateMinutes: 20 })
  })

  it('cuti yang dibatalkan tidak lagi menutupi absen', async () => {
    const user = await employeeWithLogin('CANCELLED')
    const annual = (await prisma.leaveType.findUniqueOrThrow({ where: { code: 'ANNUAL' } })).id
    const leave = await app.inject({
      method: 'POST',
      url: '/api/leaves',
      headers: user.auth,
      payload: { leaveTypeId: annual, startDate: day(2), endDate: day(2) },
    })
    await prisma.leaveRequest.update({ where: { id: leave.json().data.id }, data: { status: 'APPROVED' } })
    expect((await myDays(user.auth, day(2), day(2))).data[0]!.status).toBe('ON_LEAVE')

    await app.inject({
      method: 'POST',
      url: `/api/leaves/${leave.json().data.id}/cancel`,
      headers: admin,
      payload: { reason: 'Batal cuti' },
    })
    expect((await myDays(user.auth, day(2), day(2))).data[0]!.status).toBe('ABSENT')
  })

  it('shift malam: pulang keesokan pagi tetap dihitung di tanggal mulai shift', async () => {
    const night = await prisma.workShift.create({
      data: {
        code: `IATT_NIGHT_${SUFFIX}`,
        name: 'Malam Uji',
        startTime: '22:00',
        endTime: '06:00',
        lateToleranceMinutes: 10,
        workDays: [1, 2, 3, 4, 5],
        isOvernight: true,
      },
    })
    const user = await employeeWithLogin('NIGHT', { workShiftId: night.id })
    await logs(user.id, [at(0, '22:05'), at(1, '06:02'), at(1, '22:30'), at(2, '06:00')])

    const { data } = await myDays(user.auth, day(0), day(2))
    expect(data.map((d) => [d.status, d.lateMinutes])).toEqual([
      ['PRESENT_ON_TIME', 0],
      ['LATE', 30],
      ['ABSENT', 0],
    ])
    expect(data[0]!.clockOut).toBe(at(1, '06:02').toISOString())
  })

  it('validasi & akses', async () => {
    const user = await employeeWithLogin('ACCESS')
    const bad = (q: string) => app.inject({ method: 'GET', url: `/api/attendance/me?${q}`, headers: user.auth })
    expect((await bad(`from=${day(5)}&to=${day(0)}`)).statusCode).toBe(400)
    expect((await bad('from=2026-01-01&to=2026-06-30')).statusCode).toBe(400)
    expect((await bad('')).statusCode).toBe(200) // default awal bulan s.d. hari ini

    const noEmployee = bearer(await loginAs(app, await createUserWithRole('STAFF')))
    expect((await app.inject({ method: 'GET', url: '/api/attendance/me', headers: noEmployee })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/attendance/me' })).statusCode).toBe(401)
  })
})
