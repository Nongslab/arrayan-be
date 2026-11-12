import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { bearer, createTestApp, loginAs, uniqueSuffix } from '../../test/helpers.js'
import { pastMondayWithoutHolidays } from '../../test/calendar.js'

const SUFFIX = uniqueSuffix()
const email = (name: string) => `icor.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!
let MON = ''
const day = (offset: number) => toDateOnly(addDays(fromDateOnly(MON), offset))
const local = (offset: number, time: string) => `${day(offset)}T${time}:00+07:00`

describe('koreksi absensi oleh HR (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  const people: Record<string, { id: string; auth: Record<string, string> }> = {}

  async function person(key: string) {
    const jobTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
    const res = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: {
        nik: `ICOR-${SUFFIX}-${key}`,
        fullName: `Koreksi ${key}`,
        jobTitleId,
        employmentType: 'KARTAP',
        joinDate: day(0),
        account: { email: email(key) },
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/auth/activate',
      payload: { token: tokenFrom(res.json().invitation.devActivationLink), password: 'Koreksi123!' },
    })
    people[key] = { id: res.json().data.id, auth: bearer(await loginAs(app, { email: email(key), password: 'Koreksi123!' })) }
  }

  const correct = (employeeId: string, occurredAt: string, note = 'Lupa absen, dikonfirmasi atasan', headers = admin) =>
    app.inject({ method: 'POST', url: '/api/attendance/corrections', headers, payload: { employeeId, occurredAt, note } })
  const statusOf = async (employeeId: string, offset: number) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/attendance/employees/${employeeId}?from=${day(offset)}&to=${day(offset)}`,
      headers: admin,
    })
    return res.json().data[0] as { status: string; lateMinutes: number; clockIn: string | null; clockOut: string | null }
  }

  beforeAll(async () => {
    app = await createTestApp()
    MON = await pastMondayWithoutHolidays()
    admin = bearer(await loginAs(app))
    await person('A')
    await person('B')
  })

  afterAll(async () => {
    const ids = Object.values(people).map((p) => p.id)
    await prisma.attendanceLog.deleteMany({ where: { employeeId: { in: ids } } })
    await prisma.employee.deleteMany({ where: { id: { in: ids } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await app.close()
    await prisma.$disconnect()
  })

  it('lupa clock-out: log manual melengkapi jam pulang', async () => {
    const a = people.A!.id
    await prisma.attendanceLog.create({ data: { employeeId: a, occurredAt: new Date(local(0, '08:00')), source: 'APP' } })
    expect((await statusOf(a, 0)).clockOut).toBeNull()

    const res = await correct(a, local(0, '17:05'))
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({ source: 'MANUAL', note: 'Lupa absen, dikonfirmasi atasan', voided: false })

    const after = await statusOf(a, 0)
    expect(after.status).toBe('PRESENT_ON_TIME')
    expect(after.clockOut).toBe(new Date(local(0, '17:05')).toISOString())

    const [log] = await prisma.auditLog.findMany({ where: { action: 'attendance.correction_add', entityId: res.json().data.id } })
    expect(log!.changes).toMatchObject({ employeeId: a, localDate: day(0) })
  })

  it('lupa clock-in: ABSENT berubah menjadi hadir', async () => {
    const a = people.A!.id
    expect((await statusOf(a, 1)).status).toBe('ABSENT')
    await correct(a, local(1, '07:58'))
    expect((await statusOf(a, 1)).status).toBe('PRESENT_ON_TIME')
  })

  it('log salah dibatalkan: tidak dihitung lagi, tetap tercatat', async () => {
    const b = people.B!.id
    const wrong = await prisma.attendanceLog.create({ data: { employeeId: b, occurredAt: new Date(local(2, '07:30')), source: 'FINGERPRINT' } })
    await prisma.attendanceLog.create({ data: { employeeId: b, occurredAt: new Date(local(2, '08:40')), source: 'FINGERPRINT' } })
    expect((await statusOf(b, 2)).status).toBe('PRESENT_ON_TIME')

    const voidIt = (headers = admin, reason = 'Tercatat ganda oleh mesin') =>
      app.inject({ method: 'POST', url: `/api/attendance/logs/${wrong.id}/void`, headers, payload: { reason } })
    expect((await voidIt(people.B!.auth)).statusCode).toBe(403)
    const voided = await voidIt()
    expect(voided.statusCode).toBe(200)
    expect(voided.json().data).toMatchObject({ voided: true, voidReason: 'Tercatat ganda oleh mesin' })
    expect((await voidIt()).statusCode).toBe(409)

    expect(await statusOf(b, 2)).toMatchObject({ status: 'LATE', lateMinutes: 40 })

    const logs = (q: string) =>
      app.inject({ method: 'GET', url: `/api/attendance/logs?employeeId=${b}&from=${day(2)}&to=${day(2)}${q}`, headers: admin })
    expect((await logs('')).json().data).toHaveLength(1)
    expect((await logs('&includeVoided=true')).json().data).toHaveLength(2)
    expect(await prisma.auditLog.count({ where: { action: 'attendance.log_void', entityId: wrong.id } })).toBe(1)
  })

  it('validasi & akses', async () => {
    const a = people.A!.id
    const future = new Date(Date.now() + 3_600_000).toISOString()
    expect((await correct(a, future)).json().message).toMatch(/masa depan/)
    expect((await correct(a, local(-3, '08:00'))).json().message).toMatch(/tanggal masuk kerja/)
    expect((await correct(a, local(3, '08:00'), 'x')).statusCode).toBe(400)
    expect((await correct(a, '2026-11-16 08:00')).statusCode).toBe(400)
    expect((await correct(a, local(3, '08:00'), 'Mencoba sendiri', people.A!.auth)).statusCode).toBe(403)
    expect((await correct('00000000-0000-4000-8000-000000000000', local(3, '08:00'))).statusCode).toBe(404)

    const own = await app.inject({ method: 'GET', url: `/api/attendance/logs?employeeId=${a}&from=${day(0)}&to=${day(1)}`, headers: people.A!.auth })
    expect(own.statusCode).toBe(200)
    expect(own.json().data.length).toBeGreaterThanOrEqual(3)
    const other = await app.inject({ method: 'GET', url: `/api/attendance/logs?employeeId=${a}&from=${day(0)}&to=${day(1)}`, headers: people.B!.auth })
    expect(other.statusCode).toBe(404)
  })
})
