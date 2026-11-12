import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { errorResponses, parse, sendError, toJsonSchema, zodOnlyValidator } from '../../lib/route-helpers.js'
import { isValidDateOnly } from '../master/master.rules.js'
import { todayInJakarta } from '../employee/employee.schema.js'
import { dashboardFor } from './dashboard.service.js'

const querySchema = z.object({
  date: z
    .string()
    .refine(isValidDateOnly, 'format yyyy-MM-dd yang valid')
    .optional()
    .describe('Default hari ini (Asia/Jakarta)'),
  upcomingTrainingDays: z.coerce.number().int().min(0).max(30).default(7).describe('Jadwal training hari ini + N hari'),
})

const ref = z.object({ id: z.string(), code: z.string(), name: z.string() })
const person = z.object({ id: z.string(), fullName: z.string(), jobTitle: ref, department: ref.nullable() })

const responseSchema = z.object({
  statusCode: z.number(),
  data: z.object({
    date: z.string(),
    late: z.array(z.object({ employee: person, lateMinutes: z.number().int(), clockIn: z.string().nullable() })),
    onLeave: z.array(
      z.object({ employee: person, leaveType: z.object({ code: z.string(), name: z.string() }), startDate: z.string(), endDate: z.string() }),
    ),
    sick: z.array(z.object({ employee: person, status: z.enum(['PENDING', 'APPROVED']) })),
    birthdays: z.array(z.object({ employee: person })),
    trainings: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        category: ref,
        location: z.string().nullable(),
        startAt: z.string(),
        endAt: z.string(),
        participantCount: z.number().int(),
        isParticipant: z.boolean(),
      }),
    ),
    counts: z.object({
      late: z.number().int(),
      onLeave: z.number().int(),
      sick: z.number().int(),
      birthdays: z.number().int(),
      trainings: z.number().int(),
    }),
  }),
})

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.setValidatorCompiler(zodOnlyValidator)

  fastify.get('/today', {
    preHandler: [authenticate],
    schema: {
      tags: ['Dashboard'],
      summary: 'Dashboard 5-in-1',
      description:
        'Untuk semua karyawan (PRD Module 3): (1) yang telat hari ini, (2) cuti hari ini (DISETUJUI), (3) sakit hari ini ' +
        '(PENDING atau APPROVED — PRD: yang mengajukan izin sakit), (4) ulang tahun, (5) jadwal training hari ini + N hari. ' +
        'Hanya nama, jabatan, departemen — tanpa alasan cuti/sakit. Karyawan nonaktif tidak disertakan.',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(querySchema),
      response: { 200: toJsonSchema(responseSchema), ...errorResponses(400, 401) },
    },
    handler: async (request, reply) => {
      try {
        const q = parse(querySchema, request.query)
        const data = await dashboardFor(
          q.date ?? todayInJakarta(),
          q.upcomingTrainingDays,
          request.userSession?.employee?.id ?? null,
        )
        return reply.send({ statusCode: 200, data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })
}
