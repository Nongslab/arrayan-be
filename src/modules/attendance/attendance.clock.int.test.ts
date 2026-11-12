import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { bearer, createTestApp, createUserWithRole, loginAs, uniqueSuffix } from '../../test/helpers.js'

const SUFFIX = uniqueSuffix()
const email = (name: string) => `iclk.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!
const OFFICE = { latitude: -6.2, longitude: 106.8 }
/** ±50 m di utara kantor (di dalam radius 100 m) dan ±200 m (di luar). */
const NEAR = { latitude: -6.19955, longitude: 106.8 }
const FAR = { latitude: -6.1982, longitude: 106.8 }

describe('clock-in / clock-out aplikasi (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let officeId: string
  const people: Record<string, { id: string; auth: Record<string, string> }> = {}

  async function person(key: string, withOffice = true) {
    const jobTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
    const res = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: {
        nik: `ICLK-${SUFFIX}-${key}`,
        fullName: `Clock ${key}`,
        jobTitleId,
        employmentType: 'KARTAP',
        joinDate: '2025-01-01',
        ...(withOffice ? { officeLocationId: officeId } : {}),
        account: { email: email(key) },
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/auth/activate',
      payload: { token: tokenFrom(res.json().invitation.devActivationLink), password: 'ClockAman123!' },
    })
    people[key] = { id: res.json().data.id, auth: bearer(await loginAs(app, { email: email(key), password: 'ClockAman123!' })) }
  }

  const clock = (kind: 'in' | 'out', key: string, payload: object = {}, remoteAddress = '127.0.0.1') =>
    app.inject({ method: 'POST', url: `/api/attendance/clock-${kind}`, headers: people[key]!.auth, payload, remoteAddress })

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    officeId = (
      await prisma.officeLocation.create({
        data: { code: `ICLK_${SUFFIX}`, name: 'Kantor Uji', ...OFFICE, radiusMeters: 100, allowedIpRanges: ['203.0.113.0/24'] },
      })
    ).id
    for (const key of ['GPS', 'EARLYOUT', 'IP', 'RACE']) await person(key)
    await person('NOOFFICE', false)
  })

  afterAll(async () => {
    const ids = Object.values(people).map((p) => p.id)
    await prisma.attendanceLog.deleteMany({ where: { employeeId: { in: ids } } })
    await prisma.employee.deleteMany({ where: { id: { in: ids } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await prisma.officeLocation.delete({ where: { id: officeId } })
    await app.close()
    await prisma.$disconnect()
  })

  it('GPS di dalam radius: clock-in & clock-out masing-masing sekali', async () => {
    const inRes = await clock('in', 'GPS', { ...NEAR, accuracyMeters: 8 })
    expect(inRes.statusCode).toBe(200)
    const data = inRes.json().data
    expect(data).toMatchObject({ kind: 'IN', verification: 'GPS', log: { source: 'APP' } })
    expect(data.distanceMeters).toBeGreaterThan(40)
    expect(data.distanceMeters).toBeLessThanOrEqual(100)
    expect(data.day.date).toBe(data.shiftDate)

    const again = await clock('in', 'GPS', NEAR)
    expect(again.statusCode).toBe(409)
    expect(again.json().message).toMatch(/sudah tercatat masuk pukul \d{2}:\d{2}/)

    const out = await clock('out', 'GPS', NEAR)
    expect(out.statusCode).toBe(200)
    expect(out.json().data.kind).toBe('OUT')
    expect((await clock('out', 'GPS', NEAR)).json().message).toMatch(/sudah clock-out/)

    const stored = await prisma.attendanceLog.findMany({ where: { employeeId: people.GPS!.id }, orderBy: { occurredAt: 'asc' } })
    expect(stored.map((l) => [l.kind, l.verification, l.accuracyMeters])).toEqual([
      ['IN', 'GPS', 8],
      ['OUT', 'GPS', null],
    ])
  })

  it('di luar radius → 422 dengan jarak; tanpa GPS & IP bukan kantor → 422', async () => {
    const far = await clock('in', 'EARLYOUT', FAR)
    expect(far.statusCode).toBe(422)
    expect(far.json().message).toMatch(/Di luar radius Kantor Uji: jarak 2\d\d m, maksimal 100 m/)

    const noGps = await clock('in', 'EARLYOUT', {})
    expect(noGps.json().message).toMatch(/Lokasi tidak terverifikasi/)
  })

  it('clock-out sebelum clock-in → 409', async () => {
    const res = await clock('out', 'EARLYOUT', NEAR)
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toMatch(/belum clock-in/)
  })

  it('IP internet kantor sebagai alternatif GPS (web)', async () => {
    const res = await clock('in', 'IP', {}, '203.0.113.9')
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ verification: 'IP_ALLOWLIST', distanceMeters: null, log: { ip: '203.0.113.9' } })

    // GPS jauh tetapi IP kantor → tetap diterima lewat IP
    const outFarButOfficeIp = await clock('out', 'IP', FAR, '203.0.113.9')
    expect(outFarButOfficeIp.json().data.verification).toBe('IP_ALLOWLIST')
  })

  it('dua clock-in bersamaan hanya tercatat sekali', async () => {
    const [a, b] = await Promise.all([clock('in', 'RACE', NEAR), clock('in', 'RACE', NEAR)])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    expect(await prisma.attendanceLog.count({ where: { employeeId: people.RACE!.id } })).toBe(1)
  })

  it('validasi & prasyarat', async () => {
    expect((await clock('in', 'GPS', { latitude: -6.2 })).statusCode).toBe(400)
    expect((await clock('in', 'GPS', { latitude: 120, longitude: 106 })).statusCode).toBe(400)

    const noOffice = await clock('in', 'NOOFFICE', NEAR)
    expect(noOffice.statusCode).toBe(422)
    expect(noOffice.json().message).toMatch(/belum diatur/)

    const noEmployee = bearer(await loginAs(app, await createUserWithRole('STAFF')))
    expect((await app.inject({ method: 'POST', url: '/api/attendance/clock-in', headers: noEmployee, payload: NEAR })).statusCode).toBe(403)

    const badRange = await app.inject({
      method: 'PATCH',
      url: `/api/master/office-locations/${officeId}`,
      headers: admin,
      payload: { allowedIpRanges: ['kantor-pusat'] },
    })
    expect(badRange.statusCode).toBe(400)
    const okRange = await app.inject({
      method: 'PATCH',
      url: `/api/master/office-locations/${officeId}`,
      headers: admin,
      payload: { allowedIpRanges: ['203.0.113.0/24', '2001:db8::/32'] },
    })
    expect(okRange.json().data.allowedIpRanges).toEqual(['203.0.113.0/24', '2001:db8::/32'])
  })
})
