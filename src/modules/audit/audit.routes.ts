import type { FastifyPluginAsync } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { authenticate, authorize } from '../../middlewares/auth.middleware.js'
import {
  errorResponses,
  paginationMetaSchema,
  parse,
  sendError,
  toJsonSchema,
  zodOnlyValidator,
} from '../../lib/route-helpers.js'
import { isValidDateOnly } from '../master/master.rules.js'

const dateOnly = z.string().refine(isValidDateOnly, 'format yyyy-MM-dd yang valid')

export const auditListQuerySchema = z
  .object({
    action: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Awalan kode aksi, mis. "employee" (semua aksi karyawan) atau "employee.deactivate"'),
    actorUserId: z.string().uuid().optional(),
    entityType: z.string().trim().max(50).optional().describe('mis. employee, user, department'),
    entityId: z.string().trim().max(100).optional(),
    from: dateOnly.optional().describe('Tanggal mulai (yyyy-MM-dd, UTC, inklusif)'),
    to: dateOnly.optional().describe('Tanggal akhir (yyyy-MM-dd, UTC, inklusif)'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from harus ≤ to', path: ['from'] })

const auditItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    action: { type: 'string', example: 'employee.deactivate' },
    entityType: { type: 'string', example: 'employee' },
    entityId: { type: 'string', nullable: true },
    actor: {
      type: 'object',
      nullable: true,
      properties: { id: { type: 'string', nullable: true }, email: { type: 'string', nullable: true } },
    },
    changes: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
      description: 'create: { after }, update: { field: { from, to } }, atau detail aksi. Tanpa password/token.',
    },
    ip: { type: 'string', nullable: true },
    userAgent: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
  },
} as const

export const auditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.setValidatorCompiler(zodOnlyValidator)

  fastify.get('/', {
    preHandler: [authenticate, authorize(['SUPER_ADMIN'])],
    schema: {
      tags: ['Audit Log'],
      summary: 'Daftar audit log',
      description:
        'Jejak aksi admin (karyawan, akun, master data) dan event keamanan (aktivasi, reset/ganti password, ' +
        'login terkunci). Terbaru di atas. Khusus SUPER_ADMIN.',
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(auditListQuerySchema),
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            data: { type: 'array', items: auditItemSchema },
            meta: paginationMetaSchema,
          },
        },
        ...errorResponses(400, 401, 403),
      },
    },
    handler: async (request, reply) => {
      try {
        const q = parse(auditListQuerySchema, request.query)
        const where: Prisma.AuditLogWhereInput = {
          ...(q.action ? { action: { startsWith: q.action } } : {}),
          ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
          ...(q.entityType ? { entityType: q.entityType } : {}),
          ...(q.entityId ? { entityId: q.entityId } : {}),
          ...(q.from || q.to
            ? {
                createdAt: {
                  ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
                  ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
                },
              }
            : {}),
        }

        const [rows, total] = await Promise.all([
          prisma.auditLog.findMany({
            where,
            orderBy: { seq: 'desc' },
            skip: (q.page - 1) * q.limit,
            take: q.limit,
          }),
          prisma.auditLog.count({ where }),
        ])

        return reply.send({
          statusCode: 200,
          data: rows.map((row) => ({
            id: row.id,
            action: row.action,
            entityType: row.entityType,
            entityId: row.entityId,
            actor: row.actorUserId || row.actorEmail ? { id: row.actorUserId, email: row.actorEmail } : null,
            changes: row.changes,
            ip: row.ip,
            userAgent: row.userAgent,
            createdAt: row.createdAt.toISOString(),
          })),
          meta: { page: q.page, limit: q.limit, total },
        })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })
}
