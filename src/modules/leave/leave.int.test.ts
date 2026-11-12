import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { bearer, createTestApp, createUserWithRole, loginAs, uniqueSuffix } from '../../test/helpers.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `ILV-${SUFFIX}-${name}`
const email = (name: string) => `ilv.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!

interface Balance {
  leaveType: { code: string }
  entitlement: number
  adjustments: number
  collectiveLeave: number
  used: number
  pending: number
  available: number
}

describe('cuti: saldo, pengajuan, pembatalan (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  const types: Record<string, string> = {}

  /** Karyawan + akun aktif; mengembalikan header Bearer dan id karyawan. */
  async function employeeWithLogin(name: string, joinDate = '2025-01-01') {
    const created = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: {
        nik: nik(name),
        fullName: `Cuti ${name}`,
        employmentType: 'KARTAP',
        joinDate,
        jobTitleId: types.STAFF_TITLE,
        account: { email: email(name) },
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/auth/activate',
      payload: { token: tokenFrom(created.json().invitation.devActivationLink), password: 'CutiAman123!' },
    })
    const token = await loginAs(app, { email: email(name), password: 'CutiAman123!' })
    return { auth: bearer(token), employeeId: created.json().data.id as string }
  }

  const apply = (auth: Record<string, string>, code: string, startDate: string, endDate: string, reason?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/leaves',
      headers: auth,
      payload: { leaveTypeId: types[code], startDate, endDate, ...(reason ? { reason } : {}) },
    })

  const balance = async (auth: Record<string, string>, year = 2026, code = 'ANNUAL'): Promise<Balance> => {
    const res = await app.inject({ method: 'GET', url: `/api/leaves/balance?year=${year}`, headers: auth })
    expect(res.statusCode).toBe(200)
    return res.json().data.find((b: Balance) => b.leaveType.code === code)
  }

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    for (const t of await prisma.leaveType.findMany()) types[t.code] = t.id
    types.STAFF_TITLE = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
  })

  afterAll(async () => {
    const employees = await prisma.employee.findMany({ where: { nik: { startsWith: 'ILV-' } }, select: { id: true } })
    const ids = employees.map((e) => e.id)
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } })
    await prisma.leaveBalanceAdjustment.deleteMany({ where: { employeeId: { in: ids } } })
    await prisma.employee.deleteMany({ where: { id: { in: ids } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await prisma.leaveType.deleteMany({ where: { code: { startsWith: 'ILV_' } } })
    await app.close()
    await prisma.$disconnect()
  })

  describe('saldo & pengajuan', () => {
    let user: Awaited<ReturnType<typeof employeeWithLogin>>

    beforeAll(async () => {
      user = await employeeWithLogin('MAIN')
    })

    it('saldo awal 2026: jatah 12 dikurangi 2 hari cuti bersama', async () => {
      expect(await balance(user.auth)).toMatchObject({ entitlement: 12, collectiveLeave: 2, used: 0, pending: 0, available: 10 })
      expect(await balance(user.auth, 2026, 'SICK')).toMatchObject({ entitlement: 6, collectiveLeave: 0, available: 6 })
    })

    it('hari dihitung tanpa akhir pekan, hari libur, dan cuti bersama', async () => {
      // Sen 21 – Jum 25 Des 2026: 24 cuti bersama, 25 Natal → 3 hari
      const res = await apply(user.auth, 'ANNUAL', '2026-12-21', '2026-12-25', 'Liburan keluarga')
      expect(res.statusCode).toBe(201)
      expect(res.json().data).toMatchObject({ days: 3, status: 'PENDING', leaveType: { code: 'ANNUAL' }, attachmentRequired: false })
      expect(await balance(user.auth)).toMatchObject({ pending: 3, available: 7 })
    })

    it('tumpang tindih ditolak 409', async () => {
      const res = await apply(user.auth, 'PERMISSION', '2026-12-25', '2026-12-28')
      expect(res.statusCode).toBe(409)
    })

    it('pengajuan lintas tahun memotong saldo masing-masing tahun', async () => {
      // 28–30 Des 2026 (31 cuti bersama) = 3; 1 Jan libur, 4–5 Jan 2027 = 2
      const res = await apply(user.auth, 'ANNUAL', '2026-12-28', '2027-01-05')
      expect(res.statusCode).toBe(201)
      expect(res.json().data.days).toBe(5)
      expect(await balance(user.auth, 2026)).toMatchObject({ pending: 6, available: 4 })
      expect(await balance(user.auth, 2027)).toMatchObject({ pending: 2, collectiveLeave: 0, available: 10 })
    })

    it('saldo tidak cukup → 422 dengan rincian', async () => {
      const res = await apply(user.auth, 'ANNUAL', '2026-11-16', '2026-11-27')
      expect(res.statusCode).toBe(422)
      expect(res.json().message).toBe('Saldo Cuti Tahunan 2026 tidak cukup: tersedia 4 hari, diajukan 10 hari')
    })

    it('jenis tanpa kuota (izin) tidak dibatasi saldo; sakit memberi tanda lampiran', async () => {
      const permission = await apply(user.auth, 'PERMISSION', '2026-11-02', '2026-11-13')
      expect(permission.statusCode).toBe(201)
      expect(permission.json().data.days).toBe(10)

      const sick = await apply(user.auth, 'SICK', '2026-11-16', '2026-11-17')
      expect(sick.json().data).toMatchObject({ days: 2, attachmentRequired: true })
      expect(await balance(user.auth, 2026, 'SICK')).toMatchObject({ pending: 2, available: 4 })
    })

    it('validasi tanggal & jenis cuti', async () => {
      expect((await apply(user.auth, 'ANNUAL', '2026-11-21', '2026-11-22')).json().message).toMatch(/tidak mengandung hari kerja/)
      expect((await apply(user.auth, 'ANNUAL', '2026-11-10', '2026-11-09')).statusCode).toBe(400)
      expect((await apply(user.auth, 'ANNUAL', '2026-01-01', '2027-06-01')).statusCode).toBe(400)

      const inactive = await prisma.leaveType.create({
        data: { code: `ILV_OFF_${SUFFIX}`, name: 'Nonaktif', category: 'SPECIAL', isActive: false },
      })
      types.INACTIVE = inactive.id
      expect((await apply(user.auth, 'INACTIVE', '2026-11-18', '2026-11-18')).json().message).toMatch(/tidak aktif/)
    })

    it('daftar milik sendiri dengan filter tahun & status', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/leaves/me?year=2027', headers: user.auth })
      expect(res.json().data.map((l: { startDate: string }) => l.startDate)).toEqual(['2026-12-28'])
      const pending = await app.inject({ method: 'GET', url: '/api/leaves/me?status=PENDING', headers: user.auth })
      expect(pending.json().meta.total).toBe(4)
    })
  })

  describe('pembatalan & akses', () => {
    it('pemilik membatalkan PENDING → saldo kembali; batal dua kali 409', async () => {
      const user = await employeeWithLogin('CANCEL')
      const id = (await apply(user.auth, 'ANNUAL', '2026-11-23', '2026-11-25')).json().data.id
      expect(await balance(user.auth)).toMatchObject({ pending: 3, available: 7 })

      const res = await app.inject({ method: 'POST', url: `/api/leaves/${id}/cancel`, headers: user.auth, payload: {} })
      expect(res.statusCode).toBe(200)
      expect(res.json().data).toMatchObject({ status: 'CANCELLED', cancelReason: null })
      expect(await balance(user.auth)).toMatchObject({ pending: 0, available: 10 })

      expect((await app.inject({ method: 'POST', url: `/api/leaves/${id}/cancel`, headers: user.auth, payload: {} })).statusCode).toBe(409)
    })

    it('APPROVED: dihitung terpakai; hanya HR dengan alasan yang bisa membatalkan', async () => {
      const user = await employeeWithLogin('APPROVED')
      const id = (await apply(user.auth, 'ANNUAL', '2026-11-30', '2026-12-02')).json().data.id
      await prisma.leaveRequest.update({ where: { id }, data: { status: 'APPROVED' } }) // approval menyusul (US-5.3)
      expect(await balance(user.auth)).toMatchObject({ used: 3, pending: 0, available: 7 })

      const cancel = (headers: Record<string, string>, payload: object) =>
        app.inject({ method: 'POST', url: `/api/leaves/${id}/cancel`, headers, payload })
      expect((await cancel(user.auth, { reason: 'batal' })).statusCode).toBe(403)
      expect((await cancel(admin, {})).statusCode).toBe(400)
      const ok = await cancel(admin, { reason: 'Proyek mendesak' })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().data.cancelReason).toBe('Proyek mendesak')
      expect(await balance(user.auth)).toMatchObject({ used: 0, available: 10 })

      const [log] = await prisma.auditLog.findMany({ where: { action: 'leave.cancel', entityId: id }, take: 1 })
      expect(log!.changes).toMatchObject({ status: { from: 'APPROVED', to: 'CANCELLED' }, reason: 'Proyek mendesak' })
    })

    it('pengajuan orang lain → 404; akun tanpa data karyawan → 403', async () => {
      const owner = await employeeWithLogin('OWNER')
      const other = await employeeWithLogin('OTHER')
      const id = (await apply(owner.auth, 'PERMISSION', '2026-11-19', '2026-11-19')).json().data.id

      expect((await app.inject({ method: 'GET', url: `/api/leaves/${id}`, headers: other.auth })).statusCode).toBe(404)
      expect((await app.inject({ method: 'POST', url: `/api/leaves/${id}/cancel`, headers: other.auth, payload: {} })).statusCode).toBe(404)
      expect((await app.inject({ method: 'GET', url: `/api/leaves/${id}`, headers: admin })).statusCode).toBe(200)

      const noEmployee = bearer(await loginAs(app, await createUserWithRole('STAFF')))
      expect((await apply(noEmployee, 'PERMISSION', '2026-11-19', '2026-11-19')).statusCode).toBe(403)
      expect((await app.inject({ method: 'GET', url: '/api/leaves', headers: other.auth })).statusCode).toBe(403)
    })

    it('tidak boleh sebelum tanggal masuk kerja', async () => {
      const newcomer = await employeeWithLogin('NEW', '2026-10-01')
      const res = await apply(newcomer.auth, 'PERMISSION', '2026-09-28', '2026-10-02')
      expect(res.statusCode).toBe(422)
      expect(res.json().message).toMatch(/tanggal masuk kerja \(2026-10-01\)/)
    })
  })

  describe('HR', () => {
    it('penyesuaian saldo + audit; jenis tanpa kuota ditolak; staff 403', async () => {
      const user = await employeeWithLogin('ADJ')
      const adjust = (headers: Record<string, string>, payload: object) =>
        app.inject({ method: 'POST', url: '/api/leaves/balance/adjustments', headers, payload })

      const ok = await adjust(admin, { employeeId: user.employeeId, leaveTypeId: types.ANNUAL, year: 2026, days: 2, reason: 'Kompensasi lembur' })
      expect(ok.statusCode).toBe(201)
      expect(ok.json().data.balance).toMatchObject({ adjustments: 2, available: 12 })
      expect(await balance(user.auth)).toMatchObject({ adjustments: 2, available: 12 })

      expect((await adjust(admin, { employeeId: user.employeeId, leaveTypeId: types.PERMISSION, year: 2026, days: 1, reason: 'x y z' })).statusCode).toBe(422)
      expect((await adjust(admin, { employeeId: user.employeeId, leaveTypeId: types.ANNUAL, year: 2026, days: 0, reason: 'nol' })).statusCode).toBe(400)
      expect((await adjust(user.auth, { employeeId: user.employeeId, leaveTypeId: types.ANNUAL, year: 2026, days: 5, reason: 'curang' })).statusCode).toBe(403)

      const hrView = await app.inject({ method: 'GET', url: `/api/leaves/balance/${user.employeeId}?year=2026`, headers: admin })
      expect(hrView.json().data.find((b: Balance) => b.leaveType.code === 'ANNUAL').available).toBe(12)

      const logs = await prisma.auditLog.count({ where: { action: 'leave.balance_adjust', entityId: user.employeeId } })
      expect(logs).toBe(1)
    })

    it('daftar semua pengajuan dengan filter', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/leaves?status=CANCELLED&from=2026-11-01&to=2026-12-31', headers: admin })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.length).toBeGreaterThanOrEqual(2)
      expect(res.json().data.every((l: { status: string }) => l.status === 'CANCELLED')).toBe(true)
    })
  })

  it('dua pengajuan bersamaan tidak bisa melampaui saldo', async () => {
    const user = await employeeWithLogin('RACE')
    await app.inject({
      method: 'POST',
      url: '/api/leaves/balance/adjustments',
      headers: admin,
      payload: { employeeId: user.employeeId, leaveTypeId: types.ANNUAL, year: 2026, days: -6, reason: 'Sisakan 4 hari' },
    })
    expect(await balance(user.auth)).toMatchObject({ available: 4 })

    const [a, b] = await Promise.all([
      apply(user.auth, 'ANNUAL', '2026-11-16', '2026-11-18'),
      apply(user.auth, 'ANNUAL', '2026-11-23', '2026-11-25'),
    ])
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 422])
    expect(await balance(user.auth)).toMatchObject({ pending: 3, available: 1 })
  })
})
