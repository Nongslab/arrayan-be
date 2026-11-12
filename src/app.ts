import { STATUS_CODES } from 'node:http'
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { prisma } from './lib/prisma.js'
import { getConfig } from './lib/config.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { masterRoutes, MASTER_SWAGGER_TAGS } from './modules/master/master.routes.js'
import { employeeRoutes } from './modules/employee/employee.routes.js'
import { auditRoutes } from './modules/audit/audit.routes.js'
import { leaveRoutes } from './modules/leave/leave.routes.js'

/**
 * Field sensitif yang disamarkan dari log (defense in depth — serializer bawaan Fastify
 * tidak mencatat header/body, tetapi log tambahan bisa saja menyertakannya).
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.tokenHash',
]

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger']
}

/**
 * Merakit instance Fastify (plugin + route) tanpa menjalankan `listen`.
 * Dipakai oleh `server.ts` untuk runtime dan oleh integration test via `app.inject()`.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = getConfig()

  const fastify = Fastify({
    logger: options.logger ?? {
      level: config.logLevel,
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    },
    // Aktifkan saat berjalan di belakang reverse proxy (nginx) agar request.ip = IP klien asli.
    trustProxy: config.trustProxy,
  })

  for (const warning of config.warnings) fastify.log.warn(warning)

  // Error tak terduga (5xx) tidak boleh membocorkan detail internal (pesan Prisma, stack, dll).
  fastify.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled error')
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Terjadi kesalahan pada server. Silakan coba lagi.',
      })
    }
    return reply.status(statusCode).send({
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message: error.message,
    })
  })

  // Tutup koneksi database saat server ditutup (graceful shutdown).
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect()
  })

  // 1. CORS Setup
  await fastify.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  })

  // 2. Cookie & JWT Setup
  await fastify.register(cookie, {
    secret: config.cookieSecret,
  })

  await fastify.register(jwt, {
    secret: config.jwtSecret,
    cookie: {
      cookieName: 'arrayan_access_token',
      signed: false,
    },
  })

  // 3. Auto Swagger API Documentation
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Arryan HRIS Backend API',
        description: 'REST API documentation for Arryan HRIS Platform',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Masukkan Access Token JWT (tanpa prefix Bearer)',
          },
        },
      },
      tags: [
        { name: 'Auth', description: 'Otentikasi, Sesi, dan Keamanan Pengguna' },
        { name: 'Employees', description: 'Data karyawan & pohon organisasi (Tree Branch)' },
        { name: 'Leaves', description: 'Cuti, izin & sakit: saldo, pengajuan, pembatalan' },
        { name: 'Audit Log', description: 'Jejak aksi admin & event keamanan (SUPER_ADMIN)' },
        ...MASTER_SWAGGER_TAGS,
      ],
    },
  })

  // Swagger UI: default aktif di dev/test, nonaktif di production (DOCS_ENABLED=true untuk mengaktifkan).
  if (config.docsEnabled) {
    await fastify.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
    })
  }

  // 4. Health Check Endpoint
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // 5. Public Welcome Route
  fastify.get('/api/welcome', async () => {
    const rolesCount = await prisma.role.count()
    const usersCount = await prisma.user.count()
    return {
      message: 'Selamat datang di API Arryan HRIS!',
      environment: config.nodeEnv,
      database: {
        connected: true,
        totalRoles: rolesCount,
        totalUsers: usersCount,
      },
      docsUrl: 'http://localhost:4000/docs',
    }
  })

  // 6. Feature Modules
  await fastify.register(authRoutes, { prefix: '/api/auth' })
  await fastify.register(masterRoutes, { prefix: '/api/master' })
  await fastify.register(employeeRoutes, { prefix: '/api/employees' })
  await fastify.register(auditRoutes, { prefix: '/api/audit-logs' })
  await fastify.register(leaveRoutes, { prefix: '/api/leaves' })

  return fastify
}
