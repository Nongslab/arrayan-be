import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { bearer, createTestApp, loginAs, uniqueSuffix } from '../../test/helpers.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `IPWD-${SUFFIX}-${name}`
const email = (name: string) => `ipwd.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const GENERIC = 'Jika email terdaftar dan aktif, link reset password telah dikirim.'
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!

describe('password recovery & change (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let staffTitleId: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    staffTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
  })

  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { nik: { startsWith: 'IPWD-' } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await app.close()
    await prisma.$disconnect()
  })

  const post = (url: string, payload: object, headers?: Record<string, string>) =>
    app.inject({ method: 'POST', url: `/api/auth/${url}`, payload, headers })
  const login = (userEmail: string, password: string) => post('login', { email: userEmail, password })

  /** Buat karyawan + akun via API admin, lalu aktivasi. */
  async function activeUser(name: string, password = 'Awal123!') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: { nik: nik(name), fullName: `User ${name}`, jobTitleId: staffTitleId, account: { email: email(name) } },
    })
    const activationToken = tokenFrom(res.json().invitation.devActivationLink)
    expect((await post('activate', { token: activationToken, password })).statusCode).toBe(200)
    return { id: res.json().data.id as string, email: email(name), password, activationToken }
  }

  describe('lupa password', () => {
    it('respons generik untuk email tidak terdaftar & akun belum aktivasi', async () => {
      const unknown = await post('forgot-password', { email: email('nobody') })
      expect(unknown.statusCode).toBe(200)
      expect(unknown.json()).toEqual({ statusCode: 200, message: GENERIC })

      await app.inject({
        method: 'POST', url: '/api/employees', headers: admin,
        payload: { nik: nik('PENDING'), fullName: 'Belum Aktif', jobTitleId: staffTitleId, account: { email: email('pending') } },
      })
      const pending = await post('forgot-password', { email: email('pending') })
      expect(pending.json()).toEqual({ statusCode: 200, message: GENERIC })
    })

    it('reset: password lama tidak berlaku, sesi lama dicabut, token sekali pakai', async () => {
      const user = await activeUser('RESET')
      const oldSession = (await login(user.email, user.password)).json()

      const forgot = await post('forgot-password', { email: user.email.toUpperCase() })
      expect(forgot.json().message).toBe(GENERIC)
      const token = tokenFrom(forgot.json().devResetLink)
      expect(forgot.json().devResetLink).toContain('/reset-password?token=')

      expect((await post('reset-password', { token, password: 'lemah' })).statusCode).toBe(400)

      const reset = await post('reset-password', { token, password: 'Baru456!' })
      expect(reset.statusCode).toBe(200)
      expect(reset.json().email).toBe(user.email)

      expect((await post('reset-password', { token, password: 'Lagi789!' })).statusCode).toBe(400)
      expect((await login(user.email, user.password)).statusCode).toBe(401)
      expect((await login(user.email, 'Baru456!')).statusCode).toBe(200)
      expect((await post('refresh', { refreshToken: oldSession.refreshToken })).statusCode).toBe(401)
    })

    it('token aktivasi tidak bisa dipakai untuk reset, dan permintaan baru menghanguskan link lama', async () => {
      const user = await activeUser('PURPOSE')
      expect((await post('reset-password', { token: user.activationToken, password: 'Baru456!' })).statusCode).toBe(400)

      const first = tokenFrom((await post('forgot-password', { email: user.email })).json().devResetLink)
      const second = tokenFrom((await post('forgot-password', { email: user.email })).json().devResetLink)
      expect((await post('reset-password', { token: first, password: 'Baru456!' })).statusCode).toBe(400)
      expect((await post('reset-password', { token: second, password: 'Baru456!' })).statusCode).toBe(200)
    })

    it('karyawan nonaktif tidak mendapat link reset', async () => {
      const user = await activeUser('OFF')
      await app.inject({ method: 'PATCH', url: `/api/employees/${user.id}/status`, headers: admin, payload: { status: 'INACTIVE' } })
      const res = await post('forgot-password', { email: user.email })
      expect(res.json()).toEqual({ statusCode: 200, message: GENERIC })
    })

    it('dibatasi 3 permintaan per IP + email per 15 menit', async () => {
      const target = email('spam')
      for (let i = 0; i < 3; i++) expect((await post('forgot-password', { email: target })).statusCode).toBe(200)
      const blocked = await post('forgot-password', { email: target })
      expect(blocked.statusCode).toBe(429)
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    })

    it('format email salah → 400', async () => {
      expect((await post('forgot-password', { email: 'bukan-email' })).statusCode).toBe(400)
    })
  })

  describe('ganti password', () => {
    it('validasi, sesi lain dicabut, sesi baru diterbitkan', async () => {
      const user = await activeUser('CHANGE')
      const otherDevice = (await login(user.email, user.password)).json()
      const current = (await login(user.email, user.password)).json()
      const auth = bearer(current.accessToken)

      expect((await post('change-password', { currentPassword: user.password, newPassword: 'Ganti123!' })).statusCode).toBe(401)
      const wrong = await post('change-password', { currentPassword: 'Salah123!', newPassword: 'Ganti123!' }, auth)
      expect(wrong.statusCode).toBe(400)
      expect(wrong.json().message).toMatch(/saat ini salah/)
      const same = await post('change-password', { currentPassword: user.password, newPassword: user.password }, auth)
      expect(same.json().message).toMatch(/berbeda/)
      expect((await post('change-password', { currentPassword: user.password, newPassword: 'lemah' }, auth)).statusCode).toBe(400)

      const ok = await post('change-password', { currentPassword: user.password, newPassword: 'Ganti123!' }, auth)
      expect(ok.statusCode).toBe(200)
      expect(ok.cookies.map((c) => c.name)).toEqual(expect.arrayContaining(['arrayan_access_token', 'arrayan_refresh_token']))

      expect((await post('refresh', { refreshToken: otherDevice.refreshToken })).statusCode).toBe(401)
      expect((await post('refresh', { refreshToken: ok.json().refreshToken })).statusCode).toBe(200)
      expect((await login(user.email, user.password)).statusCode).toBe(401)
      expect((await login(user.email, 'Ganti123!')).statusCode).toBe(200)
    })
  })
})
