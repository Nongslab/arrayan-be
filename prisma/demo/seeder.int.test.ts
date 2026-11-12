import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../src/lib/prisma.js'
import { bearer, createTestApp, loginAs } from '../../src/test/helpers.js'
import { DEMO_EMAIL_DOMAIN, DEMO_NIK_PREFIX, DEMO_PASSWORD } from './plan.js'
import { clearDemo, seedDemo } from './seeder.js'

const TODAY = '2030-03-14'
const NOW = new Date('2030-03-14T10:00:00+07:00')
const demoCounts = async () => ({
  employees: await prisma.employee.count({ where: { nik: { startsWith: DEMO_NIK_PREFIX } } }),
  users: await prisma.user.count({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } }),
  trainings: await prisma.training.count({ where: { description: { endsWith: '(data demo)' } } }),
  events: await prisma.calendarEvent.count({ where: { description: { endsWith: '(data demo)' } } }),
})

describe('seed data demo (integration)', () => {
  let app: FastifyInstance
  let hr: Record<string, string>
  let summary: Awaited<ReturnType<typeof seedDemo>>['summary']

  beforeAll(async () => {
    app = await createTestApp()
    summary = (await seedDemo(prisma, { today: TODAY, now: NOW })).summary
    hr = bearer(await loginAs(app, { email: `siti.rahmawati@${DEMO_EMAIL_DOMAIN}`, password: DEMO_PASSWORD }))
  })

  afterAll(async () => {
    await prisma.$transaction((tx) => clearDemo(tx))
    await app.close()
    await prisma.$disconnect()
  })

  it('dashboard hari itu terisi: terlambat, cuti, sakit, ulang tahun, training', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/dashboard/today?date=${TODAY}`, headers: hr })
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    const names = (rows: { employee: { fullName: string } }[]) => rows.map((r) => r.employee.fullName)
    expect(names(d.late)).toEqual(expect.arrayContaining(['Eko Wahyudi', 'Fajar Nugroho']))
    expect(names(d.onLeave)).toEqual(['Sari Wulandari'])
    expect(names(d.sick).sort()).toEqual(['Andi Firmansyah', 'Putri Handayani'])
    expect(names(d.birthdays)).toContain('Fajar Nugroho')
    expect(d.trainings.length).toBeGreaterThan(0)
  })

  it('akun demo sesuai status: pending & nonaktif tidak bisa login', async () => {
    const login = (email: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${email}@${DEMO_EMAIL_DOMAIN}`, password: DEMO_PASSWORD } })
    expect((await login('hendra.wijaya')).statusCode).toBe(200)
    expect((await login('intan.permata')).statusCode).not.toBe(200)
    expect((await login('rudi.hartono')).statusCode).not.toBe(200)
  })

  it('saldo cuti seluruh karyawan demo tidak negatif', async () => {
    const employees = await prisma.employee.findMany({ where: { nik: { startsWith: DEMO_NIK_PREFIX }, status: 'ACTIVE' }, select: { id: true } })
    for (const { id } of employees) {
      const res = await app.inject({ method: 'GET', url: `/api/leaves/balance/${id}?year=2030`, headers: hr })
      expect(res.statusCode).toBe(200)
      for (const b of res.json().data as { available: number | null }[]) {
        if (b.available !== null) expect(b.available).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('rekap tim atasan berisi bawahan dengan status hadir/terlambat', async () => {
    const spv = bearer(await loginAs(app, { email: `nur.aisyah@${DEMO_EMAIL_DOMAIN}`, password: DEMO_PASSWORD }))
    const res = await app.inject({ method: 'GET', url: '/api/attendance/team?from=2030-03-04&to=2030-03-13', headers: spv })
    expect(res.statusCode).toBe(200)
    const rows = res.json().data as { employee: { fullName: string }; summary: { PRESENT_ON_TIME: number; LATE: number } }[]
    expect(rows.map((r) => r.employee.fullName)).toEqual(expect.arrayContaining(['Dimas Saputra', 'Eko Wahyudi', 'Putri Handayani']))
    expect(rows.reduce((n, r) => n + r.summary.PRESENT_ON_TIME + r.summary.LATE, 0)).toBeGreaterThan(20)
  })

  it('idempoten: dijalankan ulang tidak menggandakan data; clear menghapus semuanya', async () => {
    const before = await demoCounts()
    expect(before).toEqual({ employees: summary.employees, users: summary.accounts, trainings: summary.trainings, events: summary.events })

    const again = await seedDemo(prisma, { today: TODAY, now: NOW })
    expect(again.removed).toBe(summary.employees)
    expect(await demoCounts()).toEqual(before)

    await prisma.$transaction((tx) => clearDemo(tx))
    expect(await demoCounts()).toEqual({ employees: 0, users: 0, trainings: 0, events: 0 })
    expect(await prisma.user.count({ where: { email: 'superadmin@arrayan.com' } })).toBe(1)
  })
})
