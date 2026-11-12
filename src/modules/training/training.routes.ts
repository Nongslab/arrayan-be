import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authenticate, authorize } from '../../middlewares/auth.middleware.js'
import { HttpError } from '../../lib/http-error.js'
import { auditContextFrom } from '../../lib/audit.js'
import {
  errorResponses,
  idParamsSchema,
  paginationMetaSchema,
  parse,
  sendError,
  toJsonSchema,
  zodOnlyValidator,
} from '../../lib/route-helpers.js'
import {
  attendanceMarkSchema,
  createTrainingSchema,
  listTrainingsQuerySchema,
  participantsSchema,
  remarksSchema,
  reportQuerySchema,
  updateTrainingSchema,
} from './training.schema.js'
import { trainingService, type TrainingViewer } from './training.service.js'

const TAG = 'Trainings'
const ADMIN_ONLY = [authenticate, authorize(['SUPER_ADMIN'])]

const ref = z.object({ id: z.string(), code: z.string(), name: z.string() })
const participantSchema = z.object({
  employee: z.object({ id: z.string(), nik: z.string(), fullName: z.string(), jobTitle: ref }),
  attended: z.boolean().nullable(),
  remarks: z.string().nullable().describe('Hanya untuk HR & peserta ybs; null untuk lainnya'),
  rating: z.number().int().nullable(),
  remarkedAt: z.string().nullable(),
})
const trainingBase = {
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: ref,
  organizer: z.string().nullable(),
  location: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string(),
  status: z.enum(['SCHEDULED', 'CANCELLED']),
  participantCount: z.number().int(),
  isParticipant: z.boolean(),
}
const trainingListItemJson = toJsonSchema(z.object(trainingBase))
const trainingDetailJson = toJsonSchema(z.object({ ...trainingBase, participants: z.array(participantSchema) }))

const detailEnvelope = (description: string) => ({
  description,
  type: 'object',
  properties: { statusCode: { type: 'number' }, message: { type: 'string' }, data: trainingDetailJson },
})

const reportJson = toJsonSchema(
  z.object({
    statusCode: z.number(),
    data: z.array(
      z.object({
        training: z.object({
          id: z.string(),
          title: z.string(),
          category: ref,
          organizer: z.string().nullable(),
          startAt: z.string(),
          endAt: z.string(),
        }),
        employee: z.object({ id: z.string(), nik: z.string(), fullName: z.string(), department: ref.nullable() }),
        attended: z.boolean().nullable(),
        rating: z.number().int().nullable(),
        remarks: z.string().nullable(),
      }),
    ),
    summary: z.array(
      z.object({
        category: ref,
        trainings: z.number().int(),
        participants: z.number().int(),
        attended: z.number().int(),
        averageRating: z.number().nullable(),
      }),
    ),
    meta: z.object({ from: z.string(), to: z.string(), total: z.number().int() }),
  }),
)

const participantParams = z.object({ id: z.string().uuid(), employeeId: z.string().uuid() })

function viewerOf(request: FastifyRequest): TrainingViewer {
  return {
    isAdmin: request.userSession?.role.code === 'SUPER_ADMIN',
    employeeId: request.userSession?.employee?.id ?? null,
  }
}

function canReadCompany(request: FastifyRequest): boolean {
  const permissions = request.userSession?.role.permissions ?? []
  return permissions.includes('all') || permissions.includes('company.read_all')
}

export const trainingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.setValidatorCompiler(zodOnlyValidator)

  fastify.get('/', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Agenda training',
      description:
        'Untuk semua karyawan login (sumber widget "Jadwal Training" & kalender). Default tanpa yang dibatalkan. ' +
        '`mine=true` hanya training yang saya ikuti.',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(listTrainingsQuerySchema),
      response: {
        200: {
          type: 'object',
          properties: { statusCode: { type: 'number' }, data: { type: 'array', items: trainingListItemJson }, meta: paginationMetaSchema },
        },
        ...errorResponses(400, 401),
      },
    },
    handler: async (request, reply) => {
      try {
        const q = parse(listTrainingsQuerySchema, request.query)
        return reply.send({ statusCode: 200, ...(await trainingService.list(q, viewerOf(request))) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.get('/report', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Laporan training (HR/Management)',
      description:
        'Histori & rekap training dalam rentang tanggal mulai: baris per peserta (kehadiran, rating, remarks) dan ' +
        'ringkasan per kategori. Permission `all` / `company.read_all`.',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(reportQuerySchema),
      response: { 200: reportJson, ...errorResponses(400, 401, 403) },
    },
    handler: async (request, reply) => {
      try {
        if (!canReadCompany(request)) throw new HttpError(403, 'Anda tidak memiliki hak akses untuk tindakan ini.')
        const q = parse(reportQuerySchema, request.query)
        return reply.send({ statusCode: 200, ...(await trainingService.report(q)) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Detail training & peserta',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      response: { 200: detailEnvelope('Detail training'), ...errorResponses(400, 401, 404) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        return reply.send({ statusCode: 200, data: await trainingService.getById(id, viewerOf(request)) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.post('/', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Jadwalkan training (HR)',
      security: [{ bearerAuth: [] }],
      body: {
        ...toJsonSchema(createTrainingSchema),
        examples: [
          {
            title: 'Workshop Keamanan Data',
            categoryId: '<uuid dari GET /api/master/training-categories>',
            organizer: 'Tim IT Internal',
            location: 'Ruang Meeting Lt. 3',
            startAt: '2026-12-03T09:00:00+07:00',
            endAt: '2026-12-03T12:00:00+07:00',
            participantIds: ['<uuid karyawan>'],
          },
        ],
      },
      response: { 201: detailEnvelope('Training dibuat'), ...errorResponses(400, 401, 403, 422) },
    },
    handler: async (request, reply) => {
      try {
        const input = parse(createTrainingSchema, request.body)
        const data = await trainingService.create(input, auditContextFrom(request))
        return reply.status(201).send({ statusCode: 201, message: 'Training dijadwalkan', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.patch('/:id', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Ubah / batalkan training (HR)',
      description: '`status: CANCELLED` membatalkan training (tetap tersimpan sebagai riwayat).',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      body: toJsonSchema(updateTrainingSchema),
      response: { 200: detailEnvelope('Training diperbarui'), ...errorResponses(400, 401, 403, 404, 422) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const input = parse(updateTrainingSchema, request.body)
        const data = await trainingService.update(id, input, auditContextFrom(request))
        return reply.send({ statusCode: 200, message: 'Training diperbarui', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.put('/:id/participants', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Atur peserta (HR)',
      description: 'Mengganti seluruh daftar peserta. Peserta yang sudah mengisi remarks tidak dapat dikeluarkan (409).',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      body: toJsonSchema(participantsSchema),
      response: { 200: detailEnvelope('Peserta diperbarui'), ...errorResponses(400, 401, 403, 404, 409, 422) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const { employeeIds } = parse(participantsSchema, request.body)
        const data = await trainingService.setParticipants(id, employeeIds, auditContextFrom(request))
        return reply.send({ statusCode: 200, message: 'Peserta diperbarui', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.patch('/:id/participants/:employeeId', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Tandai kehadiran peserta (HR)',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(participantParams),
      body: toJsonSchema(attendanceMarkSchema),
      response: { 200: detailEnvelope('Kehadiran dicatat'), ...errorResponses(400, 401, 403, 404) },
    },
    handler: async (request, reply) => {
      try {
        const { id, employeeId } = parse(participantParams, request.params)
        const { attended } = parse(attendanceMarkSchema, request.body)
        const data = await trainingService.markAttendance(id, employeeId, attended, auditContextFrom(request))
        return reply.send({ statusCode: 200, message: 'Kehadiran peserta dicatat', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.put('/:id/remarks', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Isi remarks / feedback (peserta)',
      description: 'Hanya peserta, setelah training selesai. Boleh diperbarui. Rating opsional 1–5.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      body: { ...toJsonSchema(remarksSchema), examples: [{ remarks: 'Materi relevan, praktik langsung sangat membantu.', rating: 5 }] },
      response: { 200: detailEnvelope('Remarks tersimpan'), ...errorResponses(400, 401, 403, 404, 409) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const input = parse(remarksSchema, request.body)
        const employeeId = request.userSession?.employee?.id
        if (!employeeId) throw new HttpError(403, 'Akun ini tidak terhubung dengan data karyawan')
        const data = await trainingService.submitRemarks(id, employeeId, input)
        return reply.send({ statusCode: 200, message: 'Remarks tersimpan', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })
}
