import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, authorize } from '../../middlewares/auth.middleware.js'
import { auditContextFrom } from '../../lib/audit.js'
import { addCorrection, listLogs, voidLog } from './attendance.corrections.js'
import { HttpError } from '../../lib/http-error.js'
import {
  errorResponses,
  idParamsSchema,
  paginationMetaSchema,
  paginationQuery,
  parse,
  sendError,
  toJsonSchema,
  zodOnlyValidator,
} from '../../lib/route-helpers.js'
import { departmentWithDescendants } from '../employee/employee.service.js'
import { isValidDateOnly } from '../master/master.rules.js'
import { todayInJakarta } from '../employee/employee.schema.js'
import {
  ATTENDANCE_STATUSES,
  attendanceDays,
  attendanceRecap,
  descendantIds,
  summarize,
} from './attendance.service.js'

const dateOnly = z.string().refine(isValidDateOnly, 'format yyyy-MM-dd yang valid')
const MAX_RANGE_DAYS = 62

export const attendanceRangeSchema = z
  .object({
    from: dateOnly.optional().describe('Default awal bulan berjalan (Asia/Jakarta)'),
    to: dateOnly.optional().describe('Default hari ini'),
  })
  .transform((q) => {
    const today = todayInJakarta()
    return { from: q.from ?? `${today.slice(0, 8)}01`, to: q.to ?? today }
  })
  .refine((q) => q.from <= q.to, { message: 'from harus ≤ to', path: ['from'] })
  .refine(
    (q) => new Date(`${q.to}T00:00:00Z`).getTime() - new Date(`${q.from}T00:00:00Z`).getTime() <= (MAX_RANGE_DAYS - 1) * 86_400_000,
    { message: `rentang maksimal ${MAX_RANGE_DAYS} hari`, path: ['to'] },
  )

const statusEnum = z.enum(ATTENDANCE_STATUSES as [string, ...string[]])

const daySchema = z.object({
  date: z.string(),
  status: statusEnum.describe(
    'PRESENT_ON_TIME, LATE, ABSENT, ON_LEAVE, SICK, HOLIDAY, DAY_OFF, SCHEDULED (belum waktunya / belum lewat batas toleransi)',
  ),
  clockIn: z.string().nullable(),
  clockOut: z.string().nullable(),
  lateMinutes: z.number().int().describe('Dihitung dari jam mulai shift'),
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
})

const summarySchema = z.object({
  ...Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, z.number().int()])),
  totalLateMinutes: z.number().int(),
})

const includeDaysField = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true')
  .describe('Sertakan status per hari tiap karyawan')

const teamQuerySchema = z
  .object({ from: dateOnly.optional(), to: dateOnly.optional(), includeDays: includeDaysField, ...paginationQuery })
  .transform((q) => ({ ...q, ...rangeDefaults(q) }))
  .refine((q) => q.from <= q.to, { message: 'from harus ≤ to', path: ['from'] })
  .refine(withinMaxRange, { message: `rentang maksimal ${MAX_RANGE_DAYS} hari`, path: ['to'] })

const companyQuerySchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    departmentId: z.string().uuid().optional(),
    includeSubDepartments: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    includeDays: includeDaysField,
    ...paginationQuery,
  })
  .transform((q) => ({ ...q, ...rangeDefaults(q) }))
  .refine((q) => q.from <= q.to, { message: 'from harus ≤ to', path: ['from'] })
  .refine(withinMaxRange, { message: `rentang maksimal ${MAX_RANGE_DAYS} hari`, path: ['to'] })

const recapItemJson = {
  type: 'object',
  properties: {
    employee: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nik: { type: 'string' },
        fullName: { type: 'string' },
        jobTitle: {
          type: 'object',
          properties: { id: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, level: { type: 'string' } },
        },
        department: {
          type: 'object',
          nullable: true,
          properties: { id: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' } },
        },
      },
    },
    summary: toJsonSchema(summarySchema),
    days: { type: 'array', items: toJsonSchema(daySchema) },
  },
}

const recapResponse = {
  200: {
    type: 'object',
    properties: {
      statusCode: { type: 'number' },
      data: { type: 'array', items: recapItemJson },
      meta: {
        type: 'object',
        properties: { ...paginationMetaSchema.properties, from: { type: 'string' }, to: { type: 'string' } },
      },
    },
  },
  ...errorResponses(400, 401, 403),
}

function rangeDefaults(q: { from?: string; to?: string }) {
  const today = todayInJakarta()
  return { from: q.from ?? `${today.slice(0, 8)}01`, to: q.to ?? today }
}

function withinMaxRange(q: { from: string; to: string }) {
  return (
    new Date(`${q.to}T00:00:00Z`).getTime() - new Date(`${q.from}T00:00:00Z`).getTime() <=
    (MAX_RANGE_DAYS - 1) * 86_400_000
  )
}

/** Boleh melihat kehadiran seluruh perusahaan: SUPER_ADMIN (`all`) & Management (`company.read_all`). */
function canReadCompany(request: FastifyRequest): boolean {
  const permissions = request.userSession?.role.permissions ?? []
  return permissions.includes('all') || permissions.includes('company.read_all')
}

export const attendanceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.setValidatorCompiler(zodOnlyValidator)

  fastify.get('/me', {
    preHandler: [authenticate],
    schema: {
      tags: ['Attendance'],
      summary: 'Kehadiran saya per hari',
      description:
        'Status harian dihitung dari log absensi, shift, hari libur, dan cuti yang disetujui (zona waktu kantor). ' +
        `Default awal bulan s.d. hari ini, maks. ${MAX_RANGE_DAYS} hari. Tanggal sebelum masuk kerja tidak ditampilkan.`,
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(attendanceRangeSchema),
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            data: { type: 'array', items: toJsonSchema(daySchema) },
            summary: toJsonSchema(summarySchema),
            meta: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
          },
        },
        ...errorResponses(400, 401, 403),
      },
    },
    handler: async (request, reply) => {
      try {
        const { from, to } = parse(attendanceRangeSchema, request.query)
        const employeeId = request.userSession?.employee?.id
        if (!employeeId) throw new HttpError(403, 'Akun ini tidak terhubung dengan data karyawan')
        const days = await attendanceDays(employeeId, from, to)
        return reply.send({ statusCode: 200, data: days, summary: summarize(days), meta: { from, to } })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // US-3.4: rekap tim (seluruh bawahan, semua level)
  fastify.get('/team', {
    preHandler: [authenticate],
    schema: {
      tags: ['Attendance'],
      summary: 'Rekap kehadiran tim saya',
      description:
        'Rekap seluruh bawahan (semua level di bawah saya pada pohon organisasi), termasuk yang keluar di tengah rentang. ' +
        'Kosong bila tidak punya bawahan.',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(teamQuerySchema),
      response: recapResponse,
    },
    handler: async (request, reply) => {
      try {
        const q = parse(teamQuerySchema, request.query)
        const employeeId = request.userSession?.employee?.id
        if (!employeeId) throw new HttpError(403, 'Akun ini tidak terhubung dengan data karyawan')
        const ids = await descendantIds(employeeId)
        return reply.send({ statusCode: 200, ...(await attendanceRecap({ id: { in: ids } }, q)) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // US-3.4: rekap seluruh perusahaan (HR & Management)
  fastify.get('/', {
    preHandler: [authenticate],
    schema: {
      tags: ['Attendance'],
      summary: 'Rekap kehadiran perusahaan',
      description: 'Khusus SUPER_ADMIN & Management (permission `company.read_all`). Filter departemen opsional.',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(companyQuerySchema),
      response: recapResponse,
    },
    handler: async (request, reply) => {
      try {
        if (!canReadCompany(request)) throw new HttpError(403, 'Anda tidak memiliki hak akses untuk tindakan ini.')
        const q = parse(companyQuerySchema, request.query)
        const where = q.departmentId
          ? {
              departmentId: q.includeSubDepartments
                ? { in: await departmentWithDescendants(q.departmentId) }
                : q.departmentId,
            }
          : {}
        return reply.send({ statusCode: 200, ...(await attendanceRecap(where, q)) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // US-3.4: detail per hari satu karyawan
  fastify.get('/employees/:id', {
    preHandler: [authenticate],
    schema: {
      tags: ['Attendance'],
      summary: 'Kehadiran per hari seorang karyawan',
      description: 'Untuk diri sendiri, atasan di rantai atasnya, atau SUPER_ADMIN/Management. Lainnya → 404.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      querystring: toJsonSchema(attendanceRangeSchema),
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            data: { type: 'array', items: toJsonSchema(daySchema) },
            summary: toJsonSchema(summarySchema),
            meta: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
          },
        },
        ...errorResponses(400, 401, 404),
      },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const { from, to } = parse(attendanceRangeSchema, request.query)
        const self = request.userSession?.employee?.id
        const allowed =
          canReadCompany(request) || id === self || (self ? (await descendantIds(self)).includes(id) : false)
        if (!allowed) throw new HttpError(404, 'Karyawan tidak ditemukan')

        const days = await attendanceDays(id, from, to)
        return reply.send({ statusCode: 200, data: days, summary: summarize(days), meta: { from, to } })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // ---------------------------------------------------------------------------
  // US-3.5: koreksi absensi oleh HR
  // ---------------------------------------------------------------------------
  const ADMIN_ONLY = [authenticate, authorize(['SUPER_ADMIN'])]
  const instant = z.string().datetime({ offset: true, message: 'format ISO-8601 dengan zona waktu, mis. 2026-11-16T17:05:00+07:00' })
  const correctionSchema = z
    .object({
      employeeId: z.string().uuid(),
      occurredAt: instant,
      note: z.string().trim().min(5, 'alasan minimal 5 karakter').max(500),
    })
    .strict()
  const voidSchema = z.object({ reason: z.string().trim().min(5, 'alasan minimal 5 karakter').max(500) }).strict()
  const logsQuerySchema = z
    .object({
      employeeId: z.string().uuid(),
      from: dateOnly,
      to: dateOnly,
      includeVoided: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    })
    .refine((q) => q.from <= q.to, { message: 'from harus ≤ to', path: ['from'] })
    .refine(withinMaxRange, { message: `rentang maksimal ${MAX_RANGE_DAYS} hari`, path: ['to'] })
  const logJson = toJsonSchema(
    z.object({
      id: z.string(),
      employeeId: z.string(),
      occurredAt: z.string(),
      source: z.enum(['APP', 'FINGERPRINT', 'MANUAL']),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      ip: z.string().nullable(),
      deviceCode: z.string().nullable(),
      note: z.string().nullable(),
      voided: z.boolean(),
      voidedAt: z.string().nullable(),
      voidReason: z.string().nullable(),
      createdAt: z.string(),
    }),
  )
  const logEnvelope = {
    type: 'object',
    properties: { statusCode: { type: 'number' }, message: { type: 'string' }, data: logJson },
  }

  fastify.post('/corrections', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: ['Attendance'],
      summary: 'Tambah log absensi manual (HR)',
      description:
        'Untuk lupa clock-in/out atau mesin rusak. Alasan wajib; tercatat di audit log. Status harian otomatis ' +
        'ikut berubah (dihitung saat dibaca). Waktu tidak boleh di masa depan / > 1 tahun lalu / di luar masa kerja.',
      security: [{ bearerAuth: [] }],
      body: {
        ...toJsonSchema(correctionSchema),
        examples: [{ employeeId: '<uuid>', occurredAt: '2026-11-16T17:05:00+07:00', note: 'Lupa clock-out, dikonfirmasi atasan' }],
      },
      response: { 201: logEnvelope, ...errorResponses(400, 401, 403, 404, 422) },
    },
    handler: async (request, reply) => {
      try {
        const input = parse(correctionSchema, request.body)
        const data = await addCorrection(input, auditContextFrom(request))
        return reply.status(201).send({ statusCode: 201, message: 'Log absensi manual ditambahkan', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.post('/logs/:id/void', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: ['Attendance'],
      summary: 'Batalkan log absensi (HR)',
      description: 'Log tetap tersimpan sebagai jejak tetapi tidak lagi dihitung. Alasan wajib; tercatat di audit log.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      body: { ...toJsonSchema(voidSchema), examples: [{ reason: 'Tercatat ganda oleh mesin' }] },
      response: { 200: logEnvelope, ...errorResponses(400, 401, 403, 404, 409) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const { reason } = parse(voidSchema, request.body)
        const data = await voidLog(id, reason, auditContextFrom(request))
        return reply.send({ statusCode: 200, message: 'Log absensi dibatalkan', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.get('/logs', {
    preHandler: [authenticate],
    schema: {
      tags: ['Attendance'],
      summary: 'Log absensi mentah',
      description: 'SUPER_ADMIN untuk siapa pun; karyawan hanya untuk dirinya sendiri (lainnya 404).',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(logsQuerySchema),
      response: {
        200: { type: 'object', properties: { statusCode: { type: 'number' }, data: { type: 'array', items: logJson } } },
        ...errorResponses(400, 401, 404),
      },
    },
    handler: async (request, reply) => {
      try {
        const q = parse(logsQuerySchema, request.query)
        const isAdmin = request.userSession?.role.code === 'SUPER_ADMIN'
        if (!isAdmin && request.userSession?.employee?.id !== q.employeeId) {
          throw new HttpError(404, 'Karyawan tidak ditemukan')
        }
        return reply.send({ statusCode: 200, data: await listLogs(q) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })
}
