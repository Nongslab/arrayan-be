import type { FastifyPluginAsync } from 'fastify'
import { authenticate } from '../../middlewares/auth.middleware.js'
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
  employeeDetailSchema,
  employeeListQuerySchema,
  employeeSchema,
  employeeTreeQuerySchema,
  treeNodeBaseSchema,
} from './employee.schema.js'
import { employeeService } from './employee.service.js'

const TAG = 'Employees'

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
        const result = await employeeService.list(query)
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
        return reply.send({ statusCode: 200, data: await employeeService.getById(id) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })
}
