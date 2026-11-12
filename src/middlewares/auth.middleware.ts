import type { FastifyRequest, FastifyReply } from 'fastify'
import type { UserSessionPayload } from '../modules/auth/auth.schema.js'
import { authService } from '../modules/auth/auth.service.js'

declare module 'fastify' {
  interface FastifyRequest {
    userSession?: UserSessionPayload
  }
}

/**
 * Pemuat sesi: dari id user + sessionVersion di token → sesi terkini, atau null bila sesi
 * tidak berlaku lagi. Dapat diganti untuk unit test.
 */
export type SessionLoader = (userId: string, sessionVersion: unknown) => Promise<UserSessionPayload | null>

const UNAUTHORIZED = { statusCode: 401, error: 'Unauthorized' } as const

/**
 * Middleware autentikasi (dual transport: Bearer header atau cookie HttpOnly).
 * 1. Verifikasi tanda tangan & masa berlaku JWT.
 * 2. Cocokkan dengan DB: user ACTIVE dan `sessionVersion` sama — sehingga akun yang
 *    dinonaktifkan / password yang diganti langsung memutus semua access token lama.
 * `request.userSession` diisi data terkini dari DB (role berubah → langsung berlaku).
 */
export function createAuthenticate(loadSession: SessionLoader) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : request.cookies.arrayan_access_token

    if (!token) {
      return reply.status(401).send({
        ...UNAUTHORIZED,
        message: 'Token otentikasi tidak ditemukan. Harap sertakan Bearer token atau login kembali.',
      })
    }

    let decoded: UserSessionPayload
    try {
      // Verifikasi token (mendukung runtime Fastify maupun unit testing mock)
      decoded = request.server?.jwt
        ? request.server.jwt.verify<UserSessionPayload>(token)
        : await request.jwtVerify<UserSessionPayload>()
    } catch {
      return reply.status(401).send({
        ...UNAUTHORIZED,
        message: 'Token otentikasi tidak valid atau telah kedaluwarsa.',
      })
    }

    const session = await loadSession(decoded.id, decoded.sessionVersion)
    if (!session) {
      return reply.status(401).send({
        ...UNAUTHORIZED,
        message: 'Sesi tidak berlaku lagi. Silakan login kembali.',
      })
    }

    request.userSession = session
  }
}

export const authenticate = createAuthenticate((userId, sessionVersion) =>
  authService.loadActiveSession(userId, sessionVersion),
)

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
