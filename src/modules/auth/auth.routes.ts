import type { FastifyPluginAsync } from 'fastify'
import { AuthFlowError, authService } from './auth.service.js'
import { InvalidAccountTokenError } from './account-token.service.js'
import {
  activateSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
} from './auth.schema.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { createLoginLimiter, loginLimiter } from './login-limiter.js'
import type { FastifyReply } from 'fastify'

const ACCESS_TOKEN_EXPIRY = '15m'
const ACCESS_TOKEN_MAX_AGE = 15 * 60 // 15 menit
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 // 7 hari

/** Skema response user sesi (dipakai login, refresh, me). Selaras dengan UserSessionPayload. */
const userResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    role: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        name: { type: 'string' },
        permissions: { type: 'array', items: { type: 'string' } },
      },
    },
    employee: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        nik: { type: 'string' },
        fullName: { type: 'string' },
        jobTitle: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            code: { type: 'string', examples: ['HR_SYSTEM_ADMIN'] },
            name: { type: 'string', examples: ['HR & System Admin'] },
            level: {
              type: 'string',
              enum: ['MANAGEMENT', 'SR_MANAGER', 'MANAGER', 'SUPERVISOR', 'STAFF'],
            },
          },
        },
        department: {
          type: 'object',
          nullable: true,
          properties: {
            id: { type: 'string' },
            code: { type: 'string', examples: ['HRD'] },
            name: { type: 'string', examples: ['People & Culture'] },
          },
        },
        managerId: { type: 'string', nullable: true },
      },
    },
  },
} as const

export const ACCESS_TOKEN_COOKIE = 'arrayan_access_token'
export const REFRESH_TOKEN_COOKIE = 'arrayan_refresh_token'
const REFRESH_COOKIE_PATH = '/api/auth'

function setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string) {
  const isProduction = process.env.NODE_ENV === 'production'
  const base = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ('none' as const) : ('lax' as const),
  }

  reply.setCookie(ACCESS_TOKEN_COOKIE, accessToken, { ...base, path: '/', maxAge: ACCESS_TOKEN_MAX_AGE })
  reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  })
}

function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' })
  reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_COOKIE_PATH })
  // Cookie lama (sebelum penyatuan nama cookie) — tetap dibersihkan agar browser lama bersih.
  reply.clearCookie('arrayan_token', { path: '/' })
}

/** Lupa password: maks. 3 permintaan per IP + email per 15 menit (anti spam/enumerasi). */
const forgotPasswordLimiter = createLoginLimiter(3)
/** Ganti password: maks. 5 percobaan password saat ini yang salah per IP + user per 15 menit. */
const changePasswordLimiter = createLoginLimiter(5)

const errorBody = {
  type: 'object',
  properties: { statusCode: { type: 'number' }, error: { type: 'string' }, message: { type: 'string' } },
} as const

function badRequest(message: string) {
  return { statusCode: 400, error: 'Bad Request', message }
}

function isSafeAuthError(err: unknown): err is Error {
  return err instanceof AuthFlowError || err instanceof InvalidAccountTokenError
}

function tooManyRequests(reply: FastifyReply, retryAfter: number, message: string) {
  reply.header('Retry-After', String(retryAfter))
  return reply.status(429).send({ statusCode: 429, error: 'Too Many Requests', message })
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Endpoint Login (Mengembalikan accessToken, refreshToken, dan Set HttpOnly Cookies)
  fastify.post('/login', {
    schema: {
      description: 'Login pengguna, menghasilkan access token (15m) & refresh token (7d), serta menyetel HttpOnly cookies',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', examples: ['superadmin@arrayan.com'] },
          password: { type: 'string', minLength: 6, examples: ['Password123!'] },
        },
      },
      response: {
        200: {
          description: 'Login berhasil',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            message: { type: 'string' },
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            user: userResponseSchema,
          },
        },
        400: {
          description: 'Bad Request / Format input salah',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        401: {
          description: 'Unauthorized / Kredensial salah',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        429: {
          description: 'Too Many Requests / 5x login gagal dalam 15 menit (per IP + email)',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const parseResult = loginSchema.safeParse(request.body)
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parseResult.error.issues[0]?.message || 'Input tidak valid',
        })
      }

      const { email } = parseResult.data
      const retryAfter = loginLimiter.retryAfterSeconds(request.ip, email)
      if (retryAfter > 0) {
        reply.header('Retry-After', String(retryAfter))
        return reply.status(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${Math.ceil(retryAfter / 60)} menit.`,
        })
      }

      let sessionPayload
      try {
        sessionPayload = await authService.validateUser(parseResult.data)
      } catch (err: unknown) {
        loginLimiter.recordFailure(request.ip, email)
        const error = err as Error
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: error.message || 'Email atau password salah',
        })
      }

      loginLimiter.reset(request.ip, email)

      // 1. Generate Access Token JWT (15 menit)
      const accessToken = fastify.jwt.sign(sessionPayload, { expiresIn: ACCESS_TOKEN_EXPIRY })

      // 2. Generate Refresh Token Opaque (7 hari) & Simpan di Database
      const refreshToken = await authService.createRefreshToken(sessionPayload.id)

      // 3. Set HttpOnly Cookies untuk Web Client
      setAuthCookies(reply, accessToken, refreshToken)

      return reply.send({
        statusCode: 200,
        message: 'Login berhasil',
        accessToken,
        refreshToken,
        user: sessionPayload,
      })
    },
  })

  // 2. Endpoint Refresh Token (Memperbarui accessToken menggunakan refreshToken)
  fastify.post('/refresh', {
    schema: {
      description: 'Memperbarui access token dengan refresh token (mendukung Token Rotation)',
      tags: ['Auth'],
      body: {
        type: 'object',
        properties: {
          refreshToken: { type: 'string', description: 'Opsional jika token tersedia di cookie HttpOnly' },
        },
      },
      response: {
        200: {
          description: 'Token berhasil diperbarui',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            message: { type: 'string' },
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            user: userResponseSchema,
          },
        },
        400: {
          description: 'Bad Request / Refresh token tidak disediakan',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        401: {
          description: 'Unauthorized / Refresh token tidak valid atau expired',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const parseResult = refreshSchema.safeParse(request.body)
      const rawBodyToken = parseResult.success ? parseResult.data.refreshToken : undefined
      const token = rawBodyToken || request.cookies[REFRESH_TOKEN_COOKIE]

      if (!token) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Refresh token tidak ditemukan di body request maupun cookie.',
        })
      }

      try {
        const { user, newRefreshToken } = await authService.rotateRefreshToken(token)

        const newAccessToken = fastify.jwt.sign(user, { expiresIn: ACCESS_TOKEN_EXPIRY })

        // Perbarui cookies
        setAuthCookies(reply, newAccessToken, newRefreshToken)

        return reply.send({
          statusCode: 200,
          message: 'Token berhasil diperbarui',
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          user,
        })
      } catch (err: unknown) {
        const error = err as Error
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: error.message || 'Refresh token tidak valid atau telah kedaluwarsa',
        })
      }
    },
  })

  // 3. Endpoint Logout (Hapus Cookies & Revoke Refresh Token di Database)
  fastify.post('/logout', {
    schema: {
      description: 'Logout pengguna, membatalkan refresh token di database dan menghapus cookies sesi',
      tags: ['Auth'],
      body: {
        type: 'object',
        properties: {
          refreshToken: { type: 'string', description: 'Opsional jika token tersedia di cookie HttpOnly' },
        },
      },
      response: {
        200: {
          description: 'Logout berhasil',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const parseResult = refreshSchema.safeParse(request.body)
      const rawBodyToken = parseResult.success ? parseResult.data.refreshToken : undefined
      const token = rawBodyToken || request.cookies[REFRESH_TOKEN_COOKIE]

      if (token) {
        try {
          await authService.revokeRefreshToken(token)
        } catch {
          // Abaikan error revoke saat logout agar cookie tetap dibersihkan
        }
      }

      clearAuthCookies(reply)

      return reply.send({
        statusCode: 200,
        message: 'Logout berhasil',
      })
    },
  })

  // 4. Endpoint Aktivasi Akun (US-2.3) — publik, memakai token dari link undangan
  fastify.post('/activate', {
    schema: {
      description:
        'Aktivasi akun karyawan dengan token dari link undangan dan menetapkan password. ' +
        'Password: 8–72 karakter, mengandung huruf besar, huruf kecil, angka, dan simbol. ' +
        'Setelah berhasil, karyawan login lewat POST /api/auth/login.',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', description: 'Token dari link aktivasi (64 karakter hex)' },
          password: { type: 'string', examples: ['Rahasia123!'] },
        },
      },
      response: {
        200: {
          description: 'Akun aktif',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            message: { type: 'string' },
            email: { type: 'string' },
          },
        },
        400: {
          description: 'Password tidak memenuhi kebijakan, atau token tidak valid/kedaluwarsa/sudah dipakai',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const parseResult = activateSchema.safeParse(request.body)
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parseResult.error.issues[0]?.message || 'Input tidak valid',
        })
      }

      try {
        const { email } = await authService.activateAccount(parseResult.data)
        return reply.send({ statusCode: 200, message: 'Akun berhasil diaktivasi. Silakan login.', email })
      } catch (err: unknown) {
        if (!isSafeAuthError(err)) throw err
        return reply.status(400).send(badRequest(err.message))
      }
    },
  })

  // 5. Lupa password — publik. Respons selalu sama agar tidak membocorkan email terdaftar.
  fastify.post('/forgot-password', {
    schema: {
      description:
        'Meminta link reset password (berlaku 1 jam) untuk akun aktif. Respons selalu 200 dengan pesan yang sama, ' +
        'terdaftar atau tidak. Maks. 3 permintaan per IP + email per 15 menit. ' +
        '`devResetLink` hanya muncul di luar production untuk uji coba tanpa email.',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', examples: ['budi.santoso@arrayan.com'] } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            message: { type: 'string' },
            devResetLink: { type: 'string' },
          },
        },
        400: errorBody,
        429: errorBody,
      },
    },
    handler: async (request, reply) => {
      const parseResult = forgotPasswordSchema.safeParse(request.body)
      if (!parseResult.success) {
        return reply.status(400).send(badRequest(parseResult.error.issues[0]?.message || 'Input tidak valid'))
      }

      const { email } = parseResult.data
      const retryAfter = forgotPasswordLimiter.retryAfterSeconds(request.ip, email)
      if (retryAfter > 0) {
        return tooManyRequests(reply, retryAfter, 'Terlalu banyak permintaan reset password. Coba lagi nanti.')
      }
      forgotPasswordLimiter.recordFailure(request.ip, email)

      const { devResetLink } = await authService.requestPasswordReset(email)
      return reply.send({
        statusCode: 200,
        message: 'Jika email terdaftar dan aktif, link reset password telah dikirim.',
        ...(devResetLink ? { devResetLink } : {}),
      })
    },
  })

  // 6. Reset password dengan token dari link — publik
  fastify.post('/reset-password', {
    schema: {
      description:
        'Menetapkan password baru dengan token dari link reset. Seluruh sesi login lain dicabut. ' +
        'Password: 8–72 karakter, mengandung huruf besar, huruf kecil, angka, dan simbol.',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', description: 'Token dari link reset (64 karakter hex)' },
          password: { type: 'string', examples: ['PasswordBaru123!'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { statusCode: { type: 'number' }, message: { type: 'string' }, email: { type: 'string' } },
        },
        400: errorBody,
      },
    },
    handler: async (request, reply) => {
      const parseResult = resetPasswordSchema.safeParse(request.body)
      if (!parseResult.success) {
        return reply.status(400).send(badRequest(parseResult.error.issues[0]?.message || 'Input tidak valid'))
      }

      try {
        const { email } = await authService.resetPassword(parseResult.data)
        clearAuthCookies(reply)
        return reply.send({ statusCode: 200, message: 'Password berhasil diubah. Silakan login kembali.', email })
      } catch (err: unknown) {
        if (!isSafeAuthError(err)) throw err
        return reply.status(400).send(badRequest(err.message))
      }
    },
  })

  // 7. Ganti password (sedang login) — sesi lain dicabut, sesi baru diterbitkan untuk perangkat ini
  fastify.post('/change-password', {
    preHandler: [authenticate],
    schema: {
      description:
        'Mengganti password user yang sedang login. Semua sesi lain (refresh token) dicabut; ' +
        'response berisi token & cookie baru agar perangkat ini tetap login.',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', examples: ['PasswordBaru123!'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            message: { type: 'string' },
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
          },
        },
        400: errorBody,
        401: errorBody,
        429: errorBody,
      },
    },
    handler: async (request, reply) => {
      const parseResult = changePasswordSchema.safeParse(request.body)
      if (!parseResult.success) {
        return reply.status(400).send(badRequest(parseResult.error.issues[0]?.message || 'Input tidak valid'))
      }

      const userId = request.userSession!.id
      const retryAfter = changePasswordLimiter.retryAfterSeconds(request.ip, userId)
      if (retryAfter > 0) {
        return tooManyRequests(reply, retryAfter, 'Terlalu banyak percobaan password salah. Coba lagi nanti.')
      }

      try {
        await authService.changePassword(userId, parseResult.data)
      } catch (err: unknown) {
        if (!isSafeAuthError(err)) throw err
        changePasswordLimiter.recordFailure(request.ip, userId)
        return reply.status(400).send(badRequest(err.message))
      }
      changePasswordLimiter.reset(request.ip, userId)

      const session = await authService.getUserProfile(userId)
      const accessToken = fastify.jwt.sign(session, { expiresIn: ACCESS_TOKEN_EXPIRY })
      const refreshToken = await authService.createRefreshToken(userId)
      setAuthCookies(reply, accessToken, refreshToken)

      return reply.send({ statusCode: 200, message: 'Password berhasil diubah', accessToken, refreshToken })
    },
  })

  // 8. Endpoint Me (Mendapatkan data user aktif dari Bearer token atau Cookie)
  fastify.get('/me', {
    preHandler: [authenticate],
    schema: {
      description: 'Mendapatkan data profil user aktif dari Bearer token atau cookie HttpOnly',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          description: 'Data profil user aktif',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            user: userResponseSchema,
          },
        },
        401: {
          description: 'Unauthorized / Sesi tidak ditemukan',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        404: {
          description: 'Not Found / User tidak ditemukan',
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const profile = await authService.getUserProfile(request.userSession!.id)
        return reply.send({
          statusCode: 200,
          user: profile,
        })
      } catch (err: unknown) {
        const error = err as Error
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: error.message,
        })
      }
    },
  })
}
