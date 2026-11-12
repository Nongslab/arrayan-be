import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { HttpError } from '../../lib/http-error.js'
import { errorResponses, parse, sendError, toJsonSchema, zodOnlyValidator } from '../../lib/route-helpers.js'
import { isValidDateOnly } from '../master/master.rules.js'
import { todayInJakarta } from '../employee/employee.schema.js'
import { ATTENDANCE_STATUSES, attendanceDays, summarize } from './attendance.service.js'

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
}
