import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { prisma } from './lib/prisma.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { masterRoutes, MASTER_SWAGGER_TAGS } from './modules/master/master.routes.js'

/** Secret wajib diisi via environment — tidak ada nilai fallback yang bisa bocor ke production. */
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.length < 32) {
    throw new Error(`Environment variable ${name} wajib diisi (minimal 32 karakter). Lihat .env.example.`)
  }
  return value
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger']
}

/**
 * Merakit instance Fastify (plugin + route) tanpa menjalankan `listen`.
 * Dipakai oleh `server.ts` untuk runtime dan oleh integration test via `app.inject()`.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const JWT_SECRET = requireEnv('JWT_SECRET')
  const COOKIE_SECRET = requireEnv('COOKIE_SECRET')

  const fastify = Fastify({
    logger: options.logger ?? true,
    // Aktifkan saat berjalan di belakang reverse proxy (nginx) agar request.ip = IP klien asli.
    trustProxy: process.env.TRUST_PROXY === 'true',
  })

  // 1. CORS Setup
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })

  // 2. Cookie & JWT Setup
  await fastify.register(cookie, {
    secret: COOKIE_SECRET,
  })

  await fastify.register(jwt, {
    secret: JWT_SECRET,
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
      tags: [{ name: 'Auth', description: 'Otentikasi, Sesi, dan Keamanan Pengguna' }, ...MASTER_SWAGGER_TAGS],
    },
  })

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  })

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
      environment: process.env.NODE_ENV,
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

  return fastify
}
