import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { bearer, createTestApp, createUserWithRole, loginAs, uniqueSuffix } from '../../test/helpers.js'

const PREFIX = 'ITEST'
const code = (name: string) => `${PREFIX}_${name}_${uniqueSuffix()}`

describe('master data API (integration)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let staff: Record<string, string>

  beforeAll(async () => {
    app = await createTestApp()
    admin = bearer(await loginAs(app))
    staff = bearer(await loginAs(app, await createUserWithRole('STAFF')))
  })

  afterAll(async () => {
    // Bersihkan data test (anak dulu karena FK Restrict).
    await prisma.kpiTemplate.deleteMany({ where: { code: { startsWith: PREFIX } } })
    const departments = await prisma.department.findMany({
      where: { code: { startsWith: PREFIX } },
      orderBy: { createdAt: 'desc' },
    })
    for (const d of departments) await prisma.department.delete({ where: { id: d.id } })
    for (const model of [prisma.workShift, prisma.holiday, prisma.officeLocation, prisma.leaveType, prisma.trainingCategory, prisma.jobTitle] as const) {
      await (model as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { code: { startsWith: PREFIX } } })
    }
    await prisma.user.deleteMany({ where: { email: { endsWith: '@arrayan.test' } } })
    await app.close()
    await prisma.$disconnect()
  })

  const post = (url: string, payload: object, headers = admin) =>
    app.inject({ method: 'POST', url: `/api/master/${url}`, payload, headers })
  const patch = (url: string, payload: object, headers = admin) =>
    app.inject({ method: 'PATCH', url: `/api/master/${url}`, payload, headers })
  const get = (url: string, headers = admin) => app.inject({ method: 'GET', url: `/api/master/${url}`, headers })

  describe('akses', () => {
    it('401 tanpa token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/master/departments' })
      expect(res.statusCode).toBe(401)
    })

    it('STAFF boleh membaca daftar aktif', async () => {
      const res = await get('departments', staff)
      expect(res.statusCode).toBe(200)
      expect(res.json().data.map((d: { code: string }) => d.code)).toContain('HQ')
    })

    it('STAFF tidak boleh membuat data (403)', async () => {
      const res = await post('training-categories', { code: code('TC'), name: 'Test' }, staff)
      expect(res.statusCode).toBe(403)
    })
  })

  describe('departments', () => {
    it('membuat sub-departemen, menolak code duplikat, dan menolak siklus', async () => {
      const hq = (await get('departments?q=HQ')).json().data.find((d: { code: string }) => d.code === 'HQ')

      const parentCode = code('PARENT')
      const parent = await post('departments', { code: parentCode, name: 'Parent Test', parentId: hq.id })
      expect(parent.statusCode).toBe(201)
      expect(parent.json().data.parent).toMatchObject({ code: 'HQ' })

      const child = await post('departments', { code: code('CHILD'), name: 'Child Test', parentId: parent.json().data.id })
      expect(child.statusCode).toBe(201)

      const duplicate = await post('departments', { code: parentCode, name: 'Duplikat' })
      expect(duplicate.statusCode).toBe(409)

      const cycle = await patch(`departments/${parent.json().data.id}`, { parentId: child.json().data.id })
      expect(cycle.statusCode).toBe(422)
      expect(cycle.json().message).toMatch(/siklus/)
    })

    it('menolak code yang bukan UPPER_SNAKE (400) dan perubahan code (400)', async () => {
      const bad = await post('departments', { code: 'finance-team', name: 'Finance' })
      expect(bad.statusCode).toBe(400)
      expect(bad.json().details[0].path).toBe('code')

      const created = await post('departments', { code: code('RENAME'), name: 'Before' })
      const id = created.json().data.id
      expect((await patch(`departments/${id}`, { code: 'OTHER' })).statusCode).toBe(400)

      const renamed = await patch(`departments/${id}`, { name: 'After' })
      expect(renamed.statusCode).toBe(200)
      expect(renamed.json().data.name).toBe('After')
    })

    it('nonaktif tersembunyi dari daftar, kecuali admin dengan includeInactive', async () => {
      const deptCode = code('INACTIVE')
      const id = (await post('departments', { code: deptCode, name: 'Akan Nonaktif' })).json().data.id

      const off = await patch(`departments/${id}/active`, { isActive: false })
      expect(off.statusCode).toBe(200)
      expect(off.json().data.isActive).toBe(false)

      const codesOf = (res: { json(): { data: Array<{ code: string }> } }) => res.json().data.map((d) => d.code)
      expect(codesOf(await get(`departments?q=${deptCode}`))).not.toContain(deptCode)
      expect(codesOf(await get(`departments?q=${deptCode}&includeInactive=true`))).toContain(deptCode)
      expect(codesOf(await get(`departments?q=${deptCode}&includeInactive=true`, staff))).not.toContain(deptCode)
    })

    it('404 untuk id yang tidak ada, 400 untuk id bukan UUID', async () => {
      expect((await get('departments/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
      expect((await get('departments/not-a-uuid')).statusCode).toBe(400)
    })
  })

  describe('work-shifts', () => {
    it('shift malam wajib isOvernight, termasuk saat PATCH sebagian', async () => {
      const bad = await post('work-shifts', { code: code('NIGHT'), name: 'Malam', startTime: '22:00', endTime: '06:00' })
      expect(bad.statusCode).toBe(400)
      expect(bad.json().message).toMatch(/isOvernight/)

      const ok = await post('work-shifts', {
        code: code('NIGHT'),
        name: 'Malam',
        startTime: '22:00',
        endTime: '06:00',
        isOvernight: true,
        workDays: [5, 1, 3],
      })
      expect(ok.statusCode).toBe(201)
      expect(ok.json().data.workDays).toEqual([1, 3, 5])

      const id = ok.json().data.id
      expect((await patch(`work-shifts/${id}`, { isOvernight: false })).statusCode).toBe(400)
      expect((await patch(`work-shifts/${id}`, { startTime: '25:00' })).statusCode).toBe(400)
    })
  })

  describe('office-locations', () => {
    it('validasi koordinat dan normalisasi BSSID', async () => {
      const bad = await post('office-locations', { code: code('OFF'), name: 'Kantor', latitude: 120, longitude: 106 })
      expect(bad.statusCode).toBe(400)

      const ok = await post('office-locations', {
        code: code('OFF'),
        name: 'Kantor Test',
        latitude: -6.2,
        longitude: 106.816666,
        wifiBssids: ['aa:bb:cc:dd:ee:ff'],
      })
      expect(ok.statusCode).toBe(201)
      expect(ok.json().data).toMatchObject({
        latitude: -6.2,
        longitude: 106.816666,
        radiusMeters: 100,
        wifiBssids: ['AA:BB:CC:DD:EE:FF'],
        timezone: 'Asia/Jakarta',
      })
    })
  })

  describe('holidays', () => {
    it('format tanggal yyyy-MM-dd dan filter tahun', async () => {
      expect((await post('holidays', { code: code('HOL'), name: 'Libur', date: '2030-02-30', kind: 'COMPANY' })).statusCode).toBe(400)

      const holidayCode = code('HOL')
      const ok = await post('holidays', { code: holidayCode, name: 'Libur Test', date: '2031-05-04', kind: 'COMPANY' })
      expect(ok.statusCode).toBe(201)
      expect(ok.json().data.date).toBe('2031-05-04')

      const in2031 = (await get('holidays?year=2031')).json().data.map((h: { code: string }) => h.code)
      const in2026 = (await get('holidays?year=2026')).json().data.map((h: { code: string }) => h.code)
      expect(in2031).toContain(holidayCode)
      expect(in2026).not.toContain(holidayCode)
    })
  })

  describe('kpi-templates', () => {
    it('validasi bobot, membuat template, dan mengganti indikator via PATCH', async () => {
      const bad = await post('kpi-templates', {
        code: code('KPI'),
        name: 'KPI Salah',
        indicators: [{ name: 'Sikap', type: 'QUALITATIVE', weight: 60 }],
      })
      expect(bad.statusCode).toBe(400)
      expect(bad.json().message).toMatch(/100/)

      const staffTitle = (await get('job-titles?q=STAFF')).json().data.find((j: { code: string }) => j.code === 'STAFF')
      const created = await post('kpi-templates', {
        code: code('KPI'),
        name: 'KPI Test',
        jobTitleId: staffTitle.id,
        indicators: [
          { name: 'Output', type: 'QUANTITATIVE', weight: 70, target: 20, unit: 'tiket' },
          { name: 'Sikap', type: 'QUALITATIVE', weight: 30 },
        ],
      })
      expect(created.statusCode).toBe(201)
      const template = created.json().data
      expect(template.jobTitle).toMatchObject({ code: 'STAFF' })
      expect(template.indicators.map((i: { weight: number }) => i.weight)).toEqual([70, 30])

      const replaced = await patch(`kpi-templates/${template.id}`, {
        indicators: [{ name: 'Satu-satunya', type: 'QUALITATIVE', weight: 100 }],
      })
      expect(replaced.statusCode).toBe(200)
      expect(replaced.json().data.indicators).toHaveLength(1)
      expect(await prisma.kpiIndicator.count({ where: { templateId: template.id } })).toBe(1)
    })

    it('referensi jabatan yang tidak ada → 422', async () => {
      const res = await post('kpi-templates', {
        code: code('KPI'),
        name: 'KPI Ref Salah',
        jobTitleId: '00000000-0000-4000-8000-000000000000',
        indicators: [{ name: 'Sikap', type: 'QUALITATIVE', weight: 100 }],
      })
      expect(res.statusCode).toBe(422)
    })
  })

  describe('list umum', () => {
    it('seluruh entitas master dapat dibaca dengan paginasi', async () => {
      for (const path of [
        'departments',
        'job-titles',
        'office-locations',
        'work-shifts',
        'leave-types',
        'holidays',
        'training-categories',
        'kpi-templates',
      ]) {
        const res = await get(`${path}?limit=2`)
        expect(res.statusCode, path).toBe(200)
        expect(res.json().meta).toMatchObject({ page: 1, limit: 2 })
        expect(res.json().data.length, path).toBeLessThanOrEqual(2)
        expect(res.json().meta.total, path).toBeGreaterThan(0)
      }
    })
  })
})
