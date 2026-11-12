import { Prisma } from '@prisma/client'
import type { ZodError } from 'zod'

export interface ErrorDetail {
  path: string
  message: string
}

/** Error terkontrol yang dipetakan langsung ke response HTTP `{ statusCode, error, message, details? }`. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message)
  }

  toBody() {
    return {
      statusCode: this.statusCode,
      error: HTTP_ERROR_NAMES[this.statusCode] ?? 'Error',
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

const HTTP_ERROR_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
}

export function zodToHttpError(error: ZodError): HttpError {
  const details = error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }))
  const first = details[0]
  const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Input tidak valid'
  return new HttpError(400, message, details)
}

/**
 * Memetakan error Prisma yang umum ke HttpError:
 * - P2002 unique constraint → 409
 * - P2003 foreign key tidak valid / masih direferensikan → 422
 * - P2025 record tidak ditemukan → 404
 * Mengembalikan `null` untuk error lain (dibiarkan menjadi 500).
 */
export function mapPrismaError(err: unknown): HttpError | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null

  switch (err.code) {
    case 'P2002': {
      const target = err.meta?.target
      const fields = Array.isArray(target) ? target.join(', ') : String(target ?? 'nilai')
      return new HttpError(409, `${fields} sudah dipakai oleh data lain`)
    }
    case 'P2003': {
      const field = String(err.meta?.field_name ?? 'referensi')
      return new HttpError(422, `Referensi tidak valid atau masih dipakai (${field})`)
    }
    case 'P2025':
      return new HttpError(404, 'Data tidak ditemukan')
    default:
      return null
  }
}
