import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
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
  adjustmentSchema,
  balanceItemSchema,
  balanceQuerySchema,
  cancelLeaveSchema,
  createLeaveSchema,
  leaveRequestSchema,
  leavesQuerySchema,
  myLeavesQuerySchema,
} from './leave.schema.js'
import { leaveService, type LeaveViewer } from './leave.service.js'

const TAG = 'Leaves'
const ADMIN_ONLY = [authenticate, authorize(['SUPER_ADMIN'])]

const leaveJson = toJsonSchema(leaveRequestSchema)
const balanceListJson = {
  type: 'object',
  properties: { statusCode: { type: 'number' }, data: { type: 'array', items: toJsonSchema(balanceItemSchema) } },
}
const leaveEnvelope = (description: string) => ({
  description,
  type: 'object',
  properties: { statusCode: { type: 'number' }, message: { type: 'string' }, data: leaveJson },
})
const leaveListJson = {
  type: 'object',
  properties: { statusCode: { type: 'number' }, data: { type: 'array', items: leaveJson }, meta: paginationMetaSchema },
}

function viewerOf(request: FastifyRequest): LeaveViewer {
  return {
    isAdmin: request.userSession?.role.code === 'SUPER_ADMIN',
    employeeId: request.userSession?.employee?.id ?? null,
  }
}

/** Karyawan yang sedang login (akun tanpa data karyawan tidak bisa mengajukan cuti). */
function ownEmployeeId(request: FastifyRequest): string {
  const id = request.userSession?.employee?.id
  if (!id) throw new HttpError(403, 'Akun ini tidak terhubung dengan data karyawan')
  return id
}

export const leaveRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.setValidatorCompiler(zodOnlyValidator)

  // ---------------------------------------------------------------------------
  // Saldo (US-5.1)
  // ---------------------------------------------------------------------------
  fastify.get('/balance', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Saldo cuti saya',
      description:
        'Saldo per jenis cuti berkuota untuk satu tahun: jatah + penyesuaian − cuti bersama − terpakai (APPROVED) ' +
        '− menunggu (PENDING). Aturan jatah sementara: penuh per tahun kalender, tanpa prorata/carry-over (menunggu Q-5).',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(balanceQuerySchema),
      response: { 200: balanceListJson, ...errorResponses(400, 401, 403) },
    },
    handler: async (request, reply) => {
      try {
        const { year } = parse(balanceQuerySchema, request.query)
        return reply.send({ statusCode: 200, data: await leaveService.balances(ownEmployeeId(request), year) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.get('/balance/:id', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Saldo cuti karyawan (HR)',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      querystring: toJsonSchema(balanceQuerySchema),
      response: { 200: balanceListJson, ...errorResponses(400, 401, 403, 404) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const { year } = parse(balanceQuerySchema, request.query)
        return reply.send({ statusCode: 200, data: await leaveService.balances(id, year) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.post('/balance/adjustments', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Penyesuaian saldo cuti (HR)',
      description: 'Tambah (+) atau kurangi (−) saldo jenis cuti berkuota pada satu tahun, dengan alasan. Tercatat di audit log.',
      security: [{ bearerAuth: [] }],
      body: {
        ...toJsonSchema(adjustmentSchema),
        examples: [{ employeeId: '<uuid>', leaveTypeId: '<uuid ANNUAL>', year: 2026, days: 2, reason: 'Kompensasi lembur akhir tahun' }],
      },
      response: {
        201: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: { adjustmentId: { type: 'string' }, balance: toJsonSchema(balanceItemSchema) },
            },
          },
        },
        ...errorResponses(400, 401, 403, 404, 422),
      },
    },
    handler: async (request, reply) => {
      try {
        const input = parse(adjustmentSchema, request.body)
        const data = await leaveService.adjust(input, auditContextFrom(request))
        return reply.status(201).send({ statusCode: 201, message: 'Saldo cuti disesuaikan', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // ---------------------------------------------------------------------------
  // Pengajuan (US-5.2)
  // ---------------------------------------------------------------------------
  fastify.post('/', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Ajukan cuti / izin / sakit',
      description:
        'Untuk diri sendiri. Hari dihitung dari hari kerja shift (hari kalender untuk cuti melahirkan), tanpa hari libur. ' +
        'Ditolak bila tumpang tindih (409), saldo kurang / tanpa hari kerja / sebelum tanggal masuk (422). ' +
        'Status awal PENDING — approval berjenjang menyusul (US-5.3).',
      security: [{ bearerAuth: [] }],
      body: {
        ...toJsonSchema(createLeaveSchema),
        examples: [{ leaveTypeId: '<uuid dari GET /api/master/leave-types>', startDate: '2026-12-21', endDate: '2026-12-23', reason: 'Acara keluarga' }],
      },
      response: { 201: leaveEnvelope('Pengajuan dibuat'), ...errorResponses(400, 401, 403, 409, 422) },
    },
    handler: async (request, reply) => {
      try {
        const input = parse(createLeaveSchema, request.body)
        const data = await leaveService.create(ownEmployeeId(request), input, auditContextFrom(request))
        return reply.status(201).send({ statusCode: 201, message: 'Pengajuan berhasil dibuat', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.get('/me', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Pengajuan saya',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(myLeavesQuerySchema),
      response: { 200: leaveListJson, ...errorResponses(400, 401, 403) },
    },
    handler: async (request, reply) => {
      try {
        const q = parse(myLeavesQuerySchema, request.query)
        return reply.send({ statusCode: 200, ...(await leaveService.listForYear(ownEmployeeId(request), q)) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.get('/', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Semua pengajuan (HR)',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(leavesQuerySchema),
      response: { 200: leaveListJson, ...errorResponses(400, 401, 403) },
    },
    handler: async (request, reply) => {
      try {
        const q = parse(leavesQuerySchema, request.query)
        return reply.send({ statusCode: 200, ...(await leaveService.list(q)) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Detail pengajuan',
      description: 'Pemilik atau SUPER_ADMIN. Pengajuan orang lain → 404.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      response: {
        200: { type: 'object', properties: { statusCode: { type: 'number' }, data: leaveJson } },
        ...errorResponses(400, 401, 404),
      },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        return reply.send({ statusCode: 200, data: await leaveService.getById(id, viewerOf(request)) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // ---------------------------------------------------------------------------
  // Pembatalan (US-5.4)
  // ---------------------------------------------------------------------------
  fastify.post('/:id/cancel', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Batalkan pengajuan',
      description:
        'Pemilik: selama PENDING. SUPER_ADMIN: PENDING atau APPROVED (alasan wajib untuk APPROVED). Saldo kembali otomatis.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      body: { ...toJsonSchema(cancelLeaveSchema), examples: [{ reason: 'Rencana berubah' }] },
      response: { 200: leaveEnvelope('Pengajuan dibatalkan'), ...errorResponses(400, 401, 403, 404, 409) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const { reason } = parse(cancelLeaveSchema, request.body ?? {})
        const data = await leaveService.cancel(id, reason, viewerOf(request), auditContextFrom(request))
        return reply.send({ statusCode: 200, message: 'Pengajuan dibatalkan', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })
}

