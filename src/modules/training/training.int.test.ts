import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { bearer, createTestApp, loginAs, uniqueSuffix } from '../../test/helpers.js'

const SUFFIX = uniqueSuffix()
const nik = (name: string) => `ITRN-${SUFFIX}-${name}`
const email = (name: string) => `itrn.${name}.${SUFFIX}@arrayan.test`.toLowerCase()
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!
const iso = (offsetDays: number, hour: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10) + `T${String(hour).padStart(2, '0')}:00:00+07:00`
const dateOf = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

interface Participant {
  employee: { id: string; fullName: string }
  remarks: string | null
  rating: number | null
  attended: boolean | null
}

describe('manajemen training (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let categoryId: string
  const people: Record<string, { id: string; auth: Record<string, string> }> = {}
  let pastId: string
  let futureId: string

  async function person(key: string, title = 'STAFF') {
    const jobTitleId = (await prisma.jobTitle.findUniqueOrThrow({ where: { code: title } })).id
    const res = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: admin,
      payload: { nik: nik(key), fullName: `Training ${key}`, jobTitleId, employmentType: 'KARTAP', joinDate: '2025-01-01', account: { email: email(key) } },
    })
    await app.inject({
      method: 'POST',
      url: '/api/auth/activate',
      payload: { token: tokenFrom(res.json().invitation.devActivationLink), password: 'TrainAman123!' },
    })
    people[key] = { id: res.json().data.id, auth: bearer(await loginAs(app, { email: email(key), password: 'TrainAman123!' })) }
  }

  const create = (payload: Record<string, unknown>, headers = admin) =>
    app.inject({ method: 'POST', url: '/api/trainings', headers, payload: { categoryId, ...payload } })
  const list = (query: string, headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: `/api/trainings?${query}`, headers })
  const remarks = (id: string, headers: Record<string, string>, payload: object) =>
    app.inject({ method: 'PUT', url: `/api/trainings/${id}/remarks`, headers, payload })

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    categoryId = (await prisma.trainingCategory.findUniqueOrThrow({ where: { code: 'INTERNAL' } })).id
    await person('A')
    await person('B')
    await person('C')
    await person('DIR', 'DIRECTOR')
  })

  afterAll(async () => {
    const ids = Object.values(people).map((p) => p.id)
    await prisma.training.deleteMany({ where: { title: { contains: SUFFIX } } })
    await prisma.employee.deleteMany({ where: { id: { in: ids } } })
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await prisma.trainingCategory.deleteMany({ where: { code: { startsWith: 'ITRN_' } } })
    await app.close()
    await prisma.$disconnect()
  })

  it('HR menjadwalkan training dengan peserta; validasi', async () => {
    const past = await create({
      title: `Onboarding ${SUFFIX}`,
      organizer: 'HRD',
      location: 'Ruang A',
      startAt: iso(-10, 9),
      endAt: iso(-10, 12),
      participantIds: [people.A!.id, people.B!.id],
    })
    expect(past.statusCode).toBe(201)
    expect(past.json().data).toMatchObject({ status: 'SCHEDULED', participantCount: 2, category: { code: 'INTERNAL' } })
    pastId = past.json().data.id

    const future = await create({ title: `Workshop ${SUFFIX}`, startAt: iso(5, 9), endAt: iso(5, 16), participantIds: [people.A!.id] })
    futureId = future.json().data.id

    expect((await create({ title: `Salah ${SUFFIX}`, startAt: iso(5, 12), endAt: iso(5, 9) })).statusCode).toBe(400)
    expect((await create({ title: `Salah ${SUFFIX}`, startAt: '2026-12-01 09:00', endAt: iso(5, 9) })).statusCode).toBe(400)

    const inactiveCategory = await prisma.trainingCategory.create({ data: { code: `ITRN_OFF_${SUFFIX}`, name: 'Off', isActive: false } })
    const badCategory = await create({ title: `Salah ${SUFFIX}`, categoryId: inactiveCategory.id, startAt: iso(5, 9), endAt: iso(5, 10) })
    expect(badCategory.statusCode).toBe(422)

    const badParticipant = await create({
      title: `Salah ${SUFFIX}`,
      startAt: iso(5, 9),
      endAt: iso(5, 10),
      participantIds: ['00000000-0000-4000-8000-000000000000'],
    })
    expect(badParticipant.statusCode).toBe(422)
    expect((await create({ title: `Staf ${SUFFIX}`, startAt: iso(5, 9), endAt: iso(5, 10) }, people.A!.auth)).statusCode).toBe(403)

    expect(await prisma.auditLog.count({ where: { action: 'training.create', entityId: pastId } })).toBe(1)
  })

  it('agenda untuk semua karyawan, dengan tanda peserta & filter mine/tanggal', async () => {
    const forC = await list(`from=${dateOf(-30)}&to=${dateOf(30)}`, people.C!.auth)
    const mine = (forC.json().data as Array<{ id: string; isParticipant: boolean }>).filter((t) => [pastId, futureId].includes(t.id))
    expect(mine).toHaveLength(2)
    expect(mine.every((t) => t.isParticipant === false)).toBe(true)

    expect((await list('mine=true', people.C!.auth)).json().meta.total).toBe(0)
    const forA = (await list('mine=true', people.A!.auth)).json().data.map((t: { id: string }) => t.id)
    expect(forA).toEqual(expect.arrayContaining([pastId, futureId]))

    const upcoming = (await list(`from=${dateOf(0)}&mine=true`, people.A!.auth)).json().data.map((t: { id: string }) => t.id)
    expect(upcoming).toEqual([futureId])
  })

  it('remarks: hanya peserta, setelah selesai; terlihat oleh HR & dirinya saja', async () => {
    expect((await remarks(futureId, people.A!.auth, { remarks: 'Belum mulai' })).statusCode).toBe(409)
    expect((await remarks(pastId, people.C!.auth, { remarks: 'Bukan peserta' })).statusCode).toBe(404)
    expect((await remarks(pastId, people.A!.auth, { remarks: 'Bagus', rating: 6 })).statusCode).toBe(400)

    const ok = await remarks(pastId, people.A!.auth, { remarks: 'Materi sangat membantu', rating: 5 })
    expect(ok.statusCode).toBe(200)

    const participantsFor = async (headers: Record<string, string>) =>
      (await app.inject({ method: 'GET', url: `/api/trainings/${pastId}`, headers })).json().data.participants as Participant[]
    const aFromB = (await participantsFor(people.B!.auth)).find((p) => p.employee.id === people.A!.id)!
    expect(aFromB).toMatchObject({ remarks: null, rating: null })
    const aFromA = (await participantsFor(people.A!.auth)).find((p) => p.employee.id === people.A!.id)!
    expect(aFromA).toMatchObject({ remarks: 'Materi sangat membantu', rating: 5 })
    const aFromAdmin = (await participantsFor(admin)).find((p) => p.employee.id === people.A!.id)!
    expect(aFromAdmin.remarks).toBe('Materi sangat membantu')
  })

  it('atur peserta: yang sudah memberi remarks tidak bisa dikeluarkan; tandai kehadiran', async () => {
    const put = (employeeIds: string[]) =>
      app.inject({ method: 'PUT', url: `/api/trainings/${pastId}/participants`, headers: admin, payload: { employeeIds } })

    const blocked = await put([people.B!.id])
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().message).toMatch(/Training A/)

    const ok = await put([people.A!.id, people.C!.id])
    expect(ok.statusCode).toBe(200)
    expect((ok.json().data.participants as Participant[]).map((p) => p.employee.id).sort()).toEqual([people.A!.id, people.C!.id].sort())

    const mark = (employeeId: string, attended: boolean) =>
      app.inject({ method: 'PATCH', url: `/api/trainings/${pastId}/participants/${employeeId}`, headers: admin, payload: { attended } })
    expect((await mark(people.B!.id, true)).statusCode).toBe(404)
    expect((await mark(people.A!.id, true)).statusCode).toBe(200)
    expect((await mark(people.C!.id, false)).statusCode).toBe(200)
  })

  it('laporan HR/Management: baris per peserta & ringkasan kategori; staf 403', async () => {
    const url = `/api/trainings/report?from=${dateOf(-15)}&to=${dateOf(-5)}&categoryId=${categoryId}`
    const res = await app.inject({ method: 'GET', url, headers: people.DIR!.auth })
    expect(res.statusCode).toBe(200)
    const rows = (res.json().data as Array<{ training: { id: string }; employee: { id: string }; attended: boolean; rating: number | null }>).filter(
      (r) => r.training.id === pastId,
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.employee.id === people.A!.id)).toMatchObject({ attended: true, rating: 5 })
    const internal = res.json().summary.find((s: { category: { code: string } }) => s.category.code === 'INTERNAL')
    expect(internal.trainings).toBeGreaterThanOrEqual(1)
    expect(internal.averageRating).not.toBeNull()

    expect((await app.inject({ method: 'GET', url, headers: people.A!.auth })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url, headers: admin })).statusCode).toBe(200)
  })

  it('pembatalan: tercatat audit dan hilang dari agenda default', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/trainings/${futureId}`, headers: admin, payload: { status: 'CANCELLED' } })
    expect(res.json().data.status).toBe('CANCELLED')
    expect(await prisma.auditLog.count({ where: { action: 'training.cancel', entityId: futureId } })).toBe(1)

    const ids = (q: string) => list(q, people.A!.auth).then((r) => r.json().data.map((t: { id: string }) => t.id))
    expect(await ids('mine=true')).not.toContain(futureId)
    expect(await ids('mine=true&includeCancelled=true')).toContain(futureId)
    expect((await remarks(futureId, people.A!.auth, { remarks: 'Batal' })).statusCode).toBe(409)
  })
})
