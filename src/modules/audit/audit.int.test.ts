import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { bearer, createTestApp, createUserWithRole, loginAs, SUPER_ADMIN, uniqueSuffix } from '../../test/helpers.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `IAUD-${SUFFIX}-${name}`
const email = (name: string) => `iaud.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!

interface AuditRow {
  action: string
  entityType: string
  entityId: string | null
  actor: { id: string | null; email: string | null } | null
  changes: Record<string, unknown> | null
  ip: string | null
  createdAt: string
}

describe('audit log (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let staffTitleId: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    staffTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
  })

  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { nik: { startsWith: 'IAUD-' } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await prisma.trainingCategory.deleteMany({ where: { code: { startsWith: 'IAUD_' } } })
    await app.close()
    await prisma.$disconnect()
  })

  const logs = async (query: string): Promise<AuditRow[]> => {
    const res = await app.inject({ method: 'GET', url: `/api/audit-logs?${query}`, headers: admin })
    expect(res.statusCode).toBe(200)
    return res.json().data
  }

  it('alur karyawan tercatat lengkap dengan pelaku, diff, dan tanpa data sensitif', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: { nik: nik('EMP'), fullName: 'Audit Satu', jobTitleId: staffTitleId, account: { email: email('emp') } },
    })
    const id = created.json().data.id as string
    await app.inject({ method: 'PATCH', url: `/api/employees/${id}`, headers: admin, payload: { fullName: 'Audit Dua' } })
    await app.inject({
      method: 'POST',
      url: '/api/auth/activate',
      payload: { token: tokenFrom(created.json().invitation.devActivationLink), password: 'Audit123!' },
    })
    await app.inject({ method: 'PATCH', url: `/api/employees/${id}/status`, headers: admin, payload: { status: 'INACTIVE' } })

    const rows = await logs(`entityId=${id}`)
    expect(rows.map((r) => r.action)).toEqual([
      'employee.deactivate',
      'employee.update',
      'employee.account.create',
      'employee.create',
    ])
    for (const row of rows) expect(row.actor?.email).toBe(SUPER_ADMIN.email)

    const update = rows.find((r) => r.action === 'employee.update')!
    expect(update.changes).toEqual({ fullName: { from: 'Audit Satu', to: 'Audit Dua' } })
    const create = rows.find((r) => r.action === 'employee.create')!
    expect(create.changes).toMatchObject({ after: { nik: nik('EMP'), fullName: 'Audit Satu' } })
    expect(rows.find((r) => r.action === 'employee.account.create')!.changes).toMatchObject({
      email: email('emp'),
      roleCode: 'STAFF',
    })

    // Aktivasi dicatat atas nama karyawan itu sendiri
    const userId = (await prisma.user.findUniqueOrThrow({ where: { email: email('emp') } })).id
    const [activation] = await logs(`action=auth.account_activated&entityId=${userId}`)
    expect(activation!.actor).toEqual({ id: userId, email: email('emp') })

    const allJson = JSON.stringify(await logs(`entityId=${id}`)) + JSON.stringify(activation)
    expect(allJson).not.toMatch(/passwordHash|tokenHash|\$2[aby]\$|[a-f0-9]{64}/)
  })

  it('aksi yang gagal tidak meninggalkan audit log', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'employee.create' } })
    const dup = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: { nik: 'ADM-001', fullName: 'Duplikat', jobTitleId: staffTitleId },
    })
    expect(dup.statusCode).toBe(409)
    expect(await prisma.auditLog.count({ where: { action: 'employee.create' } })).toBe(before)
  })

  it('master data: create, update (diff), deactivate', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/master/training-categories',
      headers: admin,
      payload: { code: `IAUD_${SUFFIX}`, name: 'Kategori Audit' },
    })
    const id = created.json().data.id as string
    await app.inject({ method: 'PATCH', url: `/api/master/training-categories/${id}`, headers: admin, payload: { name: 'Kategori Baru' } })
    await app.inject({ method: 'PATCH', url: `/api/master/training-categories/${id}/active`, headers: admin, payload: { isActive: false } })

    const rows = await logs(`action=master.training_category&entityId=${id}`)
    expect(rows.map((r) => r.action)).toEqual([
      'master.training_category.deactivate',
      'master.training_category.update',
      'master.training_category.create',
    ])
    expect(rows[1]!.changes).toEqual({ name: { from: 'Kategori Audit', to: 'Kategori Baru' } })
    expect(rows[0]!.changes).toEqual({ isActive: { from: true, to: false } })
  })

  it('event keamanan: ganti password, reset password, login terkunci', async () => {
    const user = await createUserWithRole('STAFF')
    const userId = (await prisma.user.findUniqueOrThrow({ where: { email: user.email } })).id
    const token = await loginAs(app, user)

    await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: bearer(token),
      payload: { currentPassword: user.password, newPassword: 'Ganti123!' },
    })
    const forgot = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: user.email } })
    await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: tokenFrom(forgot.json().devResetLink), password: 'Reset123!' },
    })

    const rows = await logs(`entityType=user&entityId=${userId}`)
    expect(rows.map((r) => r.action)).toEqual(['auth.password_reset', 'auth.password_changed'])
    expect(rows.every((r) => r.actor?.id === userId)).toBe(true)

    const target = email('locked')
    for (let i = 0; i < 6; i++) {
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: target, password: 'Salah123!' } })
    }
    const locked = (await logs('action=auth.login_locked')).filter((r) => r.changes?.email === target)
    expect(locked).toHaveLength(1)
    expect(locked[0]!.actor).toBeNull()
    expect(locked[0]!.ip).toBeTruthy()
  })

  it('akses & filter', async () => {
    const staff = bearer(await loginAs(app, await createUserWithRole('STAFF')))
    expect((await app.inject({ method: 'GET', url: '/api/audit-logs', headers: staff })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/audit-logs' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/audit-logs?from=2026-12-31&to=2026-01-01', headers: admin })).statusCode).toBe(400)

    const today = new Date().toISOString().slice(0, 10)
    const todayRows = await logs(`from=${today}&to=${today}&action=employee&limit=5`)
    expect(todayRows.length).toBeGreaterThan(0)
    expect(todayRows.every((r) => r.action.startsWith('employee'))).toBe(true)
    const times = todayRows.map((r) => r.createdAt)
    expect([...times].sort().reverse()).toEqual(times)
    expect(await logs('from=2000-01-01&to=2000-01-02')).toEqual([])
  })
})
