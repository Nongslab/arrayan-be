import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { bearer, createTestApp, loginAs, SUPER_ADMIN } from '../../test/helpers.js'

describe('auth (integration)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  it('login Super Admin mengembalikan token, cookie, dan master data sebagai objek', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: SUPER_ADMIN })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.accessToken).toEqual(expect.any(String))
    expect(body.refreshToken).toEqual(expect.any(String))
    expect(body.user.role.code).toBe('SUPER_ADMIN')
    expect(body.user.employee.jobTitle).toMatchObject({ code: 'HR_SYSTEM_ADMIN', level: expect.any(String) })
    expect(body.user.employee.department).toMatchObject({ code: 'HRD' })
    expect(body.user).not.toHaveProperty('passwordHash')

    const cookieNames = res.cookies.map((c) => c.name)
    expect(cookieNames).toEqual(expect.arrayContaining(['arrayan_access_token', 'arrayan_refresh_token']))
  })

  it('password salah ditolak 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: SUPER_ADMIN.email, password: 'WrongPassword!' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('GET /me menerima Bearer token', async () => {
    const token = await loginAs(app)
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) })

    expect(res.statusCode).toBe(200)
    expect(res.json().user.email).toBe(SUPER_ADMIN.email)
  })

  it('GET /me tanpa token ditolak 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
  })

  it('refresh token dirotasi: token lama tidak bisa dipakai ulang', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: SUPER_ADMIN })
    const oldRefresh = login.json().refreshToken as string

    const first = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: oldRefresh } })
    expect(first.statusCode).toBe(200)
    expect(first.json().refreshToken).not.toBe(oldRefresh)

    const reuse = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: oldRefresh } })
    expect(reuse.statusCode).toBe(401)
  })
})
