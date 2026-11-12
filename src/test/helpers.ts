import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'

/** Kredensial Super Admin dari prisma/seed.ts. */
export const SUPER_ADMIN = { email: 'superadmin@arrayan.com', password: 'Password123!' } as const

/** Instance app siap `inject()` tanpa listen port & tanpa log. */
export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({ logger: false })
  await app.ready()
  return app
}

/** Login dan kembalikan access token untuk header `Authorization: Bearer`. */
export async function loginAs(
  app: FastifyInstance,
  credentials: { email: string; password: string } = SUPER_ADMIN,
): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: credentials })
  if (res.statusCode !== 200) {
    throw new Error(`Login gagal (${res.statusCode}): ${res.body}`)
  }
  return res.json().accessToken as string
}

export function bearer(token: string) {
  return { authorization: `Bearer ${token}` }
}
