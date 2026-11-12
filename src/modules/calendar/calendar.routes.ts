import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { authenticate, authorize } from '../../middlewares/auth.middleware.js'
import { HttpError } from '../../lib/http-error.js'
import { auditContextFrom } from '../../lib/audit.js'
import { errorResponses, idParamsSchema, parse, sendError, toJsonSchema, zodOnlyValidator } from '../../lib/route-helpers.js'
import { isValidDateOnly, TIME_PATTERN } from '../master/master.rules.js'
import { calendarFeed, createEvent, updateEvent } from './calendar.service.js'

const MAX_RANGE_DAYS = 92
const dateOnly = z.string().refine(isValidDateOnly, 'format yyyy-MM-dd yang valid')
const time = z.string().regex(TIME_PATTERN, 'format HH:mm')

const feedQuerySchema = z
  .object({
    from: dateOnly,
    to: dateOnly,
    view: z.enum(['personal', 'master']).default('personal').describe('master: seluruh jadwal karyawan (SUPER_ADMIN)'),
  })
  .refine((q) => q.from <= q.to, { message: 'from harus ≤ to', path: ['from'] })
  .refine(
    (q) => new Date(`${q.to}T00:00:00Z`).getTime() - new Date(`${q.from}T00:00:00Z`).getTime() <= (MAX_RANGE_DAYS - 1) * 86_400_000,
    { message: `rentang maksimal ${MAX_RANGE_DAYS} hari`, path: ['to'] },
  )

const eventFields = {
  title: z.string().trim().min(3, 'minimal 3 karakter').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  startDate: dateOnly,
  endDate: dateOnly,
  startTime: time.nullable().optional().describe('Kosong = sepanjang hari'),
  endTime: time.nullable().optional(),
}
const createEventSchema = z.object(eventFields).strict()
const updateEventSchema = z
  .object({ ...eventFields, isActive: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Body tidak boleh kosong')

const itemSchema = z.object({
  type: z.enum(['HOLIDAY', 'BIRTHDAY', 'EVENT', 'TRAINING', 'LEAVE']),
  id: z.string(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  allDay: z.boolean(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  location: z.string().nullable(),
  employee: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  detail: z.record(z.string()).nullable(),
})
const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  allDay: z.boolean(),
  isActive: z.boolean(),
})
const eventEnvelope = {
  type: 'object',
  properties: { statusCode: { type: 'number' }, message: { type: 'string' }, data: toJsonSchema(eventSchema) },
}
const ADMIN_ONLY = [authenticate, authorize(['SUPER_ADMIN'])]

export const calendarRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.setValidatorCompiler(zodOnlyValidator)

  fastify.get('/', {
    preHandler: [authenticate],
    schema: {
      tags: ['Calendar'],
      summary: 'Kalender',
      description:
        'Personal: hari libur, ulang tahun karyawan, event kantor, training yang saya ikuti, cuti/izin saya (PENDING & APPROVED). ' +
        `Master (SUPER_ADMIN): seluruh training & seluruh cuti karyawan aktif. Rentang maks. ${MAX_RANGE_DAYS} hari.`,
      security: [{ bearerAuth: [] }],
      querystring: toJsonSchema(feedQuerySchema),
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            data: { type: 'array', items: toJsonSchema(itemSchema) },
            meta: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, view: { type: 'string' } } },
          },
        },
        ...errorResponses(400, 401, 403),
      },
    },
    handler: async (request, reply) => {
      try {
        const q = parse(feedQuerySchema, request.query)
        const master = q.view === 'master'
        if (master && request.userSession?.role.code !== 'SUPER_ADMIN') {
          throw new HttpError(403, 'Tampilan master hanya untuk HR (SUPER_ADMIN)')
        }
        const data = await calendarFeed({
          from: q.from,
          to: q.to,
          master,
          employeeId: request.userSession?.employee?.id ?? null,
        })
        return reply.send({ statusCode: 200, data, meta: { from: q.from, to: q.to, view: q.view } })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.post('/events', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: ['Calendar'],
      summary: 'Tambah event kantor (HR)',
      security: [{ bearerAuth: [] }],
      body: {
        ...toJsonSchema(createEventSchema),
        examples: [{ title: 'Family Gathering', location: 'Puncak', startDate: '2026-12-12', endDate: '2026-12-13' }],
      },
      response: { 201: eventEnvelope, ...errorResponses(400, 401, 403) },
    },
    handler: async (request, reply) => {
      try {
        const input = parse(createEventSchema, request.body)
        const data = await createEvent(input, auditContextFrom(request))
        return reply.status(201).send({ statusCode: 201, message: 'Event dibuat', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })

  fastify.patch('/events/:id', {
    preHandler: ADMIN_ONLY,
    schema: {
      tags: ['Calendar'],
      summary: 'Ubah / nonaktifkan event kantor (HR)',
      description: '`isActive: false` menyembunyikan event dari kalender (tetap tersimpan).',
      security: [{ bearerAuth: [] }],
      params: toJsonSchema(idParamsSchema),
      body: toJsonSchema(updateEventSchema),
      response: { 200: eventEnvelope, ...errorResponses(400, 401, 403, 404) },
    },
    handler: async (request, reply) => {
      try {
        const { id } = parse(idParamsSchema, request.params)
        const input = parse(updateEventSchema, request.body)
        const data = await updateEvent(id, input, auditContextFrom(request))
        return reply.send({ statusCode: 200, message: 'Event diperbarui', data })
      } catch (err) {
        return sendError(reply, err)
      }
    },
  })
}
