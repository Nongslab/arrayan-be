import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { addDays, fromDateOnly, toDateOnly } from '../../lib/dates.js'
import { bearer, createTestApp, loginAs, uniqueSuffix } from '../../test/helpers.js'
import { todayInJakarta } from './employee.schema.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `IPRB-${SUFFIX}-${name}`
const inDays = (days: number) => toDateOnly(addDays(fromDateOnly(todayInJakarta()), days))

describe('pelacakan probation (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let staffTitleId: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    staffTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: 'STAFF' } })).id
  })

  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { nik: { startsWith: 'IPRB-' } } })
    await app.close()
    await prisma.$disconnect()
  })

  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/employees', headers: admin, payload: { jobTitleId: staffTitleId, ...payload } })
  const patch = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/api/employees/${id}`, headers: admin, payload })

  it('default joinDate + 6 bulan (dibulatkan ke akhir bulan); non-PROBATION null', async () => {
    const probation = await create({ nik: nik('DEF'), fullName: 'Default', employmentType: 'PROBATION', joinDate: '2026-08-31' })
    expect(probation.json().data.probationEndDate).toBe('2027-02-28')

    const implicit = await create({ nik: nik('IMP'), fullName: 'Tanpa Tipe', joinDate: '2026-01-15' })
    expect(implicit.json().data).toMatchObject({ employmentType: 'PROBATION', probationEndDate: '2026-07-15' })

    const permanent = await create({ nik: nik('KTP'), fullName: 'Tetap', employmentType: 'KARTAP', joinDate: '2026-01-15' })
    expect(permanent.json().data.probationEndDate).toBeNull()
  })

  it('validasi nilai manual', async () => {
    const manual = await create({ nik: nik('MAN'), fullName: 'Manual', joinDate: '2026-01-15', probationEndDate: '2026-04-15' })
    expect(manual.json().data.probationEndDate).toBe('2026-04-15')

    const notProbation = await create({ nik: nik('BAD1'), fullName: 'Salah', employmentType: 'PKL', probationEndDate: '2026-04-15' })
    expect(notProbation.statusCode).toBe(400)
    expect(notProbation.json().message).toMatch(/hanya untuk employmentType PROBATION/)

    const beforeJoin = await create({ nik: nik('BAD2'), fullName: 'Salah', joinDate: '2026-05-01', probationEndDate: '2026-04-15' })
    expect(beforeJoin.json().message).toMatch(/setelah joinDate/)
  })

  it('update: hitung ulang bila default, pertahankan bila manual, riwayat saat diangkat KARTAP', async () => {
    const auto = (await create({ nik: nik('UPD'), fullName: 'Auto', joinDate: '2026-01-10' })).json().data
    expect((await patch(auto.id, { joinDate: '2026-02-01' })).json().data.probationEndDate).toBe('2026-08-01')

    const manual = (await create({ nik: nik('UPDM'), fullName: 'Manual', joinDate: '2026-01-10', probationEndDate: '2026-05-01' })).json().data
    expect((await patch(manual.id, { joinDate: '2026-02-01' })).json().data.probationEndDate).toBe('2026-05-01')

    const cleared = await patch(auto.id, { probationEndDate: null })
    expect(cleared.statusCode).toBe(400)

    const promoted = await patch(auto.id, { employmentType: 'KARTAP' })
    expect(promoted.json().data).toMatchObject({ employmentType: 'KARTAP', probationEndDate: '2026-08-01' })

    const [log] = await prisma.auditLog.findMany({
      where: { action: 'employee.update', entityId: auto.id },
      orderBy: { seq: 'desc' },
      take: 1,
    })
    expect(log!.changes).toEqual({ employmentType: { from: 'PROBATION', to: 'KARTAP' } })
  })

  it('filter probationEndingWithinDays: termasuk yang lewat, urut paling mendesak, tanpa KARTAP/nonaktif', async () => {
    const make = (key: string, end: string, extra: Record<string, unknown> = {}) =>
      create({ nik: nik(`F-${key}`), fullName: `Filter ${key}`, joinDate: '2025-01-01', probationEndDate: end, ...extra })

    await make('LATE', inDays(-5))
    await make('SOON', inDays(10))
    await make('LATER', inDays(60))
    const promoted = (await make('DONE', inDays(3))).json().data
    await patch(promoted.id, { employmentType: 'KARTAP' })
    const gone = (await make('GONE', inDays(2))).json().data
    await app.inject({ method: 'PATCH', url: `/api/employees/${gone.id}/status`, headers: admin, payload: { status: 'INACTIVE' } })

    const res = await app.inject({
      method: 'GET',
      url: `/api/employees?q=IPRB-${SUFFIX}-F-&probationEndingWithinDays=30`,
      headers: admin,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((e: { nik: string }) => e.nik)).toEqual([nik('F-LATE'), nik('F-SOON')])

    expect((await app.inject({ method: 'GET', url: '/api/employees?probationEndingWithinDays=999', headers: admin })).statusCode).toBe(400)
  })
})
