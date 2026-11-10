import type { FastifyRequest, FastifyReply } from 'fastify'
import type { UserSessionPayload } from '../modules/auth/auth.schema.js'

declare module 'fastify' {
  interface FastifyRequest {
    userSession?: UserSessionPayload
  }
}

/**
 * Middleware untuk memverifikasi session JWT dari Header Bearer atau Cookie HttpOnly
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    let token: string | undefined

    const authHeader = request.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim()
    } else {
      token = request.cookies.arrayan_access_token
    }

    if (!token) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Token otentikasi tidak ditemukan. Harap sertakan Bearer token atau login kembali.',
      })
    }

    // Verifikasi token (mendukung runtime Fastify maupun unit testing mock)
    const decoded = request.server?.jwt
      ? request.server.jwt.verify<UserSessionPayload>(token)
      : await request.jwtVerify<UserSessionPayload>()

    request.userSession = decoded
  } catch {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Token otentikasi tidak valid atau telah kedaluwarsa.',
    })
  }
}

/**
 * Middleware untuk otorisasi berbasis Role (RBAC)
 */
export function authorize(allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.userSession

    if (!user) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Autentikasi diperlukan.',
      })
    }

    if (!allowedRoles.includes(user.role.code)) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Anda tidak memiliki hak akses untuk tindakan ini.',
      })
    }
  }
}
