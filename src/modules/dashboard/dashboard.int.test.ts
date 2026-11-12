import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { bearer, createTestApp, createUserWithRole, loginAs, uniqueSuffix } from '../../test/helpers.js'
import { pastMondayWithoutHolidays } from '../../test/calendar.js'

const SUFFIX = uniqueSuffix()
let MON = ''
const day = (offset: number) => toDateOnly(addDays(fromDateOnly(MON), offset))
const at = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00+07:00`)

interface Person {
  employee: { id: string; fullName: string }
}

describe('dashboard 5-in-1 (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  const ids: Record<string, string> = {}
  const types: Record<string, string> = {}
  let categoryId: string

  async function employee(key: string, extra: Record<string, unknown> = {}) {
    const jobTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
    const row = await prisma.employee.create({
      data: {
        nik: `IDSB-${SUFFIX}-${key}`,
        fullName: `Dash ${key} ${SUFFIX}`,
        jobTitleId,
        employmentType: 'KARTAP',
        joinDate: fromDateOnly('2025-01-01'),
        ...extra,
      },
    })
    ids[key] = row.id
    return row.id
  }

  const leave = (employeeId: string, code: string, status: 'PENDING' | 'APPROVED', reason: string) =>
    prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: types[code]!,
        startDate: fromDateOnly(day(1)),
        endDate: fromDateOnly(day(1)),
        days: 1,
        daysByYear: { [day(1).slice(0, 4)]: 1 },
        status,
        reason,
      },
    })

  const training = (title: string, offset: number, status: 'SCHEDULED' | 'CANCELLED' = 'SCHEDULED') =>
    prisma.training.create({
      data: { title: `${title} ${SUFFIX}`, categoryId, startAt: at(offset, '09:00'), endAt: at(offset, '12:00'), status },
    })

  const dashboard = async (headers: Record<string, string>, query = `date=${day(1)}`) => {
    const res = await app.inject({ method: 'GET', url: `/api/dashboard/today?${query}`, headers })
    expect(res.statusCode).toBe(200)
    return res
  }
  const ours = (list: Person[]) => list.filter((p) => p.employee.fullName.includes(SUFFIX)).map((p) => p.employee.fullName.split(' ')[1])

  beforeAll(async () => {
    app = await createTestApp()
    MON = await pastMondayWithoutHolidays()
    admin = bearer(await loginAs(app))
    for (const t of await prisma.leaveType.findMany()) types[t.code] = t.id
    categoryId = (await prisma.trainingCategory.findUniqueOrThrow({ where: { code: 'EXTERNAL' } })).id

    await employee('LATE')
    await employee('ONTIME')
    await employee('GONE')
    await prisma.attendanceLog.createMany({
      data: [
        { employeeId: ids.LATE!, occurredAt: at(1, '08:40'), source: 'MANUAL' },
        { employeeId: ids.ONTIME!, occurredAt: at(1, '08:00'), source: 'MANUAL' },
        { employeeId: ids.GONE!, occurredAt: at(1, '09:00'), source: 'MANUAL' },
      ],
    })
    await prisma.employee.update({ where: { id: ids.GONE! }, data: { status: 'INACTIVE', exitDate: fromDateOnly(day(3)) } })

    await leave(await employee('VACATION'), 'ANNUAL', 'APPROVED', 'RAHASIA-liburan-keluarga')
    await leave(await employee('WAITING'), 'ANNUAL', 'PENDING', 'menunggu persetujuan')
    await leave(await employee('SICKP'), 'SICK', 'PENDING', 'RAHASIA-demam-tinggi')
    await leave(await employee('SICKA'), 'SICK', 'APPROVED', 'tipes')

    const birth = `1992-${day(1).slice(5)}`
    await employee('BIRTHDAY', { birthDate: fromDateOnly(birth) })

    await training('Soon', 3)
    await training('Far', 20)
    await training('Cancelled', 2, 'CANCELLED')
  })

  afterAll(async () => {
    const all = Object.values(ids)
    await prisma.attendanceLog.deleteMany({ where: { employeeId: { in: all } } })
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: all } } })
    await prisma.training.deleteMany({ where: { title: { contains: SUFFIX } } })
    await prisma.employee.deleteMany({ where: { id: { in: all } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await app.close()
    await prisma.$disconnect()
  })

  it('lima widget berisi data yang tepat', async () => {
    const { data } = (await dashboard(admin)).json()
    expect(data.date).toBe(day(1))

    expect(ours(data.late)).toEqual(['LATE'])
    expect(data.late.find((l: Person) => l.employee.id === ids.LATE).lateMinutes).toBe(40)

    expect(ours(data.onLeave)).toEqual(['VACATION'])
    expect(data.onLeave.find((l: Person) => l.employee.id === ids.VACATION).leaveType.code).toBe('ANNUAL')

    expect(ours(data.sick).sort()).toEqual(['SICKA', 'SICKP'])
    expect(data.sick.find((s: Person) => s.employee.id === ids.SICKP).status).toBe('PENDING')

    expect(ours(data.birthdays)).toEqual(['BIRTHDAY'])

    const titles = data.trainings.filter((t: { title: string }) => t.title.includes(SUFFIX)).map((t: { title: string }) => t.title.split(' ')[0])
    expect(titles).toEqual(['Soon'])

    expect(data.counts.late).toBe(data.late.length)
  })

  it('tanpa data pribadi/alasan & tanpa karyawan nonaktif', async () => {
    const res = await dashboard(admin)
    expect(res.body).not.toMatch(/RAHASIA|reason|birthDate|1992-/)
    expect(res.body).not.toContain(ids.GONE)
  })

  it('jendela training dapat diatur', async () => {
    const { data } = (await dashboard(admin, `date=${day(1)}&upcomingTrainingDays=30`)).json()
    const titles = data.trainings.filter((t: { title: string }) => t.title.includes(SUFFIX)).map((t: { title: string }) => t.title.split(' ')[0])
    expect(titles).toEqual(['Soon', 'Far'])
  })

  it('terlihat oleh semua karyawan; validasi', async () => {
    const staff = bearer(await loginAs(app, await createUserWithRole('STAFF')))
    expect(ours((await dashboard(staff)).json().data.late)).toEqual(['LATE'])
    expect((await dashboard(staff, '')).json().data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect((await app.inject({ method: 'GET', url: '/api/dashboard/today?date=2026-13-01', headers: staff })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/dashboard/today?upcomingTrainingDays=99', headers: staff })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/dashboard/today' })).statusCode).toBe(401)
  })
})
