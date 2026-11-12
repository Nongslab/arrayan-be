import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { bearer, createTestApp, loginAs, uniqueSuffix } from '../test/helpers.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `ISESS-${SUFFIX}-${name}`
const email = (name: string) => `isess.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!
const EXPIRED_SESSION = 'Sesi tidak berlaku lagi. Silakan login kembali.'

describe('validasi sesi per request (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let staffTitleId: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    staffTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
  })

  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { nik: { startsWith: 'ISESS-' } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await app.close()
    await prisma.$disconnect()
  })

  const me = (accessToken: string) => app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(accessToken) })

  async function activeUser(name: string, password = 'Awal123!') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: { nik: nik(name), fullName: `User ${name}`, jobTitleId: staffTitleId, account: { email: email(name) } },
    })
    await app.inject({
      method: 'POST',
      url: '/api/auth/activate',
      payload: { token: tokenFrom(res.json().invitation.devActivationLink), password },
    })
    const login = await loginAs(app, { email: email(name), password })
    return { id: res.json().data.id as string, email: email(name), password, accessToken: login }
  }

  it('access token langsung ditolak setelah karyawan dinonaktifkan', async () => {
    const user = await activeUser('OFF')
    expect((await me(user.accessToken)).statusCode).toBe(200)

    await app.inject({ method: 'PATCH', url: `/api/employees/${user.id}/status`, headers: admin, payload: { status: 'INACTIVE' } })

    const res = await me(user.accessToken)
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toBe(EXPIRED_SESSION)
    const list = await app.inject({ method: 'GET', url: '/api/employees', headers: bearer(user.accessToken) })
    expect(list.statusCode).toBe(401)
  })

  it('ganti password: token lama mati, token baru dari response berlaku', async () => {
    const user = await activeUser('CHG')
    const otherDevice = await loginAs(app, { email: user.email, password: user.password })

    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: bearer(user.accessToken),
      payload: { currentPassword: user.password, newPassword: 'Ganti123!' },
    })
    expect(changed.statusCode).toBe(200)

    expect((await me(user.accessToken)).statusCode).toBe(401)
    expect((await me(otherDevice)).statusCode).toBe(401)
    expect((await me(changed.json().accessToken)).statusCode).toBe(200)
  })

  it('reset password: semua access token lama mati', async () => {
    const user = await activeUser('RST')
    const forgot = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: user.email } })
    await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: tokenFrom(forgot.json().devResetLink), password: 'Reset123!' },
    })

    expect((await me(user.accessToken)).statusCode).toBe(401)
    const fresh = await loginAs(app, { email: user.email, password: 'Reset123!' })
    expect((await me(fresh)).statusCode).toBe(200)
  })

  it('perubahan role langsung berlaku tanpa login ulang', async () => {
    const user = await activeUser('ROLE')
    expect((await me(user.accessToken)).json().user.role.code).toBe('STAFF')
    expect((await app.inject({ method: 'GET', url: '/api/employees?status=ALL', headers: bearer(user.accessToken) })).statusCode).toBe(200)
    const forbidden = await app.inject({
      method: 'POST', url: '/api/master/training-categories', headers: bearer(user.accessToken), payload: { code: `ISESS_${SUFFIX}`, name: 'X' },
    })
    expect(forbidden.statusCode).toBe(403)

    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'MANAGER' } })
    await prisma.user.update({ where: { email: user.email }, data: { roleId: managerRole.id } })

    expect((await me(user.accessToken)).json().user.role.code).toBe('MANAGER')
  })
})
