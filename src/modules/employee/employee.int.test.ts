import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { bearer, createTestApp, createUserWithRole, loginAs, uniqueSuffix } from '../../test/helpers.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `ITEST-${SUFFIX}-${name}`

interface Node {
  id: string
  nik: string
  jobTitle: { code: string; level: string }
  children: Node[]
}

describe('employee API (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let staffAuth: Record<string, string>
  const ids: Record<string, string> = {}
  const deptIds: Record<string, string> = {}

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    staffAuth = bearer(await loginAs(app, await createUserWithRole('STAFF')))

    const titles = Object.fromEntries(
      (await prisma.jobTitle.findMany({ where: { code: { in: ['DIRECTOR', 'MANAGER', 'STAFF'] } } })).map((t) => [t.code, t.id]),
    )
    const parent = await prisma.department.create({ data: { code: `ITEST_DIV_${SUFFIX}`, name: 'Divisi Test' } })
    const child = await prisma.department.create({
      data: { code: `ITEST_SUB_${SUFFIX}`, name: 'Sub Divisi Test', parentId: parent.id },
    })
    deptIds.parent = parent.id
    deptIds.child = child.id

    const create = async (key: string, data: { fullName: string; title: string; dept: string; manager?: string; type?: 'PROBATION' | 'KARTAP' | 'PKL' }) => {
      const employee = await prisma.employee.create({
        data: {
          nik: nik(key),
          fullName: data.fullName,
          jobTitleId: titles[data.title]!,
          departmentId: data.dept,
          managerId: data.manager ?? null,
          employmentType: data.type ?? 'KARTAP',
        },
      })
      ids[key] = employee.id
    }

    await create('DIR', { fullName: 'Dina Direktur', title: 'DIRECTOR', dept: parent.id })
    await create('MGR', { fullName: 'Mario Manajer', title: 'MANAGER', dept: parent.id, manager: ids.DIR })
    await create('S2', { fullName: 'Zara Staf', title: 'STAFF', dept: child.id, manager: ids.MGR, type: 'PROBATION' })
    await create('S1', { fullName: 'Andi Staf', title: 'STAFF', dept: child.id, manager: ids.MGR })

    // Akun login nonaktif untuk Zara → accountStatus INACTIVE
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { code: 'STAFF' } })
    const user = await prisma.user.create({
      data: { email: `itest.zara.${SUFFIX.toLowerCase()}@arrayan.test`, passwordHash: 'x', roleId: staffRole.id, status: 'DISABLED' },
    })
    await prisma.employee.update({ where: { id: ids.S2 }, data: { userId: user.id } })
  })

  afterAll(async () => {
    await prisma.employee.updateMany({ where: { nik: { startsWith: 'ITEST-' } }, data: { managerId: null } })
    await prisma.employee.deleteMany({ where: { nik: { startsWith: 'ITEST-' } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await prisma.department.deleteMany({ where: { code: { startsWith: 'ITEST_SUB_' } } })
    await prisma.department.deleteMany({ where: { code: { startsWith: 'ITEST_DIV_' } } })
    await app.close()
    await prisma.$disconnect()
  })

  const get = (url: string, headers = admin) => app.inject({ method: 'GET', url: `/api/employees${url}`, headers })
  const niks = (res: { json(): { data: Array<{ nik: string }> } }) => res.json().data.map((e) => e.nik)

  describe('GET /api/employees', () => {
    it('401 tanpa token; STAFF boleh membaca', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/employees' })).statusCode).toBe(401)
      expect((await get(`?q=${SUFFIX}`, staffAuth)).statusCode).toBe(200)
    })

    it('mencari berdasarkan NIK dan mengurutkan berdasarkan nama', async () => {
      const res = await get(`?q=${SUFFIX}`)
      expect(res.statusCode).toBe(200)
      expect(niks(res)).toEqual([nik('S1'), nik('DIR'), nik('MGR'), nik('S2')])
      expect(res.json().meta.total).toBe(4)
    })

    it('mencari berdasarkan nama (case-insensitive)', async () => {
      expect(niks(await get(`?q=mario manajer`))).toContain(nik('MGR'))
    })

    it('filter departemen, dengan dan tanpa sub-departemen', async () => {
      expect(niks(await get(`?departmentId=${deptIds.parent}`)).sort()).toEqual([nik('DIR'), nik('MGR')].sort())
      expect(niks(await get(`?departmentId=${deptIds.parent}&includeSubDepartments=true`))).toHaveLength(4)
    })

    it('filter atasan, jenis kepegawaian, dan status akun', async () => {
      expect(niks(await get(`?managerId=${ids.MGR}`))).toEqual([nik('S1'), nik('S2')])
      expect(niks(await get(`?q=${SUFFIX}&employmentType=PROBATION`))).toEqual([nik('S2')])
      expect(niks(await get(`?q=${SUFFIX}&accountStatus=DISABLED`))).toEqual([nik('S2')])
      expect(niks(await get(`?q=${SUFFIX}&accountStatus=NO_ACCOUNT`))).toHaveLength(3)
    })

    it('paginasi', async () => {
      const page2 = await get(`?q=${SUFFIX}&limit=3&page=2`)
      expect(niks(page2)).toEqual([nik('S2')])
      expect(page2.json().meta).toEqual({ page: 2, limit: 3, total: 4 })
    })

    it('menampilkan master data & atasan sebagai objek', async () => {
      const [mgr] = (await get(`?q=${nik('MGR')}`)).json().data
      expect(mgr.jobTitle).toMatchObject({ code: 'MANAGER', level: 'MANAGER' })
      expect(mgr.department).toMatchObject({ code: `ITEST_DIV_${SUFFIX}` })
      expect(mgr.manager).toMatchObject({ id: ids.DIR, fullName: 'Dina Direktur', jobTitle: { code: 'DIRECTOR' } })
      expect(mgr.subordinateCount).toBe(2)
      expect(mgr.account).toBeNull()
      expect(mgr.accountStatus).toBe('NO_ACCOUNT')
    })

    it('400 untuk filter tidak valid', async () => {
      expect((await get('?departmentId=bukan-uuid')).statusCode).toBe(400)
      expect((await get('?employmentType=TETAP')).statusCode).toBe(400)
    })
  })

  describe('GET /api/employees/:id', () => {
    it('detail berisi atasan & bawahan tanpa data sensitif', async () => {
      const res = await get(`/${ids.MGR}`)
      expect(res.statusCode).toBe(200)
      const data = res.json().data
      expect(data.manager.id).toBe(ids.DIR)
      expect(data.subordinates.map((s: { nik: string }) => s.nik)).toEqual([nik('S1'), nik('S2')])

      const zara = await get(`/${ids.S2}`)
      expect(zara.json().data.account).toMatchObject({ role: { code: 'STAFF' }, status: 'DISABLED' })
      expect(zara.body).not.toMatch(/passwordHash|password_hash|tokenHash/)
    })

    it('404 / 400', async () => {
      expect((await get('/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
      expect((await get('/bukan-uuid')).statusCode).toBe(400)
    })
  })

  describe('GET /api/employees/tree', () => {
    it('subtree bersarang dengan urutan level lalu nama', async () => {
      const res = await get(`/tree?rootId=${ids.DIR}`)
      expect(res.statusCode).toBe(200)
      const [dir] = res.json().data as Node[]
      expect(dir!.nik).toBe(nik('DIR'))
      expect(dir!.children.map((c) => c.nik)).toEqual([nik('MGR')])
      const staff = dir!.children[0]!.children
      expect(staff.map((c) => c.nik)).toEqual([nik('S1'), nik('S2')])
      // node level dalam tetap memuat field lengkap
      expect(staff[0]!.jobTitle).toMatchObject({ code: 'STAFF', level: 'STAFF' })
      expect(staff[0]!.children).toEqual([])
    })

    it('pohon penuh: multi-root, semua karyawan muncul sekali', async () => {
      const res = await get('/tree')
      const { data, meta } = res.json() as { data: Node[]; meta: { totalEmployees: number; cycleBreaks: string[] } }
      const seen: string[] = []
      const walk = (nodes: Node[]) => nodes.forEach((n) => (seen.push(n.id), walk(n.children)))
      walk(data)
      expect(seen).toHaveLength(meta.totalEmployees)
      expect(new Set(seen).size).toBe(seen.length)
      expect(data.map((n) => n.id)).toContain(ids.DIR)
    })

    it('siklus data atasan diputus dan dilaporkan', async () => {
      await prisma.employee.update({ where: { id: ids.DIR }, data: { managerId: ids.S1 } })
      try {
        const res = await get('/tree')
        expect(res.statusCode).toBe(200)
        const { cycleBreaks, totalEmployees } = res.json().meta
        expect(cycleBreaks.some((id: string) => [ids.DIR, ids.MGR, ids.S1].includes(id))).toBe(true)

        const seen: string[] = []
        const walk = (nodes: Node[]) => nodes.forEach((n) => (seen.push(n.id), walk(n.children)))
        walk(res.json().data)
        expect(seen).toHaveLength(totalEmployees)
      } finally {
        await prisma.employee.update({ where: { id: ids.DIR }, data: { managerId: null } })
      }
    })

    it('404 untuk rootId tidak dikenal', async () => {
      expect((await get('/tree?rootId=00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
    })
  })
})
