import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { bearer, createTestApp, createUserWithRole, loginAs, uniqueSuffix } from '../../test/helpers.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `IPROV-${SUFFIX}-${name}`
const email = (name: string) => `iprov.${name}.${SUFFIX.toLowerCase()}@arrayan.test`
const STRONG_PASSWORD = 'Rahasia123!'

const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!

describe('employee provisioning & activation (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let adminEmployeeId: string
  const titles: Record<string, string> = {}

  beforeAll(async () => {
    app = await createTestApp()
    const token = await loginAs(app)
    admin = bearer(token)
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: admin })
    adminEmployeeId = me.json().user.employee.id
    for (const t of await prisma.jobTitle.findMany({ where: { code: { in: ['DIRECTOR', 'STAFF', 'MANAGER'] } } })) {
      titles[t.code] = t.id
    }
  })

  afterAll(async () => {
    await prisma.employee.updateMany({ where: { nik: { startsWith: 'IPROV-' } }, data: { managerId: null } })
    await prisma.employee.deleteMany({ where: { nik: { startsWith: 'IPROV-' } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await prisma.department.deleteMany({ where: { code: { startsWith: 'IPROV_' } } })
    await app.close()
    await prisma.$disconnect()
  })

  const createEmployee = (payload: object, headers = admin) =>
    app.inject({ method: 'POST', url: '/api/employees', payload, headers })
  const activate = (token: string, password = STRONG_PASSWORD) =>
    app.inject({ method: 'POST', url: '/api/auth/activate', payload: { token, password } })
  const login = (userEmail: string, password = STRONG_PASSWORD) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: userEmail, password } })
  const setStatus = (id: string, payload: object) =>
    app.inject({ method: 'PATCH', url: `/api/employees/${id}/status`, payload, headers: admin })

  describe('akses & validasi', () => {
    it('hanya SUPER_ADMIN yang boleh menambah karyawan', async () => {
      const staff = bearer(await loginAs(app, await createUserWithRole('STAFF')))
      const res = await createEmployee({ nik: nik('X'), fullName: 'Tidak Boleh', jobTitleId: titles.STAFF }, staff)
      expect(res.statusCode).toBe(403)
      expect((await app.inject({ method: 'POST', url: '/api/employees', payload: {} })).statusCode).toBe(401)
    })

    it('karyawan tanpa akun, NIK duplikat 409, master tidak aktif/tidak ada 422', async () => {
      const ok = await createEmployee({ nik: nik('NOACC'), fullName: 'Tanpa Akun', jobTitleId: titles.STAFF, employmentType: 'PKL' })
      expect(ok.statusCode).toBe(201)
      expect(ok.json().data).toMatchObject({ accountStatus: 'NO_ACCOUNT', account: null, status: 'ACTIVE', employmentType: 'PKL' })
      expect(ok.json().invitation).toBeUndefined()

      const dup = await createEmployee({ nik: nik('NOACC'), fullName: 'Duplikat', jobTitleId: titles.STAFF })
      expect(dup.statusCode).toBe(409)

      const dept = await prisma.department.create({ data: { code: `IPROV_OFF_${SUFFIX}`, name: 'Dept Nonaktif', isActive: false } })
      const inactive = await createEmployee({ nik: nik('BADREF'), fullName: 'Ref Salah', jobTitleId: titles.STAFF, departmentId: dept.id })
      expect(inactive.statusCode).toBe(422)
      expect(inactive.json().message).toMatch(/departmentId/)

      const missing = await createEmployee({ nik: nik('BADREF'), fullName: 'Ref Salah', jobTitleId: '00000000-0000-4000-8000-000000000000' })
      expect(missing.statusCode).toBe(422)

      const badBody = await createEmployee({ nik: nik('BADREF'), fullName: 'X', jobTitleId: titles.STAFF, joinDate: '2026-13-01' })
      expect(badBody.statusCode).toBe(400)
    })
  })

  describe('alur undangan → aktivasi → login', () => {
    it('Direktur: role default MANAGEMENT, aktivasi, lalu login', async () => {
      const created = await createEmployee({
        nik: nik('DIR'),
        fullName: 'Dewi Direktur',
        jobTitleId: titles.DIRECTOR,
        joinDate: '2026-01-05',
        account: { email: email('dir').toUpperCase() },
      })
      expect(created.statusCode).toBe(201)
      const body = created.json()
      expect(body.data.account).toMatchObject({ email: email('dir'), role: { code: 'MANAGEMENT' }, status: 'PENDING_ACTIVATION' })
      expect(body.invitation).toMatchObject({ driver: 'log', devActivationLink: expect.stringContaining('/activate?token=') })
      expect(created.body).not.toMatch(/passwordHash|tokenHash/)

      // Belum aktivasi → login gagal dengan pesan generik
      const early = await login(email('dir'))
      expect(early.statusCode).toBe(401)
      expect(early.json().message).toBe('Email atau password salah')

      const token = tokenFrom(body.invitation.devActivationLink)
      const weak = await activate(token, 'lemah')
      expect(weak.statusCode).toBe(400)
      expect(weak.json().message).toMatch(/minimal 8/)
      const noSymbol = await activate(token, 'Rahasia123')
      expect(noSymbol.json().message).toMatch(/simbol/)

      const ok = await activate(token)
      expect(ok.statusCode).toBe(200)
      expect(ok.json().email).toBe(email('dir'))

      const reuse = await activate(token)
      expect(reuse.statusCode).toBe(400)

      const session = await login(email('dir'))
      expect(session.statusCode).toBe(200)
      expect(session.json().user.role.code).toBe('MANAGEMENT')
      expect(session.json().user.employee.nik).toBe(nik('DIR'))
    })

    it('token acak/format salah ditolak', async () => {
      expect((await activate('a'.repeat(64))).statusCode).toBe(400)
      expect((await activate('bukan-token')).statusCode).toBe(400)
    })

    it('buat akun belakangan dengan role SUPER_ADMIN; email duplikat & akun ganda ditolak', async () => {
      const emp = await createEmployee({ nik: nik('HR'), fullName: 'Hana HR', jobTitleId: titles.STAFF })
      const id = emp.json().data.id

      const dupEmail = await app.inject({
        method: 'POST', url: `/api/employees/${id}/account`, headers: admin, payload: { email: email('dir') },
      })
      expect(dupEmail.statusCode).toBe(409)

      const res = await app.inject({
        method: 'POST', url: `/api/employees/${id}/account`, headers: admin,
        payload: { email: email('hr'), roleCode: 'SUPER_ADMIN' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().data.account.role.code).toBe('SUPER_ADMIN')

      const again = await app.inject({
        method: 'POST', url: `/api/employees/${id}/account`, headers: admin, payload: { email: email('hr2') },
      })
      expect(again.statusCode).toBe(409)
    })

    it('kirim ulang undangan: link lama hangus, link baru berlaku; akun aktif tidak bisa diundang ulang', async () => {
      const emp = await createEmployee({
        nik: nik('RESEND'), fullName: 'Rina Resend', jobTitleId: titles.STAFF, account: { email: email('resend') },
      })
      const id = emp.json().data.id
      const oldToken = tokenFrom(emp.json().invitation.devActivationLink)

      const resent = await app.inject({ method: 'POST', url: `/api/employees/${id}/account/invitation`, headers: admin })
      expect(resent.statusCode).toBe(200)
      const newToken = tokenFrom(resent.json().invitation.devActivationLink)
      expect(newToken).not.toBe(oldToken)

      expect((await activate(oldToken)).statusCode).toBe(400)
      expect((await activate(newToken)).statusCode).toBe(200)

      const afterActive = await app.inject({ method: 'POST', url: `/api/employees/${id}/account/invitation`, headers: admin })
      expect(afterActive.statusCode).toBe(409)
    })
  })

  describe('atasan', () => {
    it('menolak siklus atasan dan atasan diri sendiri', async () => {
      const boss = (await createEmployee({ nik: nik('BOSS'), fullName: 'Bos', jobTitleId: titles.MANAGER })).json().data.id
      const sub = (await createEmployee({ nik: nik('SUB'), fullName: 'Bawahan', jobTitleId: titles.STAFF, managerId: boss })).json().data
      expect(sub.manager.id).toBe(boss)

      const cycle = await app.inject({ method: 'PATCH', url: `/api/employees/${boss}`, headers: admin, payload: { managerId: sub.id } })
      expect(cycle.statusCode).toBe(422)
      expect(cycle.json().message).toMatch(/siklus/)

      const self = await app.inject({ method: 'PATCH', url: `/api/employees/${boss}`, headers: admin, payload: { managerId: boss } })
      expect(self.statusCode).toBe(422)

      const rename = await app.inject({ method: 'PATCH', url: `/api/employees/${sub.id}`, headers: admin, payload: { fullName: 'Bawahan Baru' } })
      expect(rename.statusCode).toBe(200)
      expect(rename.json().data.fullName).toBe('Bawahan Baru')
    })
  })

  describe('karyawan keluar & kembali', () => {
    it('nonaktif: sesi dicabut, login ditolak, hilang dari daftar default; aktif kembali wajib aktivasi ulang', async () => {
      const emp = await createEmployee({
        nik: nik('LEAVE'), fullName: 'Lukas Keluar', jobTitleId: titles.STAFF, joinDate: '2026-02-01', account: { email: email('leave') },
      })
      const id = emp.json().data.id
      await activate(tokenFrom(emp.json().invitation.devActivationLink))
      const session = await login(email('leave'))
      const refreshToken = session.json().refreshToken

      expect((await setStatus(id, { status: 'INACTIVE', exitDate: '2026-01-01' })).statusCode).toBe(400)

      const off = await setStatus(id, { status: 'INACTIVE', exitDate: '2026-11-30' })
      expect(off.statusCode).toBe(200)
      expect(off.json().data).toMatchObject({ status: 'INACTIVE', exitDate: '2026-11-30', accountStatus: 'DISABLED' })
      expect((await setStatus(id, { status: 'INACTIVE' })).statusCode).toBe(409)

      const refresh = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
      expect(refresh.statusCode).toBe(401)
      const relogin = await login(email('leave'))
      expect(relogin.statusCode).toBe(401)
      expect(relogin.json().message).toMatch(/dinonaktifkan/)

      const list = (q: string) =>
        app.inject({ method: 'GET', url: `/api/employees?q=${nik('LEAVE')}${q}`, headers: admin }).then((r) => r.json().meta.total)
      expect(await list('')).toBe(0)
      expect(await list('&status=INACTIVE')).toBe(1)

      const asManager = await createEmployee({ nik: nik('ORPHAN'), fullName: 'Atasan Keluar', jobTitleId: titles.STAFF, managerId: id })
      expect(asManager.statusCode).toBe(422)

      const on = await setStatus(id, { status: 'ACTIVE' })
      expect(on.statusCode).toBe(200)
      expect(on.json().data).toMatchObject({ status: 'ACTIVE', exitDate: null, accountStatus: 'PENDING_ACTIVATION' })
      expect((await login(email('leave'))).statusCode).toBe(401) // password lama tidak berlaku

      expect((await activate(tokenFrom(on.json().invitation.devActivationLink), 'BaruLagi456#')).statusCode).toBe(200)
      expect((await login(email('leave'), 'BaruLagi456#')).statusCode).toBe(200)
    })

    it('admin tidak bisa menonaktifkan dirinya sendiri', async () => {
      const res = await setStatus(adminEmployeeId, { status: 'INACTIVE' })
      expect(res.statusCode).toBe(422)
    })

    it('karyawan nonaktif tidak muncul di pohon organisasi', async () => {
      const emp = await createEmployee({ nik: nik('TREE'), fullName: 'Tari Tree', jobTitleId: titles.STAFF })
      const id = emp.json().data.id
      await setStatus(id, { status: 'INACTIVE' })
      const tree = await app.inject({ method: 'GET', url: '/api/employees/tree', headers: admin })
      expect(tree.body).not.toContain(id)
    })
  })
})
