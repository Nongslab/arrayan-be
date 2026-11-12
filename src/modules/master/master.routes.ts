import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { authenticate, authorize } from '../../middlewares/auth.middleware.js'
import { HttpError } from '../../lib/http-error.js'
import {
  errorResponses,
  idParamsSchema as idParams,
  paginationMetaSchema,
  paginationQuery,
  parse,
  sendError,
  toJsonSchema,
  zodOnlyValidator,
} from '../../lib/route-helpers.js'
import { MASTER_ENTITIES, type MasterEntityConfig } from './master.entities.js'

const ADMIN_ROLES = ['SUPER_ADMIN']

type AnyObject = Record<string, unknown>

const activeBody = z.object({ isActive: z.boolean() }).strict()

const baseListQuery = {
  q: z.string().trim().max(100).optional().describe('Cari di code/name (case-insensitive)'),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true')
    .describe('Sertakan data nonaktif (hanya SUPER_ADMIN)'),
  ...paginationQuery,
}

function registerEntityRoutes(fastify: FastifyInstance, entity: MasterEntityConfig) {
  const tag = `Master: ${entity.label}`
  const base = `/${entity.path}`

  const createSchema = z.object(entity.fields).strict()
  const { code: _code, ...updatableFields } = entity.fields
  const updateSchema = z
    .object(updatableFields)
    .partial()
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'Body tidak boleh kosong')
  const listQuery = z.object({ ...baseListQuery, ...(entity.extraQuery ?? {}) })

  const item = toJsonSchema(entity.response)
  const itemEnvelope = (status: number, message?: string) => ({
    description: message ?? 'OK',
    type: 'object',
    properties: { statusCode: { type: 'number', example: status }, message: { type: 'string' }, data: item },
  })
  const errors = errorResponses

  const delegate = () => entity.delegate()
  const serialize = (row: unknown) => entity.serialize(row as never)
  const toData = (input: AnyObject, mode: 'create' | 'update') => (entity.toData ? entity.toData(input, mode) : input)

  async function findOrThrow(id: string) {
    const row = await delegate().findUnique({ where: { id }, include: entity.include })
    if (!row) throw new HttpError(404, `${entity.label} tidak ditemukan`)
    return row
  }

  // LIST ---------------------------------------------------------------------
  fastify.get(base, {
    preHandler: [authenticate],
    schema: {
      tags: [tag],
      summary: `Daftar ${entity.label}`,
      description: 'Default hanya data aktif (untuk dropdown). SUPER_ADMIN dapat menambah `includeInactive=true`.',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(listQuery),
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            data: { type: 'array', items: item },
            meta: paginationMetaSchema,
          },
        },
        ...errors(400, 401),
      },
    },
    handler: async (request, reply) => {
      try {
        const query = parse(listQuery, request.query) as AnyObject & {
          q?: string
          includeInactive: boolean
          page: number
          limit: number
        }
        const isAdmin = ADMIN_ROLES.includes(request.userSession?.role.code ?? '')
        const where: AnyObject = { ...(entity.extraWhere?.(query) ?? {}) }
        if (!(query.includeInactive && isAdmin)) where.isActive = true
        if (query.q) {
          where.OR = [
            { code: { contains: query.q, mode: 'insensitive' } },
            { name: { contains: query.q, mode: 'insensitive' } },
          ]
        }

        const [rows, total] = await Promise.all([
          delegate().findMany({
            where,
            include: entity.include,
            orderBy: entity.orderBy,
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
          delegate().count({ where }),
        ])

        return reply.send({
          statusCode: 200,
          data: rows.map(serialize),
          meta: { page: query.page, limit: query.limit, total },
        })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // DETAIL -------------------------------------------------------------------
  fastify.get(`${base}/:id`, {
    preHandler: [authenticate],
    schema: {
      tags: [tag],
      summary: `Detail ${entity.label}`,
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParams),
      response: { 200: itemEnvelope(200), ...errors(400, 401, 404) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParams, request.params)
        return reply.send({ statusCode: 200, data: serialize(await findOrThrow(id)) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // CREATE -------------------------------------------------------------------
  fastify.post(base, {
    preHandler: [authenticate, authorize(ADMIN_ROLES)],
    schema: {
      tags: [tag],
      summary: `Tambah ${entity.label}`,
      security: [{ bearerAuth: [] }],
      body: { ...toJsonSchema(createSchema), examples: [entity.example] },
      response: {
        201: itemEnvelope(201, `${entity.label} dibuat`),
        ...errors(400, 401, 403, 409, 422),
      },
    },
    handler: async (request, reply) => {
      try {
        const input = parse(createSchema, request.body) as AnyObject
        const ruleError = entity.check?.(input, input)
        if (ruleError) throw new HttpError(400, ruleError)
        await entity.beforeWrite?.({ input })

        const row = await delegate().create({ data: toData(input, 'create'), include: entity.include })
        return reply.status(201).send({ statusCode: 201, message: `${entity.label} berhasil dibuat`, data: serialize(row) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // UPDATE -------------------------------------------------------------------
  fastify.patch(`${base}/:id`, {
    preHandler: [authenticate, authorize(ADMIN_ROLES)],
    schema: {
      tags: [tag],
      summary: `Ubah ${entity.label}`,
      description: '`code` tidak dapat diubah. Hanya field yang dikirim yang diperbarui.',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParams),
      body: toJsonSchema(updateSchema),
      response: { 200: itemEnvelope(200), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParams, request.params)
        const body = request.body as AnyObject | undefined
        if (body && typeof body === 'object' && 'code' in body) {
          throw new HttpError(400, 'code tidak dapat diubah setelah dibuat')
        }
        const patch = parse(updateSchema, body) as AnyObject
        const existing = await findOrThrow(id)

        const ruleError = entity.check?.({ ...serialize(existing), ...patch }, patch)
        if (ruleError) throw new HttpError(400, ruleError)
        await entity.beforeWrite?.({ id, input: patch })

        const row = await delegate().update({ where: { id }, data: toData(patch, 'update'), include: entity.include })
        return reply.send({ statusCode: 200, message: `${entity.label} berhasil diperbarui`, data: serialize(row) })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  // ACTIVATE / DEACTIVATE ------------------------------------------------------
  fastify.patch(`${base}/:id/active`, {
    preHandler: [authenticate, authorize(ADMIN_ROLES)],
    schema: {
      tags: [tag],
      summary: `Aktifkan / nonaktifkan ${entity.label}`,
      description:
        'Soft deactivation — data lama yang mereferensikan tetap utuh. Master data tidak dapat dihapus (AGENTS.md §1).',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParams),
      body: { ...toJsonSchema(activeBody), examples: [{ isActive: false }] },
      response: { 200: itemEnvelope(200), ...errors(400, 401, 403, 404) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParams, request.params)
        const { isActive } = parse(activeBody, request.body)
        await findOrThrow(id)

        const row = await delegate().update({ where: { id }, data: { isActive }, include: entity.include })
        return reply.send({
          statusCode: 200,
          message: `${entity.label} ${isActive ? 'diaktifkan' : 'dinonaktifkan'}`,
          data: serialize(row),
        })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })
}

/** Tag Swagger per entitas master (didaftarkan di konfigurasi OpenAPI). */
export const MASTER_SWAGGER_TAGS = MASTER_ENTITIES.map((entity) => ({
  name: `Master: ${entity.label}`,
  description: `Master data ${entity.label.toLowerCase()} — /api/master/${entity.path}`,
}))

export const masterRoutes: FastifyPluginAsync = async (fastify) => {
  // Validasi body/query/params dilakukan Zod di handler (pesan konsisten & aturan lintas-field).
  // JSON schema pada route hanya untuk dokumentasi Swagger. Berlaku di dalam plugin ini saja.
  fastify.setValidatorCompiler(zodOnlyValidator)

  for (const entity of MASTER_ENTITIES) {
    registerEntityRoutes(fastify, entity)
  }
}
