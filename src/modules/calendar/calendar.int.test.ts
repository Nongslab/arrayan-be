import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { fromDateOnly } from '../../lib/dates.js'
import { bearer, createTestApp, loginAs, uniqueSuffix } from '../../test/helpers.js'

const SUFFIX = uniqueSuffix()
const email = (name: string) => `ical.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!
const RANGE = 'from=2030-03-01&to=2030-03-31'

interface Item {
  type: string
  id: string
  title: string
  startDate: string
  endDate: string
  allDay: boolean
  startTime: string | null
  endTime: string | null
  employee: { id: string; fullName: string } | null
  detail: Record<string, string> | null
}

describe('kalender perusahaan & personal (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  const people: Record<string, { id: string; auth: Record<string, string> }> = {}
  const ids: Record<string, string> = {}

  async function person(key: string, birthDate: string) {
    const jobTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
    const res = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: {
        nik: `ICAL-${SUFFIX}-${key}`,
        fullName: `Kalender ${key} ${SUFFIX}`,
        jobTitleId,
        employmentType: 'KARTAP',
        joinDate: '2025-01-01',
        birthDate,
        account: { email: email(key) },
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/auth/activate',
      payload: { token: tokenFrom(res.json().invitation.devActivationLink), password: 'Kalender123!' },
    })
    people[key] = { id: res.json().data.id, auth: bearer(await loginAs(app, { email: email(key), password: 'Kalender123!' })) }
  }

  const feed = async (headers: Record<string, string>, extra = '') => {
    const res = await app.inject({ method: 'GET', url: `/api/calendar?${RANGE}${extra}`, headers })
    expect(res.statusCode).toBe(200)
    return (res.json().data as Item[]).filter((i) => i.title.includes(SUFFIX))
  }
  const event = (payload: object, headers = admin) =>
    app.inject({ method: 'POST', url: '/api/calendar/events', headers, payload })

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    await person('A', '1990-03-15')
    await person('B', '1991-03-28')

    ids.holiday = (await prisma.holiday.create({ data: { code: `ICAL_${SUFFIX}`, name: `Libur ${SUFFIX}`, date: fromDateOnly('2030-03-10'), kind: 'COMPANY' } })).id

    const categoryId = (await prisma.trainingCategory.findUniqueOrThrow({ where: { code: 'INTERNAL' } })).id
    const training = (title: string, date: string, employeeId: string) =>
      prisma.training.create({
        data: {
          title: `${title} ${SUFFIX}`,
          categoryId,
          startAt: new Date(`${date}T09:00:00+07:00`),
          endAt: new Date(`${date}T12:00:00+07:00`),
          participants: { create: [{ employeeId }] },
        },
      })
    ids.trainingA = (await training('Training A', '2030-03-12', people.A!.id)).id
    ids.trainingB = (await training('Training B', '2030-03-18', people.B!.id)).id

    const annual = (await prisma.leaveType.findUniqueOrThrow({ where: { code: 'ANNUAL' } })).id
    const leave = (employeeId: string, start: string, end: string, status: 'PENDING' | 'APPROVED') =>
      prisma.leaveRequest.create({
        data: { employeeId, leaveTypeId: annual, startDate: fromDateOnly(start), endDate: fromDateOnly(end), days: 1, daysByYear: { 2030: 1 }, status },
      })
    ids.leaveA = (await leave(people.A!.id, '2030-03-25', '2030-03-26', 'PENDING')).id
    ids.leaveB = (await leave(people.B!.id, '2030-03-27', '2030-03-27', 'APPROVED')).id

    expect((await event({ title: `Gathering ${SUFFIX}`, location: 'Puncak', startDate: '2030-03-20', endDate: '2030-03-21' })).statusCode).toBe(201)
    expect((await event({ title: `Townhall ${SUFFIX}`, startDate: '2030-03-05', endDate: '2030-03-05', startTime: '09:00', endTime: '11:00' })).statusCode).toBe(201)
  })

  afterAll(async () => {
    const empIds = Object.values(people).map((p) => p.id)
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: empIds } } })
    await prisma.training.deleteMany({ where: { title: { contains: SUFFIX } } })
    await prisma.calendarEvent.deleteMany({ where: { title: { contains: SUFFIX } } })
    await prisma.holiday.deleteMany({ where: { code: `ICAL_${SUFFIX}` } })
    await prisma.employee.deleteMany({ where: { id: { in: empIds } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await app.close()
    await prisma.$disconnect()
  })

  it('kalender personal: libur, ulang tahun, event, training & cuti milik sendiri, terurut', async () => {
    const items = await feed(people.A!.auth)
    expect(items.map((i) => [i.type, i.startDate])).toEqual([
      ['EVENT', '2030-03-05'],
      ['HOLIDAY', '2030-03-10'],
      ['TRAINING', '2030-03-12'],
      ['BIRTHDAY', '2030-03-15'],
      ['EVENT', '2030-03-20'],
      ['BIRTHDAY', '2030-03-28'],
    ])
    expect(items.find((i) => i.type === 'TRAINING')).toMatchObject({ allDay: false, startTime: '09:00', endTime: '12:00', id: ids.trainingA })
    expect(items.find((i) => i.title.startsWith('Townhall'))).toMatchObject({ allDay: false, startTime: '09:00' })
    expect(items.find((i) => i.title.startsWith('Gathering'))).toMatchObject({ allDay: true, endDate: '2030-03-21' })

    // Cuti tidak memuat SUFFIX di judul → cek terpisah: hanya cuti milik A
    const res = await app.inject({ method: 'GET', url: `/api/calendar?${RANGE}`, headers: people.A!.auth })
    const leaves = (res.json().data as Item[]).filter((i) => i.type === 'LEAVE')
    expect(leaves.map((l) => l.id)).toEqual([ids.leaveA])
    expect(leaves[0]).toMatchObject({ title: 'Cuti Tahunan', detail: { status: 'PENDING' } })
    expect(res.body).not.toContain(ids.trainingB)
  })

  it('tampilan master (HR): seluruh training & cuti dengan nama karyawan; staf 403', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/calendar?${RANGE}&view=master`, headers: admin })
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Item[]
    expect(data.filter((i) => i.type === 'TRAINING' && i.title.includes(SUFFIX))).toHaveLength(2)
    const leaves = data.filter((i) => i.type === 'LEAVE' && [ids.leaveA, ids.leaveB].includes(i.id))
    expect(leaves.map((l) => l.title)).toEqual([`Cuti Tahunan — Kalender A ${SUFFIX}`, `Cuti Tahunan — Kalender B ${SUFFIX}`])

    const staff = await app.inject({ method: 'GET', url: `/api/calendar?${RANGE}&view=master`, headers: people.A!.auth })
    expect(staff.statusCode).toBe(403)
  })

  it('event kantor: validasi, hanya HR, nonaktif tersembunyi + audit', async () => {
    expect((await event({ title: `Salah ${SUFFIX}`, startDate: '2030-03-10', endDate: '2030-03-09' })).statusCode).toBe(400)
    expect((await event({ title: `Salah ${SUFFIX}`, startDate: '2030-03-10', endDate: '2030-03-10', startTime: '09:00' })).statusCode).toBe(400)
    expect(
      (await event({ title: `Salah ${SUFFIX}`, startDate: '2030-03-10', endDate: '2030-03-10', startTime: '11:00', endTime: '09:00' })).statusCode,
    ).toBe(400)
    expect((await event({ title: `Staf ${SUFFIX}`, startDate: '2030-03-10', endDate: '2030-03-10' }, people.A!.auth)).statusCode).toBe(403)

    const id = (await prisma.calendarEvent.findFirstOrThrow({ where: { title: `Gathering ${SUFFIX}` } })).id
    const off = await app.inject({ method: 'PATCH', url: `/api/calendar/events/${id}`, headers: admin, payload: { isActive: false } })
    expect(off.json().data.isActive).toBe(false)
    expect((await feed(people.A!.auth)).some((i) => i.title.startsWith('Gathering'))).toBe(false)
    expect(await prisma.auditLog.count({ where: { action: 'calendar.event_deactivate', entityId: id } })).toBe(1)
  })

  it('validasi rentang', async () => {
    const bad = (q: string) => app.inject({ method: 'GET', url: `/api/calendar?${q}`, headers: admin })
    expect((await bad('from=2030-03-31&to=2030-03-01')).statusCode).toBe(400)
    expect((await bad('from=2030-01-01&to=2030-06-30')).statusCode).toBe(400)
    expect((await bad('from=2030-03-01')).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: `/api/calendar?${RANGE}` })).statusCode).toBe(401)
  })
})
