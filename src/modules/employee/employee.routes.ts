import type { FastifyPluginAsync } from 'fastify'
import { authenticate, authorize } from '../../middlewares/auth.middleware.js'
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
  accountInputSchema,
  birthdayItemSchema,
  birthdaysQuerySchema,
  createEmployeeSchema,
  employeeDetailSchema,
  employeeListQuerySchema,
  employeeSchema,
  employeeStatusInputSchema,
  employeeTreeQuerySchema,
  invitationSchema,
  treeNodeBaseSchema,
  updateEmployeeSchema,
} from './employee.schema.js'
import { employeeService, type EmployeeViewer } from './employee.service.js'
import type { FastifyRequest } from 'fastify'
import { employeeAdminService } from './employee.admin.service.js'
import { auditContextFrom } from '../../lib/audit.js'

const TAG = 'Employees'

function viewerOf(request: FastifyRequest): EmployeeViewer {
  return {
    isAdmin: request.userSession?.role.code === 'SUPER_ADMIN',
    employeeId: request.userSession?.employee?.id ?? null,
  }
}
const ADMIN_ONLY = [authenticate, authorize(['SUPER_ADMIN'])]

const detailJson = toJsonSchema(employeeDetailSchema)
const invitationJson = toJsonSchema(invitationSchema)

/** Response tulis: data karyawan + (opsional) info undangan aktivasi. */
function writeResponse(status: number, description: string) {
  return {
    description,
    type: 'object',
    properties: {
      statusCode: { type: 'number', example: status },
      message: { type: 'string' },
      data: detailJson,
      invitation: invitationJson,
    },
  }
}

const createExample = {
  nik: 'EMP-2026-014',
  fullName: 'Budi Santoso',
  employmentType: 'PROBATION',
  joinDate: '2026-11-17',
  jobTitleId: '<uuid jabatan dari GET /api/master/job-titles>',
  departmentId: '<uuid departemen>',
  managerId: '<uuid atasan>',
  account: { email: 'budi.santoso@arrayan.com' },
}

const treeNodeSchema = (() => {
  const base = toJsonSchema(treeNodeBaseSchema) as { properties: Record<string, unknown> }
  return {
    ...base,
    properties: {
      ...base.properties,
      children: {
        type: 'array',
        description: 'Bawahan langsung — struktur node sama (rekursif)',
        items: { type: 'object', additionalProperties: true },
      },
    },
  }
})()

export const employeeRoutes: FastifyPluginAsync = async (fastify) => {
  // Validasi dengan Zod di handler; JSON schema route hanya untuk Swagger.
  fastify.setValidatorCompiler(zodOnlyValidator)

  // US-2.5: list + filter + paginasi
  fastify.get('/', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Daftar karyawan',
      description: 'Paginasi, pencarian nama/NIK, dan filter departemen, jabatan, atasan, jenis kepegawaian, status akun.',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(employeeListQuerySchema),
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            data: { type: 'array', items: toJsonSchema(employeeSchema) },
            meta: paginationMetaSchema,
          },
        },
        ...errorResponses(400, 401),
      },
    },
    handler: async (request, reply) => {
      try {
        const query = parse(employeeListQuerySchema, request.query)
        const result = await employeeService.list(query, viewerOf(request))
        return reply.send({ statusCode: 200, ...result })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // US-2.4: tree branch — didaftarkan sebelum /:id
  fastify.get('/tree', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Pohon organisasi (Tree Branch)',
      description:
        'Hierarki bersarang dari relasi atasan langsung (`managerId`). Mendukung multi-root. ' +
        'Children diurutkan berdasarkan level jabatan lalu nama. ' +
        '`meta.cycleBreaks` berisi id karyawan yang relasi atasannya membentuk siklus (diputus agar pohon tetap valid).',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(employeeTreeQuerySchema),
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            data: { type: 'array', items: treeNodeSchema },
            meta: {
              type: 'object',
              properties: {
                totalEmployees: { type: 'number' },
                rootCount: { type: 'number' },
                cycleBreaks: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        ...errorResponses(400, 401, 404),
      },
    },
    handler: async (request, reply) => {
      try {
        const { rootId } = parse(employeeTreeQuerySchema, request.query)
        const result = await employeeService.tree(rootId)
        return reply.send({ statusCode: 200, ...result })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // US-2.7: ulang tahun dalam rentang — didaftarkan sebelum /:id
  fastify.get('/birthdays', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Ulang tahun karyawan',
      description:
        'Ulang tahun karyawan aktif dalam rentang tanggal (default hari ini s.d. +30 hari, maks. 366 hari). ' +
        'Hanya nama, jabatan, departemen, dan MM-dd — tahun lahir tidak ditampilkan. ' +
        '29 Februari dirayakan 28 Februari pada tahun non-kabisat.',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(birthdaysQuerySchema),
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            data: { type: 'array', items: toJsonSchema(birthdayItemSchema) },
            meta: {
              type: 'object',
              properties: { from: { type: 'string' }, to: { type: 'string' }, total: { type: 'number' } },
            },
          },
        },
        ...errorResponses(400, 401),
      },
    },
    handler: async (request, reply) => {
      try {
        const query = parse(birthdaysQuerySchema, request.query)
        return reply.send({ statusCode: 200, ...(await employeeService.birthdays(query)) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // US-2.5: detail
  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: {
      tags: [TAG],
      summary: 'Detail karyawan',
      description: 'Termasuk atasan langsung, daftar bawahan langsung, dan master data penugasan.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      response: {
        200: {
          type: 'object',
          properties: { statusCode: { type: 'number' }, data: toJsonSchema(employeeDetailSchema) },
        },
        ...errorResponses(400, 401, 404),
      },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        return reply.send({ statusCode: 200, data: await employeeService.getById(id, viewerOf(request)) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // ---------------------------------------------------------------------------
  // US-2.2: Admin provisioning (SUPER_ADMIN / tim HR GA)
  // ---------------------------------------------------------------------------

  fastify.post('/', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Tambah karyawan (opsional sekaligus akun)',
      description:
        'Membuat data karyawan. Bila `account` diisi, akun login dibuat berstatus PENDING_ACTIVATION dan undangan ' +
        'aktivasi dikirim. Role default mengikuti level jabatan. Master data & atasan harus aktif.',
      security: [{ bearerAuth: [] }],
      body: { ...toJsonSchema(createEmployeeSchema), examples: [createExample] },
      response: { 201: writeResponse(201, 'Karyawan dibuat'), ...errorResponses(400, 401, 403, 409, 422) },
    },
    handler: async (request, reply) => {
      try {
        const input = parse(createEmployeeSchema, request.body)
        const { employee, invitation } = await employeeAdminService.create(input, auditContextFrom(request))
        return reply.status(201).send({
          statusCode: 201,
          message: invitation ? 'Karyawan dibuat dan undangan aktivasi dikirim' : 'Karyawan dibuat',
          data: employee,
          ...(invitation ? { invitation } : {}),
        })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.patch('/:id', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Ubah data karyawan',
      description: 'Hanya field yang dikirim yang diperbarui. `managerId` ditolak bila membentuk siklus atasan.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      body: toJsonSchema(updateEmployeeSchema),
      response: { 200: writeResponse(200, 'Karyawan diperbarui'), ...errorResponses(400, 401, 403, 404, 409, 422) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const input = parse(updateEmployeeSchema, request.body)
        const data = await employeeAdminService.update(id, input, auditContextFrom(request))
        return reply.send({ statusCode: 200, message: 'Data karyawan diperbarui', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.post('/:id/account', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Buatkan akun login & kirim undangan',
      description: 'Untuk karyawan aktif yang belum punya akun. Akun berstatus PENDING_ACTIVATION sampai diaktivasi.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      body: { ...toJsonSchema(accountInputSchema), examples: [{ email: 'budi.santoso@arrayan.com' }] },
      response: { 201: writeResponse(201, 'Akun dibuat'), ...errorResponses(400, 401, 403, 404, 409, 422) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const input = parse(accountInputSchema, request.body)
        const { employee, invitation } = await employeeAdminService.createAccount(id, input, auditContextFrom(request))
        return reply
          .status(201)
          .send({ statusCode: 201, message: 'Akun dibuat dan undangan aktivasi dikirim', data: employee, invitation })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.post('/:id/account/invitation', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Kirim ulang undangan aktivasi',
      description: 'Hanya untuk akun PENDING_ACTIVATION. Link sebelumnya otomatis tidak berlaku.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      response: {
        200: {
          type: 'object',
          properties: { statusCode: { type: 'number' }, message: { type: 'string' }, invitation: invitationJson },
        },
        ...errorResponses(400, 401, 403, 404, 409, 422),
      },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const { invitation } = await employeeAdminService.resendInvitation(id, auditContextFrom(request))
        return reply.send({ statusCode: 200, message: 'Undangan aktivasi dikirim ulang', invitation })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.patch('/:id/status', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: [TAG],
      summary: 'Nonaktifkan / aktifkan kembali karyawan',
      description:
        'INACTIVE (karyawan keluar): data tetap tersimpan, akun dinonaktifkan dan seluruh sesi dicabut. ' +
        'ACTIVE (kembali bekerja): data penugasan lama dipertahankan; akun (bila ada) wajib aktivasi ulang lewat undangan baru.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      body: { ...toJsonSchema(employeeStatusInputSchema), examples: [{ status: 'INACTIVE', exitDate: '2026-12-31' }] },
      response: { 200: writeResponse(200, 'Status diperbarui'), ...errorResponses(400, 401, 403, 404, 409, 422) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const input = parse(employeeStatusInputSchema, request.body)
        const { employee, invitation } = await employeeAdminService.setStatus(
          id,
          input,
          request.userSession?.employee?.id,
          auditContextFrom(request),
        )
        return reply.send({
          statusCode: 200,
          message: input.status === 'INACTIVE' ? 'Karyawan dinonaktifkan' : 'Karyawan diaktifkan kembali',
          data: employee,
          ...(invitation ? { invitation } : {}),
        })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })
}
