import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { bearer, createTestApp, loginAs, uniqueSuffix } from '../../test/helpers.js'
import { todayInJakarta } from './employee.schema.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `IPER-${SUFFIX}-${name}`
const email = (name: string) => `iper.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!

/** Tanggal (yyyy-MM-dd) `days` hari dari hari ini, dengan tahun lahir `year`. */
function birthDateShifted(days: number, year = 1990): string {
  const base = new Date(`${todayInJakarta()}T00:00:00.000Z`)
  const shifted = new Date(base.getTime() + days * 86_400_000)
  return `${year}-${shifted.toISOString().slice(5, 10)}`
}

describe('data pribadi & ulang tahun (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let staffTitleId: string
  let deptId: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    staffTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
    deptId = (await prisma.department.create({ data: { code: `IPER_${SUFFIX}`, name: 'Dept Ulang Tahun' } })).id
  })

  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { nik: { startsWith: 'IPER-' } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await prisma.department.deleteMany({ where: { code: { startsWith: 'IPER_' } } })
    await app.close()
    await prisma.$disconnect()
  })

  const create = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: { jobTitleId: staffTitleId, departmentId: deptId, joinDate: '2024-01-02', ...payload },
    })

  describe('visibilitas data pribadi', () => {
    let selfId: string
    let otherId: string
    let staff: Record<string, string>

    beforeAll(async () => {
      const self = await create({
        nik: nik('SELF'),
        fullName: 'Sinta Sendiri',
        birthDate: '1995-04-10',
        gender: 'FEMALE',
        phone: '+62 812-3456-7890',
        personalEmail: 'Sinta.Pribadi@Contoh.test',
        address: 'Jl. Melati No. 1, Bandung',
        account: { email: email('self') },
      })
      expect(self.statusCode).toBe(201)
      selfId = self.json().data.id
      await app.inject({
        method: 'POST',
        url: '/api/auth/activate',
        payload: { token: tokenFrom(self.json().invitation.devActivationLink), password: 'Pribadi123!' },
      })
      staff = bearer(await loginAs(app, { email: email('self'), password: 'Pribadi123!' }))

      otherId = (await create({ nik: nik('OTHER'), fullName: 'Odi Lain', birthDate: '1990-01-01', phone: '0811111111' })).json().data.id
    })

    it('SUPER_ADMIN melihat data pribadi (email pribadi dinormalkan)', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/employees/${selfId}`, headers: admin })
      expect(res.json().data.personal).toEqual({
        birthDate: '1995-04-10',
        gender: 'FEMALE',
        phone: '+62 812-3456-7890',
        personalEmail: 'sinta.pribadi@contoh.test',
        address: 'Jl. Melati No. 1, Bandung',
      })
    })

    it('karyawan melihat data pribadinya sendiri, tetapi tidak milik orang lain', async () => {
      const own = await app.inject({ method: 'GET', url: `/api/employees/${selfId}`, headers: staff })
      expect(own.json().data.personal.phone).toBe('+62 812-3456-7890')

      const other = await app.inject({ method: 'GET', url: `/api/employees/${otherId}`, headers: staff })
      expect(other.statusCode).toBe(200)
      expect(other.json().data.personal).toBeNull()
      expect(other.body).not.toContain('0811111111')

      const list = await app.inject({ method: 'GET', url: `/api/employees?q=IPER-${SUFFIX}`, headers: staff })
      const byNik = Object.fromEntries(list.json().data.map((e: { nik: string; personal: unknown }) => [e.nik, e.personal]))
      expect(byNik[nik('SELF')]).not.toBeNull()
      expect(byNik[nik('OTHER')]).toBeNull()
    })

    it('PATCH mengubah & menghapus data pribadi, tercatat di audit log', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/employees/${otherId}`,
        headers: admin,
        payload: { phone: null, gender: 'MALE' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.personal).toMatchObject({ phone: null, gender: 'MALE', birthDate: '1990-01-01' })

      const [log] = await prisma.auditLog.findMany({
        where: { action: 'employee.update', entityId: otherId },
        orderBy: { seq: 'desc' },
        take: 1,
      })
      expect(log!.changes).toEqual({ phone: { from: '0811111111', to: null }, gender: { from: null, to: 'MALE' } })
    })

    it('validasi data pribadi', async () => {
      const cases: Array<[Record<string, unknown>, RegExp]> = [
        [{ birthDate: '2999-01-01' }, /masa depan/],
        [{ birthDate: '2025-06-01' }, /sebelum joinDate/],
        [{ phone: 'telepon saya' }, /telepon/],
        [{ gender: 'X' }, /gender/],
        [{ personalEmail: 'bukan-email' }, /email/],
      ]
      for (const [payload, message] of cases) {
        const res = await create({ nik: nik('BAD'), fullName: 'Data Salah', ...payload })
        expect(res.statusCode, JSON.stringify(payload)).toBe(400)
        expect(res.json().message).toMatch(message)
      }

      const patchAfterJoin = await app.inject({
        method: 'PATCH',
        url: `/api/employees/${otherId}`,
        headers: admin,
        payload: { joinDate: '1989-01-01' },
      })
      expect(patchAfterJoin.statusCode).toBe(400)
    })
  })

  describe('GET /api/employees/birthdays', () => {
    beforeAll(async () => {
      await create({ nik: nik('BD0'), fullName: 'Ulang Hari Ini', birthDate: birthDateShifted(0) })
      await create({ nik: nik('BD5'), fullName: 'Ulang Lima Hari', birthDate: birthDateShifted(5, 1988) })
      await create({ nik: nik('BD40'), fullName: 'Ulang Empat Puluh', birthDate: birthDateShifted(40) })
      const gone = await create({ nik: nik('BDOFF'), fullName: 'Sudah Keluar', birthDate: birthDateShifted(0) })
      await app.inject({
        method: 'PATCH',
        url: `/api/employees/${gone.json().data.id}/status`,
        headers: admin,
        payload: { status: 'INACTIVE' },
      })
    })

    it('default hari ini s.d. +30 hari, terurut, tanpa tahun lahir & tanpa karyawan nonaktif', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/employees/birthdays?departmentId=${deptId}`, headers: admin })
      expect(res.statusCode).toBe(200)
      const names = res.json().data.map((b: { fullName: string }) => b.fullName)
      expect(names).toEqual(['Ulang Hari Ini', 'Ulang Lima Hari'])

      const [first] = res.json().data
      expect(first.date).toBe(todayInJakarta())
      expect(first.birthday).toBe(todayInJakarta().slice(5))
      expect(res.body).not.toMatch(/1990-|1988-|birthDate/)
      expect(res.json().meta.from).toBe(todayInJakarta())
    })

    it('semua karyawan login boleh melihat (untuk widget), dan validasi rentang', async () => {
      const staffUser = (await prisma.user.findFirst({ where: { email: email('self') } }))!
      expect(staffUser).toBeTruthy()
      const staff = bearer(await loginAs(app, { email: email('self'), password: 'Pribadi123!' }))
      expect((await app.inject({ method: 'GET', url: '/api/employees/birthdays', headers: staff })).statusCode).toBe(200)

      const bad = (q: string) => app.inject({ method: 'GET', url: `/api/employees/birthdays?${q}`, headers: admin })
      expect((await bad('from=2026-12-31&to=2026-01-01')).statusCode).toBe(400)
      expect((await bad('from=2026-01-01&to=2027-06-01')).statusCode).toBe(400)
      expect((await app.inject({ method: 'GET', url: '/api/employees/birthdays' })).statusCode).toBe(401)
    })

    it('rentang eksplisit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/employees/birthdays?departmentId=${deptId}&from=${todayInJakarta()}&to=${new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)}`,
        headers: admin,
      })
      const names = res.json().data.map((b: { fullName: string }) => b.fullName)
      expect(names.filter((n: string) => n.startsWith('Ulang'))).toEqual([
        'Ulang Hari Ini',
        'Ulang Lima Hari',
        'Ulang Empat Puluh',
      ])
      expect(names).not.toContain('Sudah Keluar')
    })
  })
})
