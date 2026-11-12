import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { bearer, createTestApp, loginAs, uniqueSuffix } from '../../test/helpers.js'
import { pastMondayWithoutHolidays } from '../../test/calendar.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `IREC-${SUFFIX}-${name}`
const email = (name: string) => `irec.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!

let MON = ''
const day = (offset: number) => toDateOnly(addDays(fromDateOnly(MON), offset))
const at = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00+07:00`)

interface RecapItem {
  employee: { nik: string; fullName: string }
  summary: Record<string, number>
  days?: Array<{ date: string; status: string }>
}

describe('rekap kehadiran (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let deptId: string
  const people: Record<string, { id: string; auth?: Record<string, string> }> = {}

  async function person(key: string, title: string, opts: { managerKey?: string; login?: boolean; fullName: string }) {
    const jobTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: title } })).id
    const res = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: {
        nik: nik(key),
        fullName: opts.fullName,
        employmentType: 'KARTAP',
        joinDate: day(0),
        jobTitleId,
        departmentId: deptId,
        managerId: opts.managerKey ? people[opts.managerKey]!.id : null,
        ...(opts.login ? { account: { email: email(key) } } : {}),
      },
    })
    expect(res.statusCode).toBe(201)
    const id = res.json().data.id as string
    let auth: Record<string, string> | undefined
    if (opts.login) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/activate',
        payload: { token: tokenFrom(res.json().invitation.devActivationLink), password: 'RekapAman123!' },
      })
      auth = bearer(await loginAs(app, { email: email(key), password: 'RekapAman123!' }))
    }
    people[key] = { id, auth }
  }

  const get = (url: string, headers: Record<string, string>) => app.inject({ method: 'GET', url, headers })
  const range = () => `from=${day(0)}&to=${day(4)}`
  const names = (items: RecapItem[]) => items.map((i) => i.employee.fullName)

  beforeAll(async () => {
    app = await createTestApp()
    MON = await pastMondayWithoutHolidays()
    admin = bearer(await loginAs(app))
    deptId = (await prisma.department.create({ data: { code: `IREC_${SUFFIX}`, name: 'Dept Rekap' } })).id

    // DIR (Management) — MGR → SPV → STF1, MGR → STF2; OUT tidak terkait
    await person('DIR', 'DIRECTOR', { fullName: 'Rekap Direktur', login: true })
    await person('MGR', 'MANAGER', { fullName: 'Rekap Manajer', login: true })
    await person('SPV', 'SUPERVISOR', { fullName: 'Rekap Supervisor', managerKey: 'MGR', login: true })
    await person('STF1', 'STAFF', { fullName: 'Rekap Staf Satu', managerKey: 'SPV', login: true })
    await person('STF2', 'STAFF', { fullName: 'Rekap Staf Dua', managerKey: 'MGR' })
    await person('OUT', 'STAFF', { fullName: 'Rekap Orang Luar', login: true })

    // STF1 telat 30 menit pada hari ke-1, tepat waktu hari ke-0
    await prisma.attendanceLog.createMany({
      data: [at(0, '08:00'), at(1, '08:30')].map((occurredAt) => ({ employeeId: people.STF1!.id, occurredAt, source: 'MANUAL' as const })),
    })
  })

  afterAll(async () => {
    const ids = Object.values(people).map((p) => p.id)
    await prisma.attendanceLog.deleteMany({ where: { employeeId: { in: ids } } })
    await prisma.employee.updateMany({ where: { id: { in: ids } }, data: { managerId: null } })
    await prisma.employee.deleteMany({ where: { id: { in: ids } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await prisma.department.deleteMany({ where: { code: { startsWith: 'IREC_' } } })
    await app.close()
    await prisma.$disconnect()
  })

  describe('GET /api/attendance/team', () => {
    it('atasan melihat seluruh bawahan (semua level), urut nama', async () => {
      const res = await get(`/api/attendance/team?${range()}`, people.MGR!.auth!)
      expect(res.statusCode).toBe(200)
      const data = res.json().data as RecapItem[]
      expect(names(data)).toEqual(['Rekap Staf Dua', 'Rekap Staf Satu', 'Rekap Supervisor'])
      const stf1 = data.find((i) => i.employee.fullName === 'Rekap Staf Satu')!
      expect(stf1.summary).toMatchObject({ PRESENT_ON_TIME: 1, LATE: 1, ABSENT: 3, totalLateMinutes: 30 })
      expect(stf1.days).toBeUndefined()
    })

    it('supervisor hanya melihat bawahannya; staf tanpa bawahan → kosong', async () => {
      const spv = await get(`/api/attendance/team?${range()}&includeDays=true`, people.SPV!.auth!)
      const data = spv.json().data as RecapItem[]
      expect(names(data)).toEqual(['Rekap Staf Satu'])
      expect(data[0]!.days!.map((d) => d.status)).toEqual(['PRESENT_ON_TIME', 'LATE', 'ABSENT', 'ABSENT', 'ABSENT'])

      const staff = await get(`/api/attendance/team?${range()}`, people.STF1!.auth!)
      expect(staff.json()).toMatchObject({ data: [], meta: { total: 0 } })
    })
  })

  describe('GET /api/attendance (perusahaan)', () => {
    it('SUPER_ADMIN & Management boleh; staf/manajer biasa 403', async () => {
      const url = `/api/attendance?${range()}&departmentId=${deptId}`
      const asAdmin = await get(url, admin)
      expect(asAdmin.statusCode).toBe(200)
      expect(asAdmin.json().meta.total).toBe(6)

      const asDirector = await get(url, people.DIR!.auth!)
      expect(asDirector.statusCode).toBe(200)

      expect((await get(url, people.MGR!.auth!)).statusCode).toBe(403)
      expect((await get(url, people.STF1!.auth!)).statusCode).toBe(403)
    })

    it('paginasi & validasi rentang', async () => {
      const page = await get(`/api/attendance?${range()}&departmentId=${deptId}&limit=2&page=2`, admin)
      expect(page.json().data).toHaveLength(2)
      expect(page.json().meta).toMatchObject({ page: 2, limit: 2, total: 6, from: day(0), to: day(4) })
      expect((await get('/api/attendance?from=2026-01-01&to=2026-12-31', admin)).statusCode).toBe(400)
    })

    it('karyawan yang keluar di tengah rentang tetap direkap sampai tanggal keluar', async () => {
      await app.inject({
        method: 'PATCH',
        url: `/api/employees/${people.STF2!.id}/status`,
        headers: admin,
        payload: { status: 'INACTIVE', exitDate: day(2) },
      })
      const res = await get(`/api/attendance?${range()}&departmentId=${deptId}&includeDays=true`, admin)
      const stf2 = (res.json().data as RecapItem[]).find((i) => i.employee.nik === nik('STF2'))!
      expect(stf2.days!.map((d) => d.date)).toEqual([day(0), day(1), day(2)])
    })
  })

  describe('GET /api/attendance/employees/:id', () => {
    const detail = (targetKey: string, headers: Record<string, string>) =>
      get(`/api/attendance/employees/${people[targetKey]!.id}?${range()}`, headers)

    it('diri sendiri, atasan di rantai atas, dan Management boleh', async () => {
      expect((await detail('STF1', people.STF1!.auth!)).statusCode).toBe(200)
      expect((await detail('STF1', people.SPV!.auth!)).statusCode).toBe(200)
      const byManager = await detail('STF1', people.MGR!.auth!)
      expect(byManager.statusCode).toBe(200)
      expect(byManager.json().summary.totalLateMinutes).toBe(30)
      expect((await detail('STF1', people.DIR!.auth!)).statusCode).toBe(200)
    })

    it('bawahan melihat atasan / orang luar → 404', async () => {
      expect((await detail('MGR', people.STF1!.auth!)).statusCode).toBe(404)
      expect((await detail('STF1', people.OUT!.auth!)).statusCode).toBe(404)
    })
  })
})
