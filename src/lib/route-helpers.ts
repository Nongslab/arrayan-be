import type { FastifyReply, FastifySchemaCompiler } from 'fastify'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { HttpError, mapPrismaError, zodToHttpError } from './http-error.js'

type AnyObject = Record<string, unknown>

/** JSON Schema (OpenAPI 3) dari Zod — untuk dokumentasi Swagger & serializer response. */
export function toJsonSchema(schema: z.ZodTypeAny): AnyObject {
  const { $schema: _ignored, ...json } = zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as AnyObject
  return json
}

/** Validasi dengan Zod; gagal → HttpError 400 berisi `details`. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data ?? {})
  if (!result.success) throw zodToHttpError(result.error)
  return result.data
}

/** Kirim HttpError / error Prisma yang dikenal; error lain dilempar ulang (→ 500). */
export function sendError(reply: FastifyReply, err: unknown) {
  const httpError = err instanceof HttpError ? err : mapPrismaError(err)
  if (!httpError) throw err
  return reply.status(httpError.statusCode).send(httpError.toBody())
}

/**
 * Validator compiler no-op: dipasang di plugin yang memvalidasi dengan Zod di handler,
 * sehingga JSON schema pada route hanya dipakai untuk dokumentasi Swagger.
 */
export const zodOnlyValidator: FastifySchemaCompiler<unknown> = () => (data) => ({ value: data })

export const errorResponseSchema = toJsonSchema(
  z.object({
    statusCode: z.number(),
    error: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
)

/** Map status → schema error untuk blok `response` Fastify. */
export function errorResponses(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, { ...errorResponseSchema, description: `Error ${code}` }]))
}

export const idParamsSchema = z.object({ id: z.string().uuid('id harus UUID') })

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}

export const paginationMetaSchema = {
  type: 'object',
  properties: { page: { type: 'number' }, limit: { type: 'number' }, total: { type: 'number' } },
} as const
